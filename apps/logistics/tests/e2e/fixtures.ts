import { expect, type Page } from "@playwright/test";
import { movements, runs, stops } from "../../lib/store";
import type { DeliveryRun, DeliveryStop } from "../../lib/types";

export const E2E_DATE = "2099-01-15";
export const E2E_PREFIX = "e2e-logistics:";

export async function ensureLogisticsIsRunning(page: Page) {
  const response = await page.request.get("/api/logistics?serviceDate=" + E2E_DATE);
  expect(response.ok(), "Logistics API is not reachable; start the local launcher/emulator services first.").toBeTruthy();
}

export async function cleanupE2EData() {
  const [runSnap, movementSnap, allStopsSnap] = await Promise.all([
    runs().where("serviceDate", "==", E2E_DATE).get(),
    movements().where("serviceDate", "==", E2E_DATE).get(),
    stops().get(),
  ]);
  const batch = runs().firestore.batch();
  const runIds = new Set(runSnap.docs.map((doc) => doc.id));
  // Vehicle-day runs are deterministic and are created automatically by the
  // planner. Include them explicitly so a prior browser run cannot contaminate
  // the isolated E2E day even when its ID does not use the E2E prefix.
  for (const vehicle of ["van-1", "van-2"]) runIds.add(`run:${E2E_DATE}:${vehicle}`);
  for (const doc of runSnap.docs) batch.delete(doc.ref);
  for (const doc of allStopsSnap.docs) {
    const data = doc.data() as { runId?: string };
    if (data.runId && (runIds.has(data.runId) || data.runId.startsWith(E2E_PREFIX))) batch.delete(doc.ref);
  }
  for (const doc of movementSnap.docs) {
    const data = doc.data() as { notes?: string };
    if (doc.id.startsWith(E2E_PREFIX) || data.notes?.startsWith("E2E ")) batch.delete(doc.ref);
  }
  await batch.commit();
}

export function seededRun(id: string, driver = "Franco", status: DeliveryRun["status"] = "planned"): DeliveryRun {
  const now = new Date().toISOString();
  return {
    canonicalId: E2E_PREFIX + id,
    serviceDate: E2E_DATE,
    status,
    driverId: driver.toLowerCase(),
    driverLabel: driver,
    orderedStopIds: [],
    version: 1,
    createdAt: now,
    updatedAt: now,
    audit: [{ action: "e2e-seed", at: now, by: "e2e", version: 1 }],
  };
}

export function seededStop(runId: string, id: string): DeliveryStop {
  const now = new Date().toISOString();
  return {
    canonicalId: E2E_PREFIX + id,
    runId,
    sequence: 1,
    locationOplocId: "e2e-oploc",
    locationLabelSnapshot: "E2E destination",
    requirementRefs: [],
    movementRequestIds: [],
    status: "planned",
    createdAt: now,
    updatedAt: now,
    version: 1,
    audit: [{ action: "e2e-seed", at: now, by: "e2e", version: 1 }],
  };
}
