import webpush from "web-push";
import { isEligibleNow } from "./driver-notifications";
import { vapidConfig, type VapidConfig } from "./push-config";
import {
  MAX_PUSH_ATTEMPTS, PUSH_MAX_AGE_MS, claimNoticeForPush, deleteSubscription, finishNoticePush, listPendingPushNoticeIds,
  noticePushAttempts, recordSubscriptionResult, subscriptionsFor, type NoticeForPush, type PushVehicle, type StoredSubscription,
} from "./driver-push-store";

export type PushPayload = { v: 1; title: string; body: string; tag: string; url: string; vehicleId: PushVehicle; priority: "normal" | "high" };
export type PushOutcome = { sent: number; removed: number; failed: number; transient: number };
type Send = (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, options: { TTL: number; urgency: "normal" | "high"; timeout: number; vapidDetails: VapidConfig }) => Promise<unknown>;

export type PushDeps = { vapid?: VapidConfig; send?: Send; now?: () => Date; /** Explicit environment for the staging guard (tests); defaults to process.env. Not a way to bypass the guard in staging. */ env?: NodeJS.ProcessEnv };

const defaultSend: Send = (subscription, payload, options) => webpush.sendNotification(subscription, payload, { TTL: options.TTL, urgency: options.urgency, timeout: options.timeout, vapidDetails: { subject: options.vapidDetails.subject, publicKey: options.vapidDetails.publicKey, privateKey: options.vapidDetails.privateKey } });
/**
 * Hosted staging must never emit real external Web Push (its VAPID secret can reach any stored subscription, and no approved staging
 * push sink exists). Fail closed on FIKA_RUNTIME_MODE === "staging". There is deliberately NO override. Only the default real-network
 * sender is blocked: a caller-injected `send` (tests, isolated contracts) is unaffected, and every other mode behaves as before.
 */
export function externalPushBlocked(deps: Pick<PushDeps, "send" | "env"> = {}, env: NodeJS.ProcessEnv = deps.env ?? process.env): boolean {
  return !deps.send && env.FIKA_RUNTIME_MODE?.trim().toLowerCase() === "staging";
}
let stagingNoticeLogged = false;
function noteStagingBlocked() {
  if (stagingNoticeLogged) return;
  stagingNoticeLogged = true;
  console.warn("[driver-notifications] external Web Push is disabled in staging; pending notices are left pending");
}

const TTL_SECONDS = 15 * 60;
const SEND_TIMEOUT_MS = 4000;

/** What the lock screen shows. The body is the short notice text (vehicle and date, never internal ids); the URL is a same-origin path. */
export function payloadForNotice(notice: Pick<NoticeForPush, "id" | "vehicleId" | "title" | "pushBody" | "priority" | "serviceDate">): PushPayload {
  return { v: 1, title: notice.title, body: notice.pushBody, tag: `notice-${notice.id.slice(0, 24)}`, url: `/mobile/${notice.vehicleId}?notice=${encodeURIComponent(notice.id)}&serviceDate=${encodeURIComponent(notice.serviceDate)}`, vehicleId: notice.vehicleId, priority: notice.priority };
}

