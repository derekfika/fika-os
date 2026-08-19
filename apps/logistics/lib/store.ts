import { db } from "./firebase";
import type { DeliveryRun, DeliveryStop, MovementRequest } from "./types";
const runs = () => db.collection("fikaLogisticsDeliveryRunsV1"); const stops = () => db.collection("fikaLogisticsDeliveryStopsV1"); const movements = () => db.collection("fikaLogisticsMovementRequestsV1");
export async function listState() { const [runSnap, stopSnap, movementSnap] = await Promise.all([runs().get(), stops().get(), movements().get()]); return { runs:runSnap.docs.map(d=>d.data() as DeliveryRun), stops:stopSnap.docs.map(d=>d.data() as DeliveryStop), movements:movementSnap.docs.map(d=>d.data() as MovementRequest) }; }
export async function saveRun(run:DeliveryRun) { await runs().doc(run.canonicalId).set(run); return run; }
export async function saveStop(stop:DeliveryStop) { await stops().doc(stop.canonicalId).set(stop); return stop; }
export async function saveMovement(movement:MovementRequest) { await movements().doc(movement.canonicalId).set(movement); return movement; }
