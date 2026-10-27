import assert from "node:assert/strict";
import test from "node:test";
import { stageDriverChangeFromWrites, type BufferedWrite } from "../../lib/driver-change-capture";
import { londonServiceDate } from "../../lib/driver-notifications";

// Staging-scale synthetic day against the real Firestore emulator: how many documents does change capture read per planner write,
// what does it add to transaction latency, and do concurrent edits to Van 1 and Van 2 contend?
const emulatorEnabled = process.env.FIREBASE_PROJECT_ID === "demo-fika-os" && process.env.FIRESTORE_EMULATOR_HOST === "127.0.0.1:8292" && (process.env.FIKA_RUNTIME_MODE || "local") === "local";
const skip = !emulatorEnabled;

const now = new Date();
const today = londonServiceDate(now);
const otherDays = ["2098-01-01", "2098-01-02", "2098-01-03"];
const RUNS_PER_VAN = 6, LOADS_PER_RUN = 5, JOBS_PER_LOAD = 2;

async function seedDay(date: string, prefix: string) {
  const { db } = await import("../../lib/firebase");
  const writer = db.bulkWriter();
  for (const vehicleId of ["van1", "van2"] as const) {
    for (let r = 0; r < RUNS_PER_VAN; r++) {
      const runId = `${prefix}-${vehicleId}-run${r}`;
      writer.set(db.collection("fikaLogisticsDeliveryRunsV1").doc(runId), { canonicalId: runId, serviceDate: date, vehicleId, vehicleLabel: vehicleId, status: "planned", version: 1, orderedStopIds: [`${runId}-stop`], plannedCpuDepartureTime: "09:00", plannedCpuReturnTime: "16:00", audit: [] });
      writer.set(db.collection("fikaLogisticsDeliveryStopsV1").doc(`${runId}-stop`), { canonicalId: `${runId}-stop`, runId, sequence: 1, version: 1, locationLabelSnapshot: "Native", requirementRefs: [], movementRequestIds: [], plannedArrivalTime: "10:00" });
      for (let l = 0; l < LOADS_PER_RUN; l++) {
        const loadId = `${runId}-load${l}`;
        writer.set(db.collection("fikaLogisticsDeliveryLoadsV1").doc(loadId), { id: loadId, serviceDate: date, runId, status: "planned", version: 1, destinationLabelSnapshot: `Site ${l}`, scheduledTime: "10:30" });
        for (let j = 0; j < JOBS_PER_LOAD; j++) {
          const jobId = `${loadId}-job${j}`;
          writer.set(db.collection("fikaLogisticsJobsV1").doc(jobId), { id: jobId, serviceDate: date, version: 1, notes: "", contents: [{ description: "Box", quantity: 10, unit: "box" }] });
          writer.set(db.collection("fikaLogisticsAssignmentsV1").doc(`${jobId}-a`), { id: `${jobId}-a`, jobId, loadId, serviceDate: date });
        }
      }
    }
  }
  await writer.close();
}

async function clearCollections() {
  const { db } = await import("../../lib/firebase");
  for (const name of ["fikaLogisticsDeliveryRunsV1", "fikaLogisticsDeliveryStopsV1", "fikaLogisticsDeliveryLoadsV1", "fikaLogisticsJobsV1", "fikaLogisticsAssignmentsV1", "fikaLogisticsDriverChangeEventsV1"]) {
    const writer = db.bulkWriter();
    for (const doc of (await db.collection(name).get()).docs) writer.delete(doc.ref);
    await writer.close();
  }
}

type Counter = { reads: number; attempts: number };

