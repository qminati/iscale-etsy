# Etsy worker runbook

Worker mode lets a chat agent enqueue Etsy searches and read the scraped rows
back, without anyone clicking inside the extension. The browser stays headed
and visible. Local-only use is unchanged when worker mode is off.

There is no project URL or key in this repository. You create the backend and
paste its publishable key into the options page and into your shell.

## What you deploy

1. Create a Postgres database. Supabase is the shape these RPCs target
   (PostgREST plus optional Realtime). Any Postgres that can expose the
   `public.etsy_worker_*` functions over HTTP will also work with the CLI if
   you put a compatible `/rest/v1/rpc` endpoint in `ETSY_WORKER_URL`.
2. Run [supabase/migrations/20260925120000_etsy_worker.sql](../supabase/migrations/20260925120000_etsy_worker.sql)
   in the SQL editor or with `psql`. Do not commit the project URL or keys.
3. If you are on Supabase, the migration adds `etsy_worker.jobs` to the
   `supabase_realtime` publication when that publication exists. That lets an
   idle lane wake as soon as a term is inserted. Polling still picks the term
   up within about two minutes when Realtime is unavailable.
4. Copy the project URL (`https://YOUR_PROJECT.supabase.co`) and the anon /
   publishable key. Treat the anon key as a credential: anyone who has it can
   add terms and read results.

## Extension options

On each machine that will scrape:

1. Load this folder as an unpacked extension (`chrome://extensions`, Developer
   mode, Load unpacked). Use a normal Chrome window. Do not use a headless
   browser.
2. Open the extension options (Worker options on the dashboard, or the
   extension's Options page).
3. Set the backend URL, anon key, and a lane name unique to that window
   (`lane-1`, `lane-2`, …).
4. Leave the defaults unless you need to change them: poll 20 seconds, claim
   lease 180 seconds, 4–9 seconds between results pages, 40–140 ms between
   keystrokes, 30 minutes of backoff after a captcha. Realtime wake is on.
5. Enable worker mode and save. Chrome asks for permission to call that
   backend origin. Grant it.
6. Leave the Chrome window open and visible. The lane focuses that window
   when it starts a search.

Repeat in more Chrome profiles for more lanes. One lane per profile, each
with its own lane name. Do not also press Run all in a profile that is
working a lane; the lane waits while a local batch is running so the two do
not share a scrape.

## What a lane does

1. Claim the oldest pending job with the highest priority. Claiming sets a
   lease. A heartbeat and every uploaded page renew it.
2. Open `https://www.etsy.com/` in the visible tab if needed.
3. Focus the search box, type the term, and press Search. The service worker
   console and `chrome.storage.session` key `etsyWorkerLane` record
   `search path: search_box`. If the box is not there, the lane opens the
   search URL and logs `search path: url_navigation`.
4. Read the total result count, scroll the page, and upload that page's rows.
5. Follow the next-page link (`pagination_click`) or, if it is missing, the
   search URL for the next page.
6. Mark the job completed. A captcha or block marks it `blocked` and the lane
   pauses for the backoff interval instead of starting another search.

An idle lane checks the queue on the poll interval. Chrome may not wake a
sleeping extension faster than every 30 seconds. That is still inside the
two-minute budget for a newly added term. Realtime, when the publication is
active, wakes the lane sooner. The first batch of rows is the first results
page, not the finished scan.

## Agent commands

```bash
export ETSY_WORKER_URL="https://YOUR_PROJECT.supabase.co"
export ETSY_WORKER_ANON_KEY="your-publishable-anon-key"

node scripts/etsy-worker.mjs add-terms "linen apron" --priority 10 --pages 2
node scripts/etsy-worker.mjs search-now "rush term" --pages 1
node scripts/etsy-worker.mjs status --term "linen apron"
node scripts/etsy-worker.mjs results --term "linen apron" --json
node scripts/etsy-worker.mjs health
node scripts/etsy-worker.mjs requeue
```

`status --term` prints the job state, the lane that claimed it, pages done,
rows landed, the total result count, and the last error.

`results --term --json` prints the rows, including pages already uploaded
while the job is still `processing`.

`search-now` inserts the term at a priority above every other open job so the
next claim takes it. It does not cancel a search a lane is already typing.

Higher `--priority` is claimed first. Adding a term that is already pending
raises its priority and page count instead of creating a second open job.

## Health and stuck jobs

`health` shows counts by status, how many processing jobs have an expired
lease, and each lane's last heartbeat. A lane is `stale` when its heartbeat
is older than 90 seconds.

A lane that dies mid-search leaves the job `processing` until the lease
expires (default 180 seconds, renewed while the lane is uploading). The next
claim, or `requeue`, moves that job back to `pending` if attempts remain
(default 3). After the last attempt it is `failed` with `last_error`
`lease_expired` and is not picked up again. Calling `requeue` twice is safe.

`blocked` jobs are captchas or other stops. They are not returned to the
queue. Add the term again after the block has cleared if you want another
try. The lane itself waits out the captcha backoff before it claims anything
else.

Inspect the live lane without the database: in DevTools on the extension's
service worker, `chrome.storage.session` key `etsyWorkerLane` has the term,
page, search path, rows uploaded, total result count, and last error. The
console line is `[etsy-worker] search path: ...`.

## End-to-end smoke test

This needs a real backend and a visible Chrome window. It is not part of CI.

1. Apply the migration. Start one lane with worker mode enabled and the
   window visible. Confirm `node scripts/etsy-worker.mjs health` lists that
   lane.
2. Enqueue a small search:

   ```bash
   node scripts/etsy-worker.mjs add-terms "linen cross back apron" --priority 50 --pages 1
   ```

3. Within about two minutes on an idle lane, `status --term "linen cross back apron"`
   shows `state: processing` (then `completed`) and `lane:` set to that
   window's lane name. The Chrome window comes forward. The service worker
   log says `search path: search_box` when the search box was used.
4. `results --term "linen cross back apron" --json` returns `total_results`
   and a `listings` array. Rows from page 1 are present as soon as that page
   finishes, before a multi-page job is `completed`.
5. Optional immediate pickup while the lane is idle:

   ```bash
   node scripts/etsy-worker.mjs search-now "wool dryer balls" --pages 1
   ```

   The next claim should be that term.

If status stays `pending` past two minutes, check that worker mode is enabled,
the options save granted host permission, the lane name is set, and the
window was not closed. `health` shows whether the lane's heartbeat is fresh.
