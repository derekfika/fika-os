import type { Transaction } from "firebase-admin/firestore";
import type { LogisticsPrincipal } from "./auth";
import { authorizeLoad, authorizeRun, assertSharedPlannerAccess, authorizeOwnedOrSharedWork } from "./resource-authority";
import { deliveryLoads, logisticsAssignments, runs, stops } from "./store";
import { requireGovernedDriver } from "./driver-authority";

/** Buffer writes until every current AND proposed resource owner is authorized.
 * Authorization reads join the same Firestore transaction, so a concurrent owner
 * change retries the decision. This also covers indirectly changed linked stops.
 */
export async function authorizeTransaction<T>(transaction: Transaction, principal: LogisticsPrincipal, callback: (transaction: Transaction) => Promise<T>, cookie?: string, revalidateDrivers = false) {
  const writes: Array<{ method: "set" | "create" | "update" | "delete"; args: any[] }> = [];
  const proxy = new Proxy(transaction, { get(target, name) {
    if (["set", "create", "update", "delete"].includes(String(name))) return (...args: any[]) => { writes.push({ method: name as any, args }); return proxy; };
    const value = Reflect.get(target, name);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await callback(proxy);
  const snapshots = new Map<string, Promise<any>>();
  const read = (ref: any) => {
    let value = snapshots.get(ref.path);
    if (!value) { value = transaction.get(ref as import("firebase-admin/firestore").DocumentReference).then(snap => snap.exists ? snap.data() : undefined); snapshots.set(ref.path, value); }
    return value;
  };
  const proposed = async (ref: any) => {
    let value = await read(ref);
    for (const write of writes.filter(item => item.args[0].path === ref.path)) {
      value = write.method === "delete" ? undefined : write.method === "update" || write.args[2]?.merge ? { ...value, ...write.args[1] } : write.args[1];
    }
    return value;
  };
  const run = (id: string) => proposed(runs().doc(id));
  const currentOwner = async (id: string) => {
    const owner = await read(runs().doc(id));
    if (!owner) throw Object.assign(new Error("Canonical vehicle owner unavailable."), { status: 409 });
    authorizeRun(principal, owner);
  };
  const jobOwners = new Map<string, Promise<void>>();
  const checkCurrentJob = (id: string) => {
    if (!jobOwners.has(id)) jobOwners.set(id, (async () => {
      const assigned = await transaction.get(logisticsAssignments().where("jobId", "==", id));
      await authorizeOwnedOrSharedWork(principal, assigned.docs, async doc => {
        const load = await read(deliveryLoads().doc(doc.data().loadId));
        if (!load) throw Object.assign(new Error("Canonical load owner unavailable."), { status: 409 });
        await authorizeLoad(principal, load, async runId => read(runs().doc(runId)));
      });
    })());
    return jobOwners.get(id)!;
  };
  const datedStops = new Map<string, Promise<any[]>>();
  const currentRequirementOwners = async (id: string, date: string) => {
    if (!datedStops.has(date)) datedStops.set(date, (async () => {
      const datedRuns = await transaction.get(runs().where("serviceDate", "==", date));
      const snapshots = await Promise.all(datedRuns.docs.map(doc => transaction.get(stops().where("runId", "==", doc.id))));
      return snapshots.flatMap(snapshot => snapshot.docs.map(doc => doc.data()));
    })());
    return (await datedStops.get(date)!).filter(stop => (stop.requirementRefs || []).some((ref: { requirementId: string }) => ref.requirementId === id)).map(stop => stop.runId as string);
  };
  const check = async (path: string, value: any, next: boolean) => {
    if (!value) return;
    const collection = path.split("/")[0];
    const ownerRun = async (id: string) => next ? run(id) : read(runs().doc(id));
    if (collection === "fikaLogisticsDeliveryRunsV1") authorizeRun(principal, value);
    if (collection === "fikaLogisticsDeliveryStopsV1") {
      const owner = await ownerRun(value.runId);
      if (!owner) throw Object.assign(new Error("Canonical vehicle owner unavailable."), { status: 409 });
      authorizeRun(principal, owner);
      if (next) {
        const current = await read(stops().doc(path.split("/")[1]));
        for (const ref of value.requirementRefs || []) if (!(current?.requirementRefs || []).some((item: { requirementId: string }) => item.requirementId === ref.requirementId)) {
          await authorizeOwnedOrSharedWork(principal, await currentRequirementOwners(ref.requirementId, owner.serviceDate), currentOwner);
        }
      }
    }
    if (collection === "fikaLogisticsDeliveryLoadsV1") await authorizeLoad(principal, value, ownerRun);
    if (collection === "fikaLogisticsAssignmentsV1") {
      await checkCurrentJob(value.jobId);
      const load = next ? await proposed(deliveryLoads().doc(value.loadId)) : await read(deliveryLoads().doc(value.loadId));
      if (!load) throw Object.assign(new Error("Canonical load owner unavailable."), { status: 409 });
      await authorizeLoad(principal, load, ownerRun);
    }
    if (collection === "fikaLogisticsJobsV1") {
      await checkCurrentJob(value.id);
      const assigned = await transaction.get(logisticsAssignments().where("jobId", "==", value.id));
      const values = [...assigned.docs.map(doc => doc.data()), ...writes.filter(item => item.args[0].parent.id === "fikaLogisticsAssignmentsV1" && item.args[1]?.jobId === value.id).map(item => item.args[1])];
      if (!values.length) assertSharedPlannerAccess(principal);
      for (const assignment of values) {
        const load = await proposed(deliveryLoads().doc(assignment.loadId)) || await read(deliveryLoads().doc(assignment.loadId));
        if (!load) throw Object.assign(new Error("Canonical load owner unavailable."), { status: 409 });
        await authorizeLoad(principal, load, run);
      }
    }
    if (collection === "fikaLogisticsMovementRequestsV1") {
      const linked = await transaction.get(stops().where("movementRequestIds", "array-contains", value.canonicalId));
      const legacy = await transaction.get(stops().where("movementRequestId", "==", value.canonicalId));
      const values = [...linked.docs, ...legacy.docs].map(doc => doc.data());
      await authorizeOwnedOrSharedWork(principal, values, stop => currentOwner(stop.runId));
      values.push(...writes.filter(item => item.args[0].parent.id === "fikaLogisticsDeliveryStopsV1" && item.args[1]?.movementRequestIds?.includes(value.canonicalId)).map(item => item.args[1]));
      if (!values.length) assertSharedPlannerAccess(principal);
      for (const stop of values) { const owner = await run(stop.runId) || await read(runs().doc(stop.runId)); if (!owner) throw Object.assign(new Error("Canonical vehicle owner unavailable."), { status: 409 }); authorizeRun(principal, owner); }
    }
  };
  for (const ref of new Map(writes.map(write => [write.args[0].path, write.args[0]])).values()) {
    const current = await read(ref);
    const next = await proposed(ref);
    await check(ref.path, current, false);
    await check(ref.path, next, true);
    if (ref.parent.id === "fikaLogisticsDeliveryRunsV1" && current && next && current.status !== next.status && ["ready", "dispatched"].includes(next.status)) {
      const message = "The assigned driver is no longer eligible for this vehicle. Reassign an eligible driver before Ready or Dispatch.";
      if (!next.driverId) throw Object.assign(new Error(message), { status: 422 });
      try { await requireGovernedDriver(next.driverId, next.vehicleId, cookie); }
      catch (error) { if ((error as { status?: number }).status === 422) throw Object.assign(new Error(message), { status: 422 }); throw error; }
      // Validate without rewriting the historical driver/name snapshot.
    }
    if (ref.parent.id === "fikaLogisticsDeliveryRunsV1" && next && (revalidateDrivers || !current || current.driverId !== next.driverId || current.driverLabel !== next.driverLabel || current.vehicleId !== next.vehicleId)) {
      if (next.driverLabel && !next.driverId) throw Object.assign(new Error("A governed driver identity is required."), { status: 422 });
      if (next.driverId) {
        const governed = await requireGovernedDriver(next.driverId, next.vehicleId, cookie);
        Object.assign(next, governed);
        for (const write of writes.filter(item => item.args[0].path === ref.path && item.method !== "delete")) Object.assign(write.args[1], governed);
      }
    }
  }
  for (const write of writes) (transaction[write.method] as any)(...write.args);
  return result;
}
