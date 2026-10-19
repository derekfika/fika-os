import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSerialQueue } from "../app/lib/serial-command-queue";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("commands run strictly one at a time, in request order, each seeing the revision the previous one returned", async () => {
  const run = createSerialQueue();
  let revision = "r0";
  const seen: string[] = [];
  const events: string[] = [];
  const save = (name: string, duration: number) => run(async () => {
    events.push(`start:${name}`);
    seen.push(`${name}@${revision}`);
    await delay(duration);
    revision = `after-${name}`;
    events.push(`end:${name}`);
    return name;
  });
  // The first save is slow; the next two are requested while it is still in flight (the real-world "pick three saved menu items" case).
  const results = await Promise.all([save("A", 40), save("B", 5), save("C", 5)]);
  assert.deepEqual(results, ["A", "B", "C"]);
  assert.deepEqual(events, ["start:A", "end:A", "start:B", "end:B", "start:C", "end:C"], "no overlap");
  assert.deepEqual(seen, ["A@r0", "B@after-A", "C@after-B"], "no two commands share a stale revision");
});

test("a failed command does not block the ones queued behind it", async () => {
  const run = createSerialQueue();
  const failed = run(async () => { throw new Error("boom"); });
  const ok = run(async () => "next");
  await assert.rejects(failed, /boom/);
  assert.equal(await ok, "next");
});

test("the allergen editor serialises plan commands through the queue, threads the revision via a ref, and disables the saved-item picker while busy", () => {
  const component = readFileSync(new URL("../app/ui/HospitalityAllergenDetail.tsx", import.meta.url), "utf8");
  assert.match(component, /createSerialQueue\(\)/);
  assert.match(component, /runSerialised\(\(\) => planCommandNow\(action, extra, menuItemsOverride\)\)/);
  assert.match(component, /expectedRevision: planRevisionRef\.current,/);
  assert.match(component, /planRevisionRef\.current = value; setPlanRevision\(value\)/);
  assert.match(component, /disabled=\{busy \|\| reviewLockedByAuthority\}\s*\r?\n\s*value=\{sub\.productionItemId \|\| ""\}/);
});
