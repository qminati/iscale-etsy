import { describe, expect, it } from "vitest";
import { decideWorkerTick, listingRowsForUpload, paceDelayMs, runClaimedSearch } from "../src/core/worker-loop.js";
import { idlePickupWithinSla } from "../src/core/worker-config.js";

function readyCfg(over = {}) {
  return {
    enabled: true,
    ready: true,
    laneName: "lane-1",
    origin: "https://example.test",
    paceMinMs: 10,
    paceMaxMs: 10,
    blockedUntil: 0,
    ...over,
  };
}

function deps(overrides = {}) {
  const calls = [];
  const note = (name) => (...args) => {
    calls.push([name, ...args]);
    return overrides[name]?.(...args);
  };
  const api = {
    calls,
    isCancelled: () => false,
    log: (line) => calls.push(["log", line]),
    sleep: async () => {},
    rand: () => 0,
    writeSession: async (value) => calls.push(["session", value.status, value.phase]),
    openHome: note("openHome"),
    typeAndSubmit: note("typeAndSubmit"),
    waitForSearch: note("waitForSearch"),
    navigate: note("navigate"),
    clickNext: note("clickNext"),
    waitForNavigation: note("waitForNavigation"),
    extractPage: note("extractPage"),
    upload: note("upload"),
    heartbeat: note("heartbeat"),
    complete: note("complete"),
    fail: note("fail"),
  };
  return api;
}

const job = { id: "job-1", term: "linen apron", pages: 2, sort: "most_relevant" };

function page(n, total = 1248) {
  return {
    payload: {
      keyword: "linen apron",
      page: n,
      totalResults: total,
      capturedAt: "2026-09-25T00:00:00.000Z",
      results: [
        {
          listingId: "1111111111",
          title: "Apron",
          price: "$20.00",
          priceNumeric: 20,
          currency: "USD",
          shopName: "Shop",
          position: 1,
          page: n,
          url: "https://www.etsy.com/listing/1111111111",
          isBestseller: true,
          isAd: false,
          tags: ["linen"],
        },
      ],
    },
    block: { blocked: false, reason: null },
  };
}

