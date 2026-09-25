# Etsy worker schema

`migrations/20260925120000_etsy_worker.sql` is the queue, results store, and
RPCs for optional worker mode. `migrations/20260925140000_etsy_worker_commands.sql`
adds job type, params, and payload snapshots so a lane can run search,
listing visits, shop pages, export, and collection stats.
`migrations/20260925160000_etsy_worker_auth.sql` revokes those RPCs from
`anon` and `public`, grants them to `authenticated`, and requires an
`etsy_worker.operators` row. Apply all three files yourself, in that order.
This repository does not connect to a database.

In the Supabase SQL editor (or `psql` against a database you control), paste
and run each migration file. Create the project first. Disable public
signups, create one Auth user per lane and one for agents, then insert
operator rows. Do not put the project URL, the publishable key, or passwords
in git.

After they run:

- `etsy_worker.jobs` is the command queue (`job_type`, params, priority, lease, status).
- `etsy_worker.listings` is the row store, written only by
  `etsy_worker_upload_results`.
- `etsy_worker.payloads` holds export snapshots and full listing extracts,
  written only by `etsy_worker_upload_payload`.
- `etsy_worker.workers` is the lane heartbeat table.
- Public functions `etsy_worker_*` are what the extension and
  `scripts/etsy-worker.mjs` call through PostgREST.

If the `supabase_realtime` publication exists, the migration adds
`etsy_worker.jobs` to it so an idle lane can wake when a term is inserted.
Polling still works when Realtime is off.

The publishable or anon key only identifies the project (`apikey`). Calls
also need `Authorization: Bearer <user access token>` from an operator
sign-in. A publishable key is not a bearer token. Do not use a
`service_role` or `sb_secret_` key with the extension or the CLI.

See [the worker runbook](../docs/worker-runbook.md) for lanes, health, and
stuck jobs.
