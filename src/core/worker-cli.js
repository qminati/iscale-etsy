// Agent-facing commands for the optional Etsy worker queue.
// Reads ETSY_WORKER_URL and ETSY_WORKER_ANON_KEY from the environment.
// Never prints the key.

import { createWorkerClient } from "./worker-client.js";

export const CLI_HELP = `etsy-worker — push Etsy searches to a worker lane and read results

Environment (required, never commit these):
  ETSY_WORKER_URL        https://YOUR_PROJECT.supabase.co
  ETSY_WORKER_ANON_KEY   publishable anon key

Commands:
  add-terms "<term>" ["<term>" ...] --priority <n> [--pages <n>] [--sort <order>]
  search-now "<term>" [--pages <n>] [--sort <order>]
  status [--term "<term>"] [--json]
  results --term "<term>" [--json] [--limit <n>] [--offset <n>]
  health [--json]
  requeue

search-now inserts the term above every other open job so the next claim takes it.
status --term prints state, lane, pages done, rows landed, total result count, and last error.
results --json prints the rows an agent can read, including partial pages.
`;

function takeValue(argv, index, flag) {
  const next = argv[index + 1];
  if (!next || next.startsWith("--")) {
    throw new Error(`missing value for ${flag}`);
  }
  return { value: next, index: index + 1 };
}

export function parseWorkerArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  const command = args[0] && !args[0].startsWith("--") ? args[0] : "help";
  const flags = { json: false };
  const positionals = [];
  const rest = command === args[0] ? args.slice(1) : args;
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === "--json") flags.json = true;
    else if (token === "--help" || token === "-h") flags.help = true;
    else if (token.startsWith("--priority=")) flags.priority = token.slice("--priority=".length);
    else if (token.startsWith("--pages=")) flags.pages = token.slice("--pages=".length);
    else if (token.startsWith("--sort=")) flags.sort = token.slice("--sort=".length);
    else if (token.startsWith("--term=")) flags.term = token.slice("--term=".length);
    else if (token.startsWith("--limit=")) flags.limit = token.slice("--limit=".length);
    else if (token.startsWith("--offset=")) flags.offset = token.slice("--offset=".length);
    else if (token === "--priority" || token === "--pages" || token === "--sort" || token === "--term" || token === "--limit" || token === "--offset") {
      const got = takeValue(rest, i, token);
      flags[token.slice(2)] = got.value;
      i = got.index;
    } else if (token.startsWith("--")) {
      throw new Error(`unknown flag ${token}`);
    } else {
      positionals.push(token);
    }
  }
  return { command, flags, positionals };
}

function intFlag(value, fallback) {
  if (value == null || value === "") return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) throw new Error(`expected an integer, got ${value}`);
  return n;
}

function termList(parsed) {
  const terms = [...parsed.positionals];
  if (parsed.flags.term) terms.push(parsed.flags.term);
  return terms.map((term) => String(term).trim()).filter(Boolean);
}

function clientFromEnv(env, fetchImpl) {
  const backendUrl = String(env.ETSY_WORKER_URL || "").trim();
  const anonKey = String(env.ETSY_WORKER_ANON_KEY || "").trim();
  if (!backendUrl || !anonKey) {
    throw new Error("Set ETSY_WORKER_URL and ETSY_WORKER_ANON_KEY. Do not commit them.");
  }
  return createWorkerClient({ fetchImpl, backendUrl, anonKey });
}

function printStatus(data, out) {
  out.log(`term: ${data.term ?? ""}`);
  out.log(`state: ${data.state ?? ""}`);
  out.log(`lane: ${data.lane ?? ""}`);
  out.log(`pages_done: ${data.pages_done ?? 0}`);
  out.log(`pages: ${data.pages ?? ""}`);
  out.log(`rows: ${data.rows ?? 0}`);
  out.log(`total_results: ${data.total_results ?? ""}`);
  out.log(`last_error: ${data.last_error ?? ""}`);
  out.log(`priority: ${data.priority ?? ""}`);
  out.log(`attempt: ${data.attempt ?? ""}`);
  if (data.search_path) out.log(`search_path: ${data.search_path}`);
}

function printJson(data, out) {
  out.log(JSON.stringify(data, null, 2));
}

