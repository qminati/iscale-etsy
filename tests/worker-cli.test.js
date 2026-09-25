// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseWorkerArgs, runWorkerCli } from "../src/core/worker-cli.js";
import { rpcUrl } from "../src/core/worker-client.js";
import { isPendingJobWake, realtimeJoinMessage, realtimeWebSocketUrl } from "../src/core/worker-realtime.js";
import { idlePickupWithinSla, normalizeWorkerSettings, sanitizeLaneSnapshot } from "../src/core/worker-config.js";

describe("parseWorkerArgs", () => {
  it("reads add-terms priority and search-now", () => {
    expect(parseWorkerArgs(["add-terms", "linen apron", "--priority", "10", "--pages", "2"])).toMatchObject({
      command: "add-terms",
      flags: { priority: "10", pages: "2" },
      positionals: ["linen apron"],
    });
    expect(parseWorkerArgs(["search-now", "rush term"])).toMatchObject({
      command: "search-now",
      positionals: ["rush term"],
    });
    expect(parseWorkerArgs(["status", "--term", "linen apron"])).toMatchObject({
      command: "status",
      flags: { term: "linen apron" },
    });
    expect(parseWorkerArgs(["results", "--term", "linen apron", "--json"]).flags.json).toBe(true);
  });
});

function fakeFetch(routes) {
  return async (url, init) => {
    const body = JSON.parse(init.body);
    const fn = String(url).split("/").pop();
    const handler = routes[fn];
    if (!handler) return { ok: false, status: 404, text: async () => JSON.stringify({ message: "missing" }) };
    return { ok: true, status: 200, text: async () => JSON.stringify(handler(body)) };
  };
}

describe("runWorkerCli", () => {
  const env = { ETSY_WORKER_URL: "https://example.test", ETSY_WORKER_ANON_KEY: "publishable-key" };

  it("posts add-terms with priority and prints search-now", async () => {
    const seen = [];
    const fetchImpl = fakeFetch({
      etsy_worker_add_terms: (body) => {
        seen.push(body);
        return { ok: true, jobs: [{ id: "1", term: "linen apron", action: "inserted", priority: body.p_priority }] };
      },
      etsy_worker_search_now: (body) => ({ ok: true, id: "2", term: body.p_term, action: "inserted", priority: 40 }),
    });
    const lines = [];
    const code = await runWorkerCli(["add-terms", "linen apron", "--priority", "10"], env, fetchImpl, {
      log: (line) => lines.push(line),
      error: (line) => lines.push(`ERR ${line}`),
    });
    expect(code).toBe(0);
    expect(seen[0]).toMatchObject({ p_terms: ["linen apron"], p_priority: 10, p_pages: 1 });
    expect(lines[0]).toContain("inserted: linen apron priority=10");

    const now = [];
    const nowCode = await runWorkerCli(["search-now", "rush term"], env, fetchImpl, {
      log: (line) => now.push(line),
      error: () => {},
    });
    expect(nowCode).toBe(0);
    expect(now[0]).toContain("priority=40");
  });

  it("prints term status fields and results json", async () => {
    const fetchImpl = fakeFetch({
      etsy_worker_term_status: () => ({
        ok: true,
        term: "linen apron",
        state: "processing",
        lane: "lane-1",
        pages_done: 1,
        pages: 2,
        rows: 48,
        total_results: 12480,
        last_error: null,
        priority: 10,
        attempt: 1,
        search_path: "search_box",
      }),
      etsy_worker_results: () => ({
        ok: true,
        job: { term: "linen apron", state: "processing", rows: 1, total_results: 12480 },
        listings: [{ listing_id: "1111111111", title: "Apron", page: 1, position: 1 }],
      }),
    });
    const status = [];
    expect(await runWorkerCli(["status", "--term", "linen apron"], env, fetchImpl, {
      log: (line) => status.push(line),
      error: () => {},
    })).toBe(0);
    expect(status.join("\n")).toContain("state: processing");
    expect(status.join("\n")).toContain("lane: lane-1");
    expect(status.join("\n")).toContain("pages_done: 1");
    expect(status.join("\n")).toContain("rows: 48");
    expect(status.join("\n")).toContain("total_results: 12480");
    expect(status.join("\n")).toContain("search_path: search_box");

    const results = [];
    expect(await runWorkerCli(["results", "--term", "linen apron", "--json"], env, fetchImpl, {
      log: (line) => results.push(line),
      error: () => {},
    })).toBe(0);
    const parsed = JSON.parse(results.join("\n"));
    expect(parsed.listings[0].listing_id).toBe("1111111111");
  });

  it("refuses to run without the backend env and does not echo a key", async () => {
    const errors = [];
    const code = await runWorkerCli(["status"], {}, async () => {
      throw new Error("should not fetch");
    }, { log: () => {}, error: (line) => errors.push(line) });
    expect(code).toBe(1);
    expect(errors[0]).toContain("ETSY_WORKER_URL");
    expect(errors.join("\n")).not.toContain("publishable-key");
  });
});

describe("worker client and realtime helpers", () => {
  it("builds a rest rpc url without a baked-in project", () => {
    expect(rpcUrl("https://example.test/rest/v1", "etsy_worker_health")).toBe("https://example.test/rest/v1/rpc/etsy_worker_health");
    expect(() => rpcUrl("http://evil.example", "etsy_worker_health")).toThrow(/https_required/);
  });

  it("builds a realtime socket and recognizes a pending insert", () => {
    const url = new URL(realtimeWebSocketUrl("https://example.test", "publishable-key"));
    expect(url.protocol).toBe("wss:");
    expect(url.pathname).toBe("/realtime/v1/websocket");
    expect(url.searchParams.get("apikey")).toBe("publishable-key");
    expect(realtimeJoinMessage().payload.config.postgres_changes[0]).toMatchObject({
      event: "INSERT",
      schema: "etsy_worker",
      table: "jobs",
    });
    expect(isPendingJobWake({
      event: "postgres_changes",
      payload: { data: { type: "INSERT", record: { status: "pending" } } },
    })).toBe(true);
    expect(isPendingJobWake({ payload: { data: { type: "UPDATE", record: { status: "processing" } } } })).toBe(false);
  });

  it("stays off and unready until a person configures it", () => {
    const off = normalizeWorkerSettings({});
    expect(off.enabled).toBe(false);
    expect(off.ready).toBe(false);
    const on = normalizeWorkerSettings({
      workerEnabled: true,
      workerBackendUrl: "https://example.test",
      workerAnonKey: "k",
      workerLaneName: "lane 1",
      workerPollSeconds: 20,
    });
    expect(on.ready).toBe(true);
    expect(on.laneName).toBe("lane 1");
    expect(idlePickupWithinSla(on.pollSeconds)).toBe(true);
    expect(sanitizeLaneSnapshot({ laneName: "lane 1", anonKey: "k", workerAnonKey: "secret", status: "idle" })).toEqual({
      laneName: "lane 1",
      status: "idle",
    });
  });
});