describe("runClaimedSearch", () => {
  it("types into the search box, uploads page 1 before page 2, and completes", async () => {
    const api = deps({
      typeAndSubmit: async () => ({ ok: true, path: "search_box", method: "button" }),
      waitForSearch: async () => "https://www.etsy.com/search?q=linen+apron",
      clickNext: async () => ({ ok: true, path: "pagination_click", href: "https://www.etsy.com/search?q=linen+apron&page=2" }),
      waitForNavigation: async () => "https://www.etsy.com/search?q=linen+apron&page=2",
      extractPage: async () => page(api.calls.filter((c) => c[0] === "extractPage").length + 1),
      upload: async () => ({ ok: true, listings_uploaded: api.calls.filter((c) => c[0] === "upload").length }),
      complete: async () => ({ ok: true, already: false }),
    });
    const result = await runClaimedSearch({ job, cfg: readyCfg(), deps: api });
    expect(result.status).toBe("completed");
    expect(result.listingsUploaded).toBe(2);
    expect(result.totalResults).toBe(1248);
    const names = api.calls.map((c) => c[0]);
    const firstUpload = names.indexOf("upload");
    const secondExtract = names.indexOf("extractPage", names.indexOf("extractPage") + 1);
    expect(firstUpload).toBeGreaterThan(-1);
    expect(firstUpload).toBeLessThan(secondExtract);
    expect(names).toContain("typeAndSubmit");
    expect(api.calls.filter((c) => c[0] === "log").map((c) => c[1])).toEqual(
      expect.arrayContaining([
        expect.stringContaining("search path: search_box"),
        expect.stringContaining("search path: pagination_click"),
      ]),
    );
    expect(api.calls.find((c) => c[0] === "navigate")).toBeUndefined();
    const uploaded = api.calls.find((c) => c[0] === "upload")[1];
    expect(uploaded.listings[0]).toMatchObject({
      listing_id: "1111111111",
      is_bestseller: true,
      currency: "USD",
      tags: ["linen"],
    });
  });

  it("navigates to the search URL and logs that path when the box is missing", async () => {
    const api = deps({
      typeAndSubmit: async () => ({ ok: false, path: "url_navigation", reason: "search_box_not_found" }),
      navigate: async (url) => url,
      extractPage: async () => page(1),
      upload: async () => ({ ok: true, listings_uploaded: 1 }),
      complete: async () => ({ ok: true }),
    });
    const result = await runClaimedSearch({ job: { ...job, pages: 1 }, cfg: readyCfg(), deps: api });
    expect(result.status).toBe("completed");
    const nav = api.calls.find((c) => c[0] === "navigate");
    expect(nav[1]).toContain("https://www.etsy.com/search?");
    expect(nav[1]).toContain("q=linen+apron");
    expect(api.calls.map((c) => c[1])).toContain("[etsy-worker] search path: url_navigation (search_box_not_found)");
  });

  it("stops on a captcha and reports it without uploading or completing", async () => {
    const api = deps({
      typeAndSubmit: async () => ({ ok: true, path: "search_box", method: "button" }),
      waitForSearch: async () => "https://www.etsy.com/search?q=linen+apron",
      extractPage: async () => ({ payload: { results: [] }, block: { blocked: true, reason: "captcha" } }),
      fail: async () => ({ ok: true, status: "blocked" }),
    });
    const result = await runClaimedSearch({ job: { ...job, pages: 3 }, cfg: readyCfg(), deps: api });
    expect(result).toMatchObject({ status: "blocked", reason: "captcha" });
    expect(api.calls.some((c) => c[0] === "upload")).toBe(false);
    expect(api.calls.some((c) => c[0] === "complete")).toBe(false);
    expect(api.calls.find((c) => c[0] === "fail")[1]).toMatchObject({ blocked: true, error: "captcha:page:1" });
    expect(api.calls.some((c) => c[0] === "session" && c[1] === "blocked")).toBe(true);
  });

  it("stops when the lease is lost instead of completing", async () => {
    const api = deps({
      typeAndSubmit: async () => ({ ok: true, path: "search_box", method: "button" }),
      waitForSearch: async () => "https://www.etsy.com/search?q=linen+apron",
      extractPage: async () => page(1),
      upload: async () => ({ ok: false, error: "lease_lost" }),
    });
    const result = await runClaimedSearch({ job: { ...job, pages: 2 }, cfg: readyCfg(), deps: api });
    expect(result.status).toBe("lease_lost");
    expect(api.calls.some((c) => c[0] === "complete")).toBe(false);
  });
});

describe("decideWorkerTick", () => {
  it("claims only when the lane is configured and idle", () => {
    expect(decideWorkerTick({ cfg: { enabled: false } }).action).toBe("disabled");
    expect(decideWorkerTick({ cfg: readyCfg(), localRunnerBusy: true }).action).toBe("deferred_local_job");
    expect(decideWorkerTick({ cfg: readyCfg({ blockedUntil: 100 }), nowMs: 50 }).action).toBe("backoff");
    expect(decideWorkerTick({ cfg: readyCfg(), scanning: true }).action).toBe("busy");
    expect(decideWorkerTick({ cfg: readyCfg() }).action).toBe("claim");
  });
});

describe("listing rows and pace", () => {
  it("drops listings without an id and keeps visible signals", () => {
    const rows = listingRowsForUpload({
      results: [
        { listingId: "nope", title: "skip" },
        { listingId: "2222222222", title: "Keep", price: "£3", currency: "GBP", favorites: 4, salesSignal: "In 2 carts" },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ listing_id: "2222222222", currency: "GBP", favorites: 4, sales_signal: "In 2 carts" });
  });

  it("uses the configured pace", () => {
    expect(paceDelayMs({ paceMinMs: 4000, paceMaxMs: 4000 }, () => 0)).toBe(4000);
  });

  it("keeps the default poll inside the two-minute idle budget", () => {
    expect(idlePickupWithinSla(20)).toBe(true);
    expect(idlePickupWithinSla(120)).toBe(true);
    expect(idlePickupWithinSla(121, 0)).toBe(false);
  });
});