/** One planner-like edit of a run's departure time, optionally with capture. Counts documents read and transaction attempts. */
async function editRun(runId: string, departure: string, withCapture: boolean, counter: Counter) {
  const { db } = await import("../../lib/firebase");
  const ref = db.collection("fikaLogisticsDeliveryRunsV1").doc(runId);
  await db.runTransaction(async transaction => {
    counter.attempts += 1;
    const counting = new Proxy(transaction, { get(target, name) {
      if (name === "get") return async (arg: never) => { const result = await (target.get as (a: unknown) => Promise<{ docs?: unknown[] }>)(arg); counter.reads += result.docs ? Math.max(1, result.docs.length) : 1; return result; };
      const value = Reflect.get(target, name);
      return typeof value === "function" ? value.bind(target) : value;
    } }) as typeof transaction;
    const snapshot = await counting.get(ref);
    const run = snapshot.data()!;
    const next = { ...run, plannedCpuDepartureTime: departure, version: run.version + 1 };
    const writes: BufferedWrite[] = [{ method: "set", args: [ref, next] }];
    if (withCapture) await stageDriverChangeFromWrites(counting, writes, { action: "update-run-timing", actorId: "load-test", now: now.toISOString() });
    counting.set(ref, next);
  });
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

test("emulator: capture read cost and latency on a staging-scale day, and Van 1 / Van 2 contention", { skip, timeout: 240_000 }, async () => {
  await clearCollections();
  await seedDay(today, "t");
  for (const [index, date] of otherDays.entries()) await seedDay(date, `o${index}`);
  const docsToday = 12 + 12 + 60 + 120 + 120;

  const baseline: Counter = { reads: 0, attempts: 0 }, captured: Counter = { reads: 0, attempts: 0 };
  await editRun("t-van1-run0", "09:05", false, baseline);
  await editRun("t-van1-run0", "09:10", true, captured);
  const timeOf = async (withCapture: boolean, runId: string, n: number) => {
    const samples: number[] = [];
    for (let i = 0; i < n; i++) { const started = performance.now(); await editRun(runId, `10:${String(i).padStart(2, "0")}`, withCapture, { reads: 0, attempts: 0 }); samples.push(performance.now() - started); }
    return median(samples);
  };
  const plainMs = await timeOf(false, "t-van1-run1", 15);
  const captureMs = await timeOf(true, "t-van1-run1", 15);

  // Concurrent edits: Van 1 and Van 2 runs at the same moment, repeated. Attempts above 1 per edit are lock contention retries.
  const contention = { van1: { reads: 0, attempts: 0 }, van2: { reads: 0, attempts: 0 } };
  const rounds = 20;
  const concurrentStart = performance.now();
  for (let i = 0; i < rounds; i++) {
    await Promise.all([editRun("t-van1-run2", `11:${String(i).padStart(2, "0")}`, true, contention.van1), editRun("t-van2-run2", `11:${String(i).padStart(2, "0")}`, true, contention.van2)]);
  }
  const concurrentMs = (performance.now() - concurrentStart) / rounds;
  const baselineContention = { van1: { reads: 0, attempts: 0 }, van2: { reads: 0, attempts: 0 } };
  const baselineStart = performance.now();
  for (let i = 0; i < rounds; i++) {
    await Promise.all([editRun("t-van1-run3", `12:${String(i).padStart(2, "0")}`, false, baselineContention.van1), editRun("t-van2-run3", `12:${String(i).padStart(2, "0")}`, false, baselineContention.van2)]);
  }
  const baselineConcurrentMs = (performance.now() - baselineStart) / rounds;

  const report = {
    documentsOnTodaysDay: docsToday, documentsOnOtherDays: docsToday * otherDays.length,
    readsPerEdit: { withoutCapture: baseline.reads, withCapture: captured.reads },
    medianLatencyMs: { withoutCapture: Math.round(plainMs), withCapture: Math.round(captureMs) },
    concurrentVan1AndVan2: {
      roundsOfTwoSimultaneousEdits: rounds,
      attemptsPerEdit: { withoutCapture: (baselineContention.van1.attempts + baselineContention.van2.attempts) / (2 * rounds), withCapture: (contention.van1.attempts + contention.van2.attempts) / (2 * rounds) },
      msPerRound: { withoutCapture: Math.round(baselineConcurrentMs), withCapture: Math.round(concurrentMs) },
    },
  };
  console.log("CAPTURE_LOAD_REPORT " + JSON.stringify(report));

  // The cost of capture must scale with the runs an edit touches, not with the size of the day.
  assert.ok(captured.reads <= 40, `capture read ${captured.reads} documents for a single-run edit on a ${docsToday}-document day`);
  assert.ok((contention.van1.attempts + contention.van2.attempts) / (2 * rounds) <= 1.25, "concurrent edits to different vans must not contend");
});
