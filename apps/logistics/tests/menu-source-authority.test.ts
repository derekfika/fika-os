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
const publicationId = "menu-publication:week-2027-01-04";
const publicationDayId = `${publicationId}:source-day:test:v4`;
const order = (requirement:FulfilmentRequirement, status = "menu_available", sourceVersion = requirement.sourceVersion) => ({
  canonicalId: "production-order:v1:menu-planning:source-day:test:oploc:test", origin: "menu_planning", status,
  version: 1, sourceVersion, sourceEntityId: requirement.sourceEntityId,
  sourcePublicationId: publicationId, sourcePublicationDayId: publicationDayId, sourceContentHash: "content-hash-v4",
  destinationOplocId: requirement.destinationOplocId, serviceDate: requirement.serviceDate,
});
async function withFetch(fetcher:(url:string)=>Response | Promise<Response>, callback:()=>Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async input => fetcher(String(input))) as typeof fetch;
  try { await callback(); } finally { globalThis.fetch = original; }
}

const publication = (status = "published") => ({ publication: {
  publicationId, sourceWeekId: "week-2027-01-04", publicationStatus: "published",
  days: [{ publicationDayId, sourceDayId: "source-day:test", date: "2027-01-04", version: 4, status, contentHash: "content-hash-v4", entries: [{ allocations: [{ destinationId: "oploc:test" }] }] }],
} });

test("withdrawal during the projection propagation window blocks a still-ready menu requirement", async () => {
  const requirement = baseRequirement();
  await withFetch(url => url.includes("/api/production?") ? Response.json({ order: order(requirement) }) : Response.json(publication("withdrawn")), async () => {
    await assert.rejects(() => assertMenuProductionAuthority([requirement]), (error:unknown) => {
      assert.equal((error as { status?:number }).status, 409);
      assert.match((error as Error).message, /withdrawn, superseded or inconsistent/);
      return true;
    });
  });
});

test("Hub still active while Menu Planning has withdrawn the canonical publication day blocks assignment", async () => {
  const requirement = baseRequirement();
  let hubReads = 0;
  await withFetch(url => { if (url.includes("/api/production?")) { hubReads++; return Response.json({ order: order(requirement) }); } return Response.json(publication("withdrawn")); }, async () => {
    await assert.rejects(() => assertMenuProductionAuthority([requirement]), (error:unknown) => {
      assert.equal((error as { status?:number }).status, 409);
      assert.match((error as Error).message, /withdrawn, superseded or inconsistent/);
      return true;
    });
  });
  assert.equal(hubReads, 1);
});

test("unavailable Hub source authority fails closed", async () => {
  await withFetch(() => new Response(JSON.stringify({ error: "unavailable" }), { status: 503 }), async () => {
    await assert.rejects(() => assertMenuProductionAuthority([baseRequirement()]), (error:unknown) => (error as { status?:number }).status === 503);
  });
});

test("a current active Menu Planning order remains eligible", async () => {
  const requirement = baseRequirement();
  await withFetch(url => url.includes("/api/production?") ? Response.json({ order: order(requirement) }) : Response.json(publication()), async () => {
    await assert.doesNotReject(() => assertMenuProductionAuthority([requirement]));
  });
});

test("a current active Delivered-In requirement resolves publication day through its Production Order lineage", async () => {
  const productionOrderId = "production-order:v1:menu-planning:source-day:test:oploc:test";
  const requirement:FulfilmentRequirement = {
    ...baseRequirement("cpu-production", "Delivered-In"),
    canonicalId: "fulfilment-requirement:cpu-production:production-order:v1:menu-planning:source-day:test:oploc:test:oploc:test",
    sourceEntityId: productionOrderId,
    sourceVersion: 1,
  };
  const canonicalOrder = { ...order(requirement, "menu_available", 1), sourceEntityId: "source-day:test" };
  const publicationWithCurrentDay = { ...publication(), publication: { ...publication().publication, days: [{ ...publication().publication.days[0], version: 1 }] } };
  await withFetch(url => url.includes("/api/production?") ? Response.json({ order: canonicalOrder }) : Response.json(publicationWithCurrentDay), async () => {
    await assert.doesNotReject(() => assertMenuProductionAuthority([requirement]));
  });
});

test("source version drift blocks stale menu actions", async () => {
  const requirement = baseRequirement();
  await withFetch(url => url.includes("/api/production?") ? Response.json({ order: order(requirement, "menu_available", 5) }) : Response.json(publication()), async () => {
    await assert.rejects(() => assertMenuProductionAuthority([requirement]), (error:unknown) => (error as { status?:number }).status === 409);
  });
});

test("a missing expected requirement cannot collapse into an empty authority check", async () => {
  let calls = 0;
  await withFetch(() => { calls++; return Response.json({}); }, async () => {
    await assert.rejects(() => assertMenuProductionAuthority([], undefined, [baseRequirement().canonicalId]), (error:unknown) => {
      assert.equal((error as { status?:number }).status, 503);
      assert.match((error as Error).message, /Expected fulfilment authority is missing/);
      return true;
    });
  });
  assert.equal(calls, 0);
});

test("Hospitality and Grab & Go requirements do not call the Menu Planning authority", async () => {
  const requirements = [baseRequirement("cpu-production", "Hospitality"), baseRequirement("grab-and-go", "Grab & Go")];
  let calls = 0;
  await withFetch(() => { calls++; return new Response("unavailable", { status: 503 }); }, async () => {
    await assert.doesNotReject(() => assertMenuProductionAuthority(requirements));
  });
  assert.equal(calls, 0);
});
