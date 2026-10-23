import test from "node:test";
import assert from "node:assert/strict";
import {
  dayCollections,
  dayProductionPrintHtml,
} from "../app/ui/day-production-print";
import { collectionTime } from "../app/ui/kitchen-print";
import { loadWholeDay } from "../app/ui/whole-day-production";
import { readFileSync } from "node:fs";
import type { ProductionOrder } from "../lib/production-types";
const day = "2026-10-23";
const order = (id: string, version = 1) =>
  ({
    canonicalId: id,
    version,
    serviceDate: day,
    status: "planned",
    requiredBy: day + "T00:00:00Z",
    serviceWindow: { startTime: "00:00" },
    destinationLabel: id,
    lines: [
      {
        canonicalId: id + ":line",
        itemName: "Dish",
        customerQuantity: 4,
        customerUnit: "portions",
      },
    ],
  }) as ProductionOrder;
test("whole-day print deduplicates latest versions before excluding inactive work and sorts deterministically", () => {
  const a = order("a"),
    b = order("b"),
    cancelled = { ...a, version: 2, status: "cancelled" as const };
  const result = dayCollections(
    [
      a,
      b,
      cancelled,
      { ...order("old"), supersededBy: "b" },
      { ...order("tomorrow"), serviceDate: "2026-10-24" },
    ],
    day,
  );
  assert.deepEqual(
    result.map((o) => o.canonicalId),
    ["b"],
  );
  assert.equal(collectionTime(a), "Time TBC");
  assert.equal(dayCollections([b, a], day)[0].canonicalId, "a");
});
test("print HTML preserves every line and empty checkbox and has no interactive collection print buttons", () => {
  const big = {
    ...order("long"),
    lines: Array.from({ length: 100 }, (_, i) => ({
      ...order("long").lines[0],
      canonicalId: "line:" + i,
      itemName: "Dish " + i,
    })),
  };
  const html = dayProductionPrintHtml([big], day);
  assert.equal((html.match(/data-line-id=/g) || []).length, 100);
  assert.match(html, /Dish 99/);
  assert.match(html, /dashed/);
  assert.match(html, /Packed by/);
  assert.doesNotMatch(html, /<button|<script/);
  const source = readFileSync(
    new URL("../app/ui/KitchenRunSheet.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(source.split("Print day's production").length - 1, 1);
  assert.doesNotMatch(source, /Print collection sheet/);
});
test("whole-day reader ignores filters, requests exact date/all scopes afresh and rejects incomplete or wrong-day results", async () => {
  const projection = {
    serviceDate: day,
    rebuiltAt: day + "T12:00Z",
    summary: { orders: 1 },
    orders: [
      {
        id: "a",
        serviceDate: day,
        version: 1,
        quantities: [],
        attention: [],
        status: "planned",
        requiredBy: day + "T12:00Z",
      },
    ],
  };
  const fetcher = (async (url: unknown, init?: RequestInit) => {
    assert.equal(
      url,
      `/api/production?projection=1&serviceDate=${day}&scope=all`,
    );
    assert.equal(init?.cache, "no-store");
    return Response.json({ projection });
  }) as typeof fetch;
  assert.equal((await loadWholeDay(day, fetcher)).length, 1);
  for (const invalid of [
    { projection: { ...projection, serviceDate: "2026-10-24" } },
    { projection: { ...projection, summary: { orders: 2 } } },
    { projection, partial: true },
    { projection, nextPageToken: "more" },
  ])
    await assert.rejects(
      loadWholeDay(day, (async () => Response.json(invalid)) as typeof fetch),
      /incomplete/,
    );
  await assert.rejects(loadWholeDay("", fetcher), /Select a production date/);
});
