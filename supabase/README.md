# Etsy worker schema

`migrations/20260925120000_etsy_worker.sql` is the queue, results store, and
RPCs for optional worker mode. Apply it yourself. This repository does not
connect to a database.

In the Supabase SQL editor (or `psql` against a database you control), paste
and run the migration file. Create the project first. Do not put the project
URL or the anon key in git.

After it runs:

- `etsy_worker.jobs` is the term queue (priority, lease, status).
- `etsy_worker.listings` is the results store, written only by
  `etsy_worker_upload_results`.
- `etsy_worker.workers` is the lane heartbeat table.
- Public functions `etsy_worker_*` are what the extension and
  `scripts/etsy-worker.mjs` call through PostgREST.

If the `supabase_realtime` publication exists, the migration adds
`etsy_worker.jobs` to it so an idle lane can wake when a term is inserted.
Polling still works when Realtime is off.

The anon key is a credential. Anyone with it can add terms and read results.
Keep the Supabase project private.

See [the worker runbook](../docs/worker-runbook.md) for lanes, health, and
stuck jobs.
