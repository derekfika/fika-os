import { createHash } from "node:crypto";
import { db } from "./firebase";

export const PUSH_SUBSCRIPTIONS = "fikaLogisticsPushSubscriptionsV1";
const NOTICES = "fikaLogisticsDriverNotificationsV1";
export const MAX_SUBSCRIPTIONS_PER_VEHICLE = 10;
/** A push that has not been attempted within this long of the notice being created is no longer useful, so it is never sent late. */
export const PUSH_MAX_AGE_MS = 15 * 60_000;
const CLAIM_STALE_MS = 2 * 60_000;
export const MAX_PUSH_ATTEMPTS = 3;
const TEST_MIN_INTERVAL_MS = 20_000;

export type PushVehicle = "van1" | "van2";
/**
 * scope: the worker registration this subscription belongs to. 'van1' / 'van2' are per-van registrations (the Android-attributed
 * path). Subscriptions created before per-van scopes have no scope and are treated as 'shared' (the legacy /mobile/ worker).
 * replaces: the legacy subscription this one takes over from. verified: a verification push was accepted for this endpoint.
 * supersededBy: a verified replacement now delivers instead, so this legacy subscription must never be sent to again.
 */
export type PushScope = PushVehicle | "shared";
export type StoredSubscription = { id: string; vehicleId: PushVehicle; endpoint: string; p256dh: string; auth: string; scope?: PushScope; replaces?: string; verified?: boolean; supersededBy?: string };
export type NoticeForPush = { id: string; vehicleId: PushVehicle; kind: string; title: string; pushBody: string; priority: "normal" | "high"; serviceDate: string; runId: string; createdAt: string };

const subscriptions = () => db.collection(PUSH_SUBSCRIPTIONS);
const notices = () => db.collection(NOTICES);
export const subscriptionId = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex");

/**
 * Bind a browser push subscription to ONE vehicle. The vehicle comes from the signed PIN session, never the request. If the same
 * browser later signs in as the other van, the subscription moves to that van (latest wins), so it can never receive both.
 */
export async function upsertSubscription(vehicleId: PushVehicle, subscription: { endpoint: string; p256dh: string; auth: string }, userAgent: string, now: Date, scope: PushVehicle, replacesEndpoint?: string) {
  const id = subscriptionId(subscription.endpoint);
  const ref = subscriptions().doc(id);
  const replacesId = replacesEndpoint ? subscriptionId(replacesEndpoint) : undefined;
  // A re-registration keeps an existing verification; it only resets when the endpoint changes hands or scope.
  const { created, verified } = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const existing = snapshot.exists ? snapshot.data() as StoredSubscription : undefined;
    const kept = Boolean(existing && existing.vehicleId === vehicleId && existing.scope === scope && existing.verified === true);
    transaction.set(ref, { vehicleId, scope, endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth, userAgent: userAgent.slice(0, 160), updatedAt: now.toISOString(), failureCount: 0, verified: kept, ...(replacesId ? { replaces: replacesId } : {}) }, { merge: true });
    return { created: !snapshot.exists, verified: kept };
  });
  // Bound the number of devices per van: drop the least recently updated beyond the cap.
  const all = await subscriptions().where("vehicleId", "==", vehicleId).get();
  const overflow = all.docs.map(doc => ({ id: doc.id, at: String(doc.data().updatedAt ?? "") })).sort((a, b) => b.at.localeCompare(a.at)).slice(MAX_SUBSCRIPTIONS_PER_VEHICLE);
  await Promise.all(overflow.map(item => subscriptions().doc(item.id).delete()));
  return { id, created, verified, devices: Math.min(all.size, MAX_SUBSCRIPTIONS_PER_VEHICLE) };
}

/**
 * A verification push was accepted for this endpoint. Only now does a van-scoped replacement take over from the legacy subscription
 * it names, and only if that legacy subscription belongs to the same van and has not already been superseded.
 */
export async function markVerified(id: string, now: Date): Promise<{ legacySuperseded: boolean }> {
  const ref = subscriptions().doc(id);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return { legacySuperseded: false };
    const current = snapshot.data() as StoredSubscription;
    let legacyRef: FirebaseFirestore.DocumentReference | undefined;
    let legacy: StoredSubscription | undefined;
    if (current.replaces) {
      legacyRef = subscriptions().doc(current.replaces);
      const legacySnapshot = await transaction.get(legacyRef);
      legacy = legacySnapshot.exists ? legacySnapshot.data() as StoredSubscription : undefined;
    }
    transaction.set(ref, { verified: true, verifiedAt: now.toISOString() }, { merge: true });
    const retire = Boolean(legacyRef && legacy && legacy.vehicleId === current.vehicleId && (!legacy.scope || legacy.scope === "shared") && !legacy.supersededBy);
    if (retire && legacyRef) transaction.set(legacyRef, { supersededBy: id, supersededAt: now.toISOString() }, { merge: true });
    return { legacySuperseded: retire };
  });
}

