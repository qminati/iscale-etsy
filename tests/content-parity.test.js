import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";

// passive.js can't import ES modules, so it hand-mirrors src/core logic.
// content.js is a module content script and imports the canonical parser.

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, "..", p), "utf8");

const contentSrc = read("content.js");
const passiveSrc = read("passive.js");
const searchResultsSrc = read("src/core/search-results.js");
const extractListingSrc = read("src/core/extract-listing.js");

function bothContain(name, a, b, signatures) {
  describe(name, () => {
    for (const sig of signatures) {
      it(`both contain ${JSON.stringify(sig)}`, () => {
        expect(a, "canonical missing").toContain(sig);
        expect(b, "copy missing/drifted").toContain(sig);
      });
    }
  });
}

describe("content.js search parse uses the canonical module", () => {
  it("imports parseSearchResults and detectSearchBlock", () => {
    expect(contentSrc).toContain('import { detectSearchBlock, parseSearchResults } from "./src/core/search-results.js"');
    expect(contentSrc).not.toContain("function parseSearchResults(");
    expect(searchResultsSrc).toContain("export function parseSearchResults");
    expect(searchResultsSrc).toContain("export function detectSearchBlock");
  });
});

bothContain("passive.js listing capture mirrors extract-listing.js", extractListingSrc, passiveSrc, [
  "data-favorite-listing-id",
  "favorites?|people have this",
  "data-appears-event-data",
  "listing_rating_count",
  "be the first to review this item",
  "digital_delivery",
  "shipping_and_returns",
  "application/ld+json",
  "AggregateOffer",
  "jsonld_has_shipping_origin",
  "digitalVotes >= 2",
  "physicalVotes >= 2",
  // Fields realigned in 5.10.8 — passive.js had drifted and dropped these.
  "This item is unavailable",
  "product_unavailable",
  "og:price:amount",
  "parseCurrency",
  "scarcity_signal",
]);
