import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../../../", import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), "utf8");
}

test("shared FIKA tokens expose the semantic UI foundation", async () => {
  const tokens = await source("shared/fika/tokens.css");
  for (const token of ["--fika-surface-page", "--fika-text-primary", "--fika-action-primary", "--fika-status-success", "--fika-focus-ring", "--fika-font-body"]) {
    assert.match(tokens, new RegExp(token.replaceAll("-", "\\-")));
  }
});

test("Menu Planning loads governed fonts before app styles and keeps telemetry ownership clear", async () => {
  const layout = await source("apps/menu-planning/app/layout.tsx");
  const fonts = await source("apps/menu-planning/app/fonts.css");
  const workspace = await source("apps/menu-planning/app/rolling-menu-workspace.tsx");
  const admission = await source("apps/menu-planning/components/admission-error.module.css");
  assert.match(layout, /import "\.\/fonts\.css";/);
  assert.match(fonts, /font-family:\s*"FIKA Vim"/);
  assert.match(fonts, /font-family:\s*"FIKA Gilroy"/);
  assert.match(fonts, /font-display:\s*swap/);
  assert.doesNotMatch(workspace, /fontFamily:\s*["']Gilroy/);
  assert.doesNotMatch(admission, /font-family:\s*Arial/i);
  assert.doesNotMatch(workspace, /reportAllChanges/);
});

test("importer reference screen stays light, semantic and keyboard-visible", async () => {
  const css = await source("apps/menu-planning/app/import-menu-week.css");
  const page = await source("apps/menu-planning/app/import-menu-week/page.tsx");
  assert.match(css, /--fika-surface-page/);
  assert.match(css, /--fika-action-primary/);
  assert.match(css, /:focus-visible/);
  assert.doesNotMatch(`${css}\n${page}`, /#102019|#182923|#22372f|#0b1511|#4df7c2/i);
  assert.doesNotMatch(`${css}\n${page}`, /color:\s*["']?#(?:8ee8c5|b7f5de)/i);
  assert.match(page, /multiple|drop|Choose Excel files|drag/i);
  assert.match(page, /role="dialog"/);
  assert.match(page, /role="progressbar"/);
  assert.match(page, /Files checked/);
  assert.match(page, /Menu days parsed/);
  assert.match(page, /Matched automatically/);
  assert.match(page, /0 new Dish Library items were created/);
  assert.match(page, /Affected workbook or week/);
  assert.match(css, /import-progress-backdrop/);
});

test("UI governance points user-facing work to the style guide", async () => {
  const agents = await source("AGENTS.md");
  const guide = await source("docs/STYLE-GUIDE.md");
  assert.match(agents, /docs\/STYLE-GUIDE\.md/);
  assert.match(agents, /Style Guide compliance: PASS/);
  assert.match(guide, /4\.5:1/);
  assert.match(guide, /3:1/);
  assert.match(guide, /190px/);
  assert.match(guide, /around 560px/);
  assert.match(guide, /0 new Dish Library items created/);
  assert.match(guide, /Ignore all 255 shown/);
  assert.match(guide, /44–52px/);
  assert.match(guide, /shared semantic FIKA OS tokens/);
  assert.match(guide, /Typography/);
  assert.match(guide, /File upload and review/);
  assert.match(guide, /Do and don't/);
});
