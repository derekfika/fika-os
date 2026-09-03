import assert from "node:assert/strict";
import { test } from "node:test";
import { publishedWeeksFromProjectionIndex } from "../lib/server";

const entry = (serviceDate: string, weekCommencing: string, overrides: Record<string, unknown> = {}) => ({
  oplocId: "oploc:site", serviceDate, weekCommencing, weekEnding: `${weekCommencing.slice(0, 8)}${Number(weekCommencing.slice(8, 10)) + 6}`,
  publicationId: `publication:${weekCommencing}`, projectionVersion: 1, packageVersion: 1, contentHash: `hash:${serviceDate}`,
  freshness: "current" as const, completeness: "complete" as const, sourceVersion: "source:v1", generatedAt: "2026-09-03T09:00:00Z", state: "available" as const, ...overrides,
});

test("projection head exposes current and future published weeks without client fabrication", () => {
  const weeks = publishedWeeksFromProjectionIndex([
    entry("2026-09-07", "2026-09-07"),
    entry("2026-09-14", "2026-09-14"),
    entry("2026-09-21", "2026-09-21", { completeness: "missing" }),
    entry("2026-09-28", "2026-09-28", { state: "withdrawn" }),
  ]);
  assert.deepEqual(weeks.map(week => week.weekCommencing), ["2026-09-14", "2026-09-07"]);
  assert.equal(weeks[0].publicationId, "publication:2026-09-14");
});
