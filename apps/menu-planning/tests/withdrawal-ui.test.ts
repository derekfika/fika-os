import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Week Planner recovers an older current publication before rendering withdrawal", async () => {
  const source = await readFile(new URL("../app/rolling-menu-workspace.tsx", import.meta.url), "utf8");
  assert.match(source, /currentPublicationId/);
  assert.match(source, /publications\?publicationId=/);
  assert.match(source, /publication\.publicationId === currentPublicationId/);
  assert.match(source, /hasPublishedWeek && currentPublication/);
});
