import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("hosted CPU middleware returns a public CPU origin rather than App Hosting's internal origin", () => {
  const source = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
  assert.match(source, /CPU_PUBLIC_BASE_URL \|\| process\.env\.CPU_PRODUCTION_BASE_URL/);
  assert.match(source, /publicRequestUrl\(request\)\.href/);
  assert.doesNotMatch(source, /returnTo.*request\.nextUrl\.href/);
});