/**
 * Subscriptions that may receive a push right now. A superseded legacy subscription never does. A van-scoped replacement that has not
 * yet been verified does not either, so during migration a device receives exactly one copy: the legacy one until the replacement is
 * proven, then the replacement alone.
 */
export const isSendable = (item: StoredSubscription) => !item.supersededBy && !(item.scope && item.scope !== "shared" && item.replaces && item.verified !== true);

/** Remove one subscription, only if it belongs to the calling vehicle. */
export async function removeSubscription(vehicleId: PushVehicle, endpoint: string): Promise<boolean> {
  const ref = subscriptions().doc(subscriptionId(endpoint));
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.data()?.vehicleId !== vehicleId) return false;
    transaction.delete(ref);
    return true;
  });
}

export async function subscriptionsFor(vehicleId: PushVehicle): Promise<StoredSubscription[]> {
  const snapshot = await subscriptions().where("vehicleId", "==", vehicleId).get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as Omit<StoredSubscription, "id">) })).filter(item => item.vehicleId === vehicleId && isSendable(item));
}

export async function countSubscriptions(vehicleId: PushVehicle): Promise<number> {
  const aggregate = await subscriptions().where("vehicleId", "==", vehicleId).count().get();
  return aggregate.data().count;
}

export const deleteSubscription = (id: string) => subscriptions().doc(id).delete();
export async function recordSubscriptionResult(id: string, ok: boolean, at: Date, error?: string) {
  const ref = subscriptions().doc(id);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    if (ok) transaction.set(ref, { lastSuccessAt: at.toISOString(), failureCount: 0, lastError: null }, { merge: true });
    else transaction.set(ref, { failureCount: Number(snapshot.data()?.failureCount ?? 0) + 1, lastError: (error ?? "send failed").slice(0, 200), lastFailureAt: at.toISOString() }, { merge: true });
  });
}

/**
 * Claim a notice for sending so overlapping processors and the recovery job never push the same notice twice. Only a notice still
 * 'pending' (or whose earlier claim went stale) can be claimed; the claim counts an attempt.
 */
export async function claimNoticeForPush(noticeId: string, now: Date): Promise<NoticeForPush | undefined> {
  const ref = notices().doc(noticeId);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return undefined;
    const data = snapshot.data() as NoticeForPush & { pushStatus?: string; pushClaimedAt?: string; pushAttempts?: number };
    const claimable = data.pushStatus === "pending" || (data.pushStatus === "sending" && Date.now() - Date.parse(data.pushClaimedAt ?? "") > CLAIM_STALE_MS);
    if (!claimable) return undefined;
    transaction.set(ref, { pushStatus: "sending", pushClaimedAt: now.toISOString(), pushAttempts: Number(data.pushAttempts ?? 0) + 1 }, { merge: true });
    return { id: snapshot.id, vehicleId: data.vehicleId, kind: data.kind, title: data.title, pushBody: data.pushBody, priority: data.priority, serviceDate: data.serviceDate, runId: data.runId, createdAt: data.createdAt };
  });
}

export async function finishNoticePush(noticeId: string, status: "sent" | "none" | "pending" | "failed" | "expired", summary: { sent?: number; removed?: number; failed?: number }, now: Date) {
  await notices().doc(noticeId).set({ pushStatus: status, pushFinishedAt: now.toISOString(), pushSummary: summary }, { merge: true });
}

export async function noticePushAttempts(noticeId: string): Promise<number> {
  const snapshot = await notices().doc(noticeId).get();
  return Number(snapshot.data()?.pushAttempts ?? 0);
}

/** Notices still waiting for their push (recovery). Equality filter only, so no composite index; bounded by the caller. */
export async function listPendingPushNoticeIds(limit: number): Promise<string[]> {
  const snapshot = await notices().where("pushStatus", "==", "pending").limit(limit).get();
  return snapshot.docs.map(doc => doc.id);
}

/** At most one test push per van every 20 seconds (a control document, not a subscription). */
export async function claimTestPush(vehicleId: PushVehicle, now: Date): Promise<boolean> {
  const ref = subscriptions().doc(`_test:${vehicleId}`);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const last = Date.parse(String(snapshot.data()?.lastTestAt ?? ""));
    if (Number.isFinite(last) && now.getTime() - last < TEST_MIN_INTERVAL_MS) return false;
    transaction.set(ref, { lastTestAt: now.toISOString() }, { merge: true });
    return true;
  });
}
