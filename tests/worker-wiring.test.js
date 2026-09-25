// @vitest-environment node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const background = readFileSync(join(root, "background.js"), "utf8");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const workerPage = readFileSync(join(root, "worker-page.js"), "utf8");

describe("worker mode wiring", () => {
  it("opens a visible Etsy tab and polls on its own alarm", () => {
    expect(background).toContain('const WORKER_POLL_ALARM = "etsy-worker-poll"');
    expect(background).toContain("if (alarm.name === WORKER_POLL_ALARM) onWorkerAlarm()");
    expect(background).toMatch(/chrome\.tabs\.create\(\{\s*url:\s*"https:\/\/www\.etsy\.com\/",\s*active:\s*true\s*\}\)/);
    expect(background).toContain('action: "worker.typeAndSubmit"');
    expect(background).toContain("chrome.storage.session");
    expect(background).not.toMatch(/puppeteer|playwright|--headless/);
  });

  it("keeps the local runner tab in the background", () => {
    expect(background).toMatch(/chrome\.tabs\.create\(\{\s*url:\s*"https:\/\/www\.etsy\.com",\s*active:\s*false\s*\}\)/);
  });

  it("ships worker mode off, with storage only and an optional backend host grant", () => {
    expect(manifest.permissions).toContain("storage");
    expect(manifest.optional_host_permissions).toContain("https://*/*");
    expect(manifest.host_permissions).toEqual(["https://*.etsy.com/*"]);
    expect(manifest.options_ui.page).toBe("options.html");
    expect(workerPage).toContain("typeAndSubmitSearch");
    expect(workerPage).toContain("formatSearchPathLog");
  });
});
