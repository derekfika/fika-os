import assert from "node:assert/strict";
import { test } from "node:test";
import type { FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import { assertMenuProductionAuthority } from "../lib/upstream";

const baseRequirement = (sourceDomain:FulfilmentRequirement["sourceDomain"] = "menu-planning", workstream?:FulfilmentRequirement["workstream"]):FulfilmentRequirement => ({
  canonicalId: "fulfilment-requirement:menu-planning:source-day:oploc:test",
  entityType: "Fulfilment Requirement", schemaVersion: "0.1.0", version: 1,
  sourceDomain, sourceEntityId: "source-day:test", sourceVersion: 4,
  ...(workstream ? { workstream } : {}),
  destinationOplocId: "oploc:test", destinationLabelSnapshot: "UAT site", serviceDate: "2027-01-04",
  lines: [], status: "ready_for_planning", createdAt: "now", createdBy: "test", updatedAt: "now", updatedBy: "test", audit: [], idempotencyKey: "test:v4",
});
const order = (requirement:FulfilmentRequirement, status = "menu_available", sourceVersion = requirement.sourceVersion) => ({
  canonicalId: "production-order:v1:menu-planning:source-day:test:oploc:test", origin: "menu_planning", status,
  version: 1, sourceVersion, sourceEntityId: requirement.sourceEntityId,
  destinationOplocId: requirement.destinationOplocId, serviceDate: requirement.serviceDate,
});
async function withFetch(fetcher:(url:string)=>Response | Promise<Response>, callback:()=>Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async input => fetcher(String(input))) as typeof fetch;
  try { await callback(); } finally { globalThis.fetch = original; }
}

test("withdrawal during the projection propagation window blocks a still-ready menu requirement", async () => {
  const requirement = baseRequirement();
  await withFetch(() => Response.json({ order: order(requirement, "cancelled") }), async () => {
    await assert.rejects(() => assertMenuProductionAuthority([requirement]), (error:unknown) => {
      assert.equal((error as { status?:number }).status, 409);
      assert.match((error as Error).message, /withdrawn or superseded/);
      return true;
    });
  });
});

test("unavailable Hub source authority fails closed", async () => {
  await withFetch(() => new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }), async () => {
    await assert.rejects(() => assertMenuProductionAuthority([baseRequirement()]), (error:unknown) => (error as { status?:number }).status === 503);
  });
});

test("a current active Menu Planning order remains eligible", async () => {
  const requirement = baseRequirement();
  await withFetch(() => Response.json({ order: order(requirement) }), async () => {
    await assert.doesNotReject(() => assertMenuProductionAuthority([requirement]));
  });
});

test("source version drift blocks stale menu actions", async () => {
  const requirement = baseRequirement();
  await withFetch(() => Response.json({ order: order(requirement, "menu_available", 5) }), async () => {
    await assert.rejects(() => assertMenuProductionAuthority([requirement]), (error:unknown) => (error as { status?:number }).status === 409);
  });
});

test("Hospitality and Grab & Go requirements do not call the Menu Planning authority", async () => {
  const requirements = [baseRequirement("cpu-production", "Hospitality"), baseRequirement("grab-and-go", "Grab & Go")];
  let calls = 0;
  await withFetch(() => { calls++; return new Response("unavailable", { status: 503 }); }, async () => {
    await assert.doesNotReject(() => assertMenuProductionAuthority(requirements));
  });
  assert.equal(calls, 0);
});