async function sendOne(subscription: StoredSubscription, payload: PushPayload, deps: Required<Omit<PushDeps, "env">>, outcome: PushOutcome) {
  try {
    await deps.send({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(payload), { TTL: TTL_SECONDS, urgency: payload.priority === "high" ? "high" : "normal", timeout: SEND_TIMEOUT_MS, vapidDetails: deps.vapid });
    outcome.sent += 1;
    await recordSubscriptionResult(subscription.id, true, deps.now()).catch(() => undefined);
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    // The push service says the subscription is gone (uninstalled, permission revoked, expired): forget it.
    if (status === 404 || status === 410) { outcome.removed += 1; await deleteSubscription(subscription.id).catch(() => undefined); return; }
    if (status === 400 || status === 401 || status === 403) outcome.failed += 1; else outcome.transient += 1;
    await recordSubscriptionResult(subscription.id, false, deps.now(), `${status ?? "network"}`).catch(() => undefined);
  }
}

export type VerifyOutcome = "delivered" | "gone" | "failed" | "disabled_in_staging";

/**
 * Prove one endpoint can receive a push before its replacement takes over. Sent only to that endpoint. The notification says what it
 * is, so a driver who sees it knows notifications are on for their van.
 */
export async function sendVerification(vehicleId: PushVehicle, subscription: { endpoint: string; p256dh: string; auth: string }, deps: PushDeps = {}): Promise<VerifyOutcome> {
  if (externalPushBlocked(deps)) { noteStagingBlocked(); return "disabled_in_staging"; }
  const vapid = deps.vapid ?? vapidConfig();
  if (!vapid) return "failed";
  const send = deps.send ?? defaultSend;
  const label = vehicleId === "van2" ? "Van 2" : "Van 1";
  const payload: PushPayload = { v: 1, title: "Notifications are on", body: `${label} will be alerted when its run changes today.`, tag: "verify", url: `/mobile/${vehicleId}`, vehicleId, priority: "normal" };
  try {
    await send({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(payload), { TTL: TTL_SECONDS, urgency: "normal", timeout: SEND_TIMEOUT_MS, vapidDetails: vapid });
    return "delivered";
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode;
    return status === 404 || status === 410 ? "gone" : "failed";
  }
}

/** Send one payload to every device bound to a van. Never throws. */
export async function sendToVehicle(vehicleId: PushVehicle, payload: PushPayload, deps: PushDeps = {}): Promise<PushOutcome & { devices: number }> {
  const outcome: PushOutcome = { sent: 0, removed: 0, failed: 0, transient: 0 };
  if (externalPushBlocked(deps)) { noteStagingBlocked(); return { ...outcome, devices: 0 }; }
  const vapid = deps.vapid ?? vapidConfig();
  if (!vapid) return { ...outcome, devices: 0 };
  const resolved: Required<Omit<PushDeps, "env">> = { vapid, send: deps.send ?? defaultSend, now: deps.now ?? (() => new Date()) };
  // Only sendable subscriptions: superseded legacy and unverified replacements are excluded (see isSendable).
  const devices = await subscriptionsFor(vehicleId);
  await Promise.all(devices.map(device => sendOne(device, payload, resolved, outcome)));
  return { ...outcome, devices: devices.length };
}

/**
 * Push one committed notice. The eligibility checks run HERE, at send time: a notice for another service date, or one older than the
 * push window, is expired rather than delivered late. A claim makes overlapping senders (post-save, recovery) push it at most once
 * unless every attempt failed transiently, in which case it is retried a bounded number of times.
 */
export async function deliverNoticePush(noticeId: string, deps: PushDeps = {}): Promise<"sent" | "none" | "pending" | "failed" | "expired" | "skipped"> {
  // Before any claim or attempt counter: a blocked send must leave the notice exactly as it was (pending).
  if (externalPushBlocked(deps)) { noteStagingBlocked(); return "skipped"; }
  const now = (deps.now ?? (() => new Date()))();
  const notice = await claimNoticeForPush(noticeId, now);
  if (!notice) return "skipped";
  const tooOld = now.getTime() - Date.parse(notice.createdAt) > PUSH_MAX_AGE_MS;
  if (tooOld || !isEligibleNow({ serviceDate: notice.serviceDate }, now)) { await finishNoticePush(noticeId, "expired", {}, now); return "expired"; }
  const result = await sendToVehicle(notice.vehicleId, payloadForNotice(notice), deps);
  const summary = { sent: result.sent, removed: result.removed, failed: result.failed + result.transient };
  let status: "sent" | "none" | "pending" | "failed";
  if (result.sent > 0) status = "sent";
  else if (result.devices === 0 || (result.removed > 0 && result.failed + result.transient === 0)) status = "none";
  else if (result.transient > 0 && result.failed === 0) {
    status = (await noticePushAttempts(noticeId)) >= MAX_PUSH_ATTEMPTS ? "failed" : "pending";
  } else status = "failed";
  await finishNoticePush(noticeId, status, summary, now);
  return status;
}

/** Push a batch of newly committed notices. Failures are logged, never thrown: a push problem must not touch the inbox or the planner. */
export async function deliverPushes(noticeIds: string[], deps: PushDeps = {}) {
  if (externalPushBlocked(deps)) { noteStagingBlocked(); return; }
  for (const id of noticeIds) {
    try { await deliverNoticePush(id, deps); }
    catch (error) { console.error("[driver-notifications] push delivery deferred for retry", error instanceof Error ? error.message : "unknown error"); }
  }
}

/** Recovery: retry pushes that are still pending (bounded). The scheduler route calls this alongside event processing. */
export async function retryPendingPushes(deps: PushDeps = {}, limit = 25) {
  if (externalPushBlocked(deps)) { noteStagingBlocked(); return 0; }
  const ids = await listPendingPushNoticeIds(limit);
  await deliverPushes(ids, deps);
  return ids.length;
}
