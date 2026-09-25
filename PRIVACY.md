# Privacy

iScale Etsy is local-first.

## What Stays Local

- Search terms entered into the popup.
- Discovered Etsy listing URLs.
- Scraped listing data.
- Imported CSV contents.
- Exported CSV files.
- Job history and local settings.

Data is stored in Chrome's local browser storage through IndexedDB.

## What Is Not Included

This public edition does not include:

- a hosted database of its own
- account login
- cloud sync
- a bundled Supabase project, URL, or key
- private iScaleLabs production endpoints
- telemetry or analytics

## Optional worker mode

Worker mode is off by default. While it is off, the extension does not contact
a backend and does not write lane state.

If you turn it on in the extension options, you supply the backend URL and
publishable key. The lane then sends the search term it claimed and the
listing fields it scraped (title, shop, price, badges, tags, image, URL,
position, page, and the search's total result count) to that backend. The key
stays in your browser's local IndexedDB settings. Live lane progress is kept
in `chrome.storage.session`, which Chrome clears when the browser session
ends. That record does not include the key.

## CSV Files

CSV imports are parsed in your browser. CSV exports are generated in your
browser. The extension does not upload CSV files to a server.

If you enable auto-download, the extension writes CSV snapshots to your local
Downloads folder (or a subfolder you choose) automatically as listings
accumulate. This is still entirely local — nothing is transmitted anywhere.

## Etsy Pages

The extension runs on Etsy search and listing pages so it can collect the data
shown in your browser. You are responsible for using the tool in a way that
complies with Etsy's terms and applicable laws.
