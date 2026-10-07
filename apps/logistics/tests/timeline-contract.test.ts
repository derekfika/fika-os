import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/styles.css", import.meta.url), "utf8");
const adapter = readFileSync(new URL("../lib/projection-dashboard-adapter.ts", import.meta.url), "utf8");
const timeline = readFileSync(new URL("../app/mounted-react-timeline.tsx", import.meta.url), "utf8");
const timelineStyles = readFileSync(new URL("../app/mounted-react-timeline.module.css", import.meta.url), "utf8");

test("mounted timeline retains source-aware move and explicit-window resize semantics", () => {
  assert.match(page, /<MountedReactTimeline/);
  assert.match(page, /onSchedule=\{scheduleStop\}/);
  assert.match(timeline, /snapTimelineMinute/);
  assert.match(timeline, /snapTimelineEndMinute/);
  assert.match(timeline, /directResizeEnabled\(Boolean\(card\.end\)\)/);
  assert.match(timeline, /role="slider"/);
  assert.match(timeline, /aria-valuemax=\{1425\}/);
  assert.match(timeline, /onSchedule\(latest\.card\.sourceRunId/);
  assert.match(timelineStyles, /cursor: move/);
  assert.match(timelineStyles, /resizeHandle/);
});

test("desktop layout gives the schedule the wider surface and retains mobile fallback", () => {
  assert.match(styles, /mock-workspace \{ grid-template-columns: minmax\(280px, 28%\) minmax\(0, 72%\)/);
  assert.match(styles, /@media \(max-width: 1050px\) \{\s*\.real-planner \.mock-workspace \{ grid-template-columns: 1fr; \}/);
  assert.match(timelineStyles, /\.collection[^}]*fika-status-info/);
  assert.match(timelineStyles, /\.attention[^}]*fika-status-danger/);
  assert.match(timelineStyles, /\.axisViewport \{ overflow: auto/);
  assert.match(styles, /\.real-planner \{ overflow-x: hidden; \}/);
});

test("projection dashboard labels are human-facing and do not expose source ids", () => {
  assert.match(adapter, /fulfilmentWorkstream/);
  assert.doesNotMatch(adapter, /sourceLabels: \[job\.sourceType\]/);
  assert.match(adapter, /job\.workstream \|\| fulfilmentWorkstream/);
});

test("active weekday selector remains selected-day navigable without changing week controls", () => {
  assert.match(page, /className="mock-day-cards"/);
  assert.match(page, /aria-pressed=\{day === date\}/);
  assert.match(page, /onClick=\{\(\) => props\.setDate\(day\)\}/);
  assert.match(page, /aria-label="Operational week navigation"/);
  assert.match(page, /aria-label="Previous week"/);
  assert.match(page, /aria-label="Next week"/);
});
