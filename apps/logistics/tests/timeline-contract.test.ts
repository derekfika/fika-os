import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/styles.css", import.meta.url), "utf8");
const adapter = readFileSync(new URL("../lib/projection-dashboard-adapter.ts", import.meta.url), "utf8");

test("DayPilot keeps true short event geometry and supported interaction semantics", () => {
  assert.match(page, /cellDuration=\{15\}/);
  assert.match(page, /addClockMinutes\(start, 15\)/);
  assert.match(page, /eventHeight=\{Math\.max\(56/);
  assert.match(page, /eventTextWrappingEnabled=\{false\}/);
  assert.match(page, /snapToGrid=\{true\}/);
  assert.match(page, /onEventMoved=/);
  assert.match(page, /onEventResized=/);
  assert.match(page, /timelineEventAreaHtml/);
  assert.match(page, /timelineEventTooltip/);
});

test("desktop layout gives the schedule the wider surface and retains mobile fallback", () => {
  assert.match(styles, /mock-workspace \{ grid-template-columns: minmax\(280px, 28%\) minmax\(0, 72%\)/);
  assert.match(styles, /@media \(max-width: 1050px\) \{\s*\.real-planner \.mock-workspace \{ grid-template-columns: 1fr; \}/);
  assert.match(styles, /fika-event-label[^}]*width: 118px/);
});

test("projection dashboard labels are human-facing and do not expose source ids", () => {
  assert.match(adapter, /fulfilmentWorkstream/);
  assert.doesNotMatch(adapter, /sourceLabels: \[job\.sourceType\]/);
  assert.match(adapter, /job\.workstream \|\| fulfilmentWorkstream/);
});

