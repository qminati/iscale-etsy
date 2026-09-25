// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SKIP = new Set(["node_modules", "dist", "coverage", ".git"]);

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) files(path, out);
    else if (/\.(js|mjs|html|md|sql|json|example)$/.test(name) && stat.size < 2_000_000) out.push(path);
  }
  return out;
}

describe("public tree", () => {
  it("does not contain project urls, service-role keys, or jwts", () => {
    const offenders = [];
    for (const path of files(join(process.cwd()))) {
      const text = readFileSync(path, "utf8");
      if (/https:\/\/[a-z0-9]{15,}\.supabase\.co/i.test(text)) offenders.push(path);
      if (/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/.test(text)) offenders.push(path);
      if (/service_role['"]?\s*[:=]\s*['"][^'"]+['"]/.test(text)) offenders.push(path);
    }
    expect(offenders).toEqual([]);
  });
});
