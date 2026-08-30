import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Ad Hoc current-window discovery is date bounded rather than first-page filtering", async () => {
  const service = await readFile(new URL("../lib/ad-hoc-service.ts", import.meta.url), "utf8");
  assert.match(service, /where\("serviceDate", ">=", week\)/);
  assert.match(service, /where\("serviceDate", "<", endExclusive\)/);
  assert.match(service, /limit\(200\)/);
  assert.doesNotMatch(service, /orderBy\("serviceDate", "asc"\)\.limit\(200\)\.get\(\); return .*filter/);
});

test("Ad Hoc known requests use direct IDs and read diagnostics are opt-in", async () => {
  const service = await readFile(new URL("../lib/ad-hoc-service.ts", import.meta.url), "utf8");
  const diagnostics = await readFile(new URL("../lib/ad-hoc-read-budget.ts", import.meta.url), "utf8");
  assert.match(service, /collection\(\)\.doc\(stableDocumentId\(id\)\)\.get\(\)/);
  assert.match(service, /stage: "known_request_lookup"/);
  assert.match(diagnostics, /AD_HOC_PRODUCTION_READ_BUDGET/);
  assert.doesNotMatch(diagnostics, /db\.collection|\.set\(|\.add\(/);
});

test("Ad Hoc UI has no idle polling and selected checker reads one request", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const checker = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /setInterval|setTimeout/);
  assert.doesNotMatch(checker, /setInterval|setTimeout/);
  assert.match(checker, /api\/requests\?id=/);
});