export async function runWorkerCli(argv, env = {}, fetchImpl = globalThis.fetch, out = { log: () => {}, error: () => {} }) {
  let parsed;
  try {
    parsed = parseWorkerArgs(argv);
  } catch (error) {
    out.error(error.message);
    return 2;
  }
  if (parsed.flags.help || parsed.command === "help") {
    out.log(CLI_HELP.trimEnd());
    return parsed.command === "help" || parsed.flags.help ? 0 : 2;
  }

  let client;
  try {
    client = clientFromEnv(env, fetchImpl);
  } catch (error) {
    out.error(error.message);
    return 1;
  }

  try {
    if (parsed.command === "add-terms") {
      const terms = termList(parsed);
      if (terms.length === 0) {
        out.error('usage: add-terms "<term>" --priority <n>');
        return 2;
      }
      const priority = intFlag(parsed.flags.priority, 0);
      const pages = intFlag(parsed.flags.pages, 1);
      const sort = parsed.flags.sort || "most_relevant";
      const data = await client.addTerms(terms, priority, pages, sort);
      if (data?.ok === false) {
        out.error(data.error || "add_terms_failed");
        return 1;
      }
      if (parsed.flags.json) printJson(data, out);
      else {
        for (const job of data.jobs || []) {
          out.log(`${job.action}: ${job.term} priority=${job.priority ?? ""} id=${job.id ?? ""}`);
        }
      }
      return 0;
    }

    if (parsed.command === "search-now") {
      const terms = termList(parsed);
      if (terms.length !== 1) {
        out.error('usage: search-now "<term>" [--pages <n>]');
        return 2;
      }
      const data = await client.searchNow(terms[0], intFlag(parsed.flags.pages, 1), parsed.flags.sort || "most_relevant");
      if (data?.ok === false) {
        out.error(data.error || "search_now_failed");
        return 1;
      }
      if (parsed.flags.json) printJson(data, out);
      else out.log(`${data.action}: ${data.term} priority=${data.priority} id=${data.id}`);
      return 0;
    }

    if (parsed.command === "status") {
      const terms = termList(parsed);
      const data = terms.length
        ? await client.termStatus(terms[0])
        : await client.fleetStatus();
      if (data?.ok === false) {
        out.error(data.error || "status_failed");
        return 1;
      }
      if (parsed.flags.json || !terms.length) {
        if (terms.length && !parsed.flags.json) printStatus(data, out);
        else printJson(data, out);
      } else {
        printStatus(data, out);
      }
      return 0;
    }

    if (parsed.command === "results") {
      const terms = termList(parsed);
      if (terms.length !== 1) {
        out.error('usage: results --term "<term>" --json');
        return 2;
      }
      const data = await client.results(terms[0], intFlag(parsed.flags.limit, 500), intFlag(parsed.flags.offset, 0));
      if (data?.ok === false) {
        out.error(data.error || "results_failed");
        return 1;
      }
      if (parsed.flags.json) printJson(data, out);
      else {
        out.log(`term: ${data.job?.term ?? terms[0]}`);
        out.log(`state: ${data.job?.state ?? ""}`);
        out.log(`rows: ${data.job?.rows ?? data.listing_count ?? 0}`);
        out.log(`total_results: ${data.job?.total_results ?? ""}`);
        for (const row of data.listings || []) {
          out.log(`${row.page}:${row.position} ${row.listing_id} ${row.title || ""}`);
        }
      }
      return 0;
    }

    if (parsed.command === "health") {
      const data = await client.health();
      if (data?.ok === false) {
        out.error(data.error || "health_failed");
        return 1;
      }
      printJson(data, out);
      return 0;
    }

    if (parsed.command === "requeue") {
      const data = await client.requeueExpired();
      if (data?.ok === false) {
        out.error(data.error || "requeue_failed");
        return 1;
      }
      if (parsed.flags.json) printJson(data, out);
      else out.log(`requeued: ${data.requeued ?? 0} failed: ${data.failed ?? 0}`);
      return 0;
    }

    out.error(CLI_HELP.trimEnd());
    return 2;
  } catch (error) {
    out.error(error?.message || "command_failed");
    return 1;
  }
}
