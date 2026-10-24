import type { BookingNotificationRecord } from "./booking-notifications";
import { isRcoaEmailTestFixture, RCOA_EMAIL_TEST_NOTIFICATION_IDS, RCOA_EMAIL_TEST_OPLOC, RCOA_EMAIL_TEST_RECIPIENT } from "./booking-email-test-fixture";
import { HOSPITALITY_EMAIL_SITE_IDENTITIES, RCOA_HOSPITALITY_OPLOC_ID } from "./booking-email-site-identities";

type Env = Record<string, string | undefined>;
const list = (value: string | undefined) => (value || "").split(",").map(value => value.trim()).filter(Boolean);

/** Historical production RCoA UAT notifications are retained for audit and are never deliverable. */
export const RCOA_UAT_NOTIFICATION_EXCLUSIONS = Object.freeze([
  "booking:booking:rcoa:401238e273292f712c69ce6079e64b1e:confirmed:3",
  "booking:booking:rcoa:401238e273292f712c69ce6079e64b1e:submitted:1",
  "booking:booking:rcoa:850c92f0d64bc8826dfd3dab3886c170:confirmed:3",
  "booking:booking:rcoa:850c92f0d64bc8826dfd3dab3886c170:submitted:1",
  "booking:booking:rcoa:e058edfb1f5686d5bff6b7e48f7ce793:submitted:1",
  "booking:booking:rcoa:fd16fd79761b5b550dfbcfb3491fedba:confirmed:4",
  "booking:booking:rcoa:fd16fd79761b5b550dfbcfb3491fedba:submitted:1",
] as const);
const excludedNotificationIds = new Set<string>(RCOA_UAT_NOTIFICATION_EXCLUSIONS);

function utcMillis(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value ? millis : undefined;
}

/** New site launches must pin a cutoff so pre-launch queued rows stay inert. */
function isAfterSiteLaunch(message: BookingNotificationRecord, env: Env) {
  if (env.FIKA_RUNTIME_MODE !== "production" || message.oplocId === RCOA_HOSPITALITY_OPLOC_ID) return true;
  const oplocId = message.oplocId;
  if (!oplocId || !Object.hasOwn(HOSPITALITY_EMAIL_SITE_IDENTITIES, oplocId)) return false;
  let cutoffs: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(env.FIKA_HOSPITALITY_EMAIL_LAUNCH_CUTOFFS_JSON || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    cutoffs = parsed as Record<string, unknown>;
  } catch { return false; }
  if (Object.entries(cutoffs).some(([key, value]) => !Object.hasOwn(HOSPITALITY_EMAIL_SITE_IDENTITIES, key) || utcMillis(value) === undefined)) return false;
  const cutoff = cutoffs[oplocId];
  const cutoffMillis = utcMillis(cutoff);
  const createdAt = Date.parse(message.createdAt || "");
  return cutoffMillis !== undefined && Number.isFinite(createdAt) && createdAt >= cutoffMillis;
}

/** Production fails closed without an OPLOC allowlist. Skipped records remain unchanged for audit. */
export function emailRolloutDisposition(message: BookingNotificationRecord, env: Env = process.env): "eligible" | "skip" {
  if (excludedNotificationIds.has(message.notificationId)) return "skip";
  const allowed = list(env.FIKA_HOSPITALITY_EMAIL_ALLOWED_OPLOCS);
  if (env.FIKA_RUNTIME_MODE === "production" && !allowed.length) return "skip";
  if (allowed.length && (!message.oplocId || !allowed.includes(message.oplocId))) return "skip";
  if (!isAfterSiteLaunch(message, env)) return "skip";
  const testIds = list(env.FIKA_HOSPITALITY_EMAIL_TEST_NOTIFICATION_IDS);
  const testMode = env.FIKA_HOSPITALITY_EMAIL_TEST_MODE_ENABLED === "true";
  if (message.testFixture === true && !testMode) return "skip";
  if (testIds.length && !testMode) return "skip";
  if (testMode) {
    const fixedTestIds = Object.values(RCOA_EMAIL_TEST_NOTIFICATION_IDS);
    const recipient = env.FIKA_HOSPITALITY_EMAIL_TEST_RECIPIENT?.trim().toLowerCase();
    if (env.FIKA_RUNTIME_MODE !== "production" || allowed.length !== 1 || allowed[0] !== RCOA_EMAIL_TEST_OPLOC || recipient !== RCOA_EMAIL_TEST_RECIPIENT || testIds.length !== fixedTestIds.length || fixedTestIds.some(id => !testIds.includes(id)) || !isRcoaEmailTestFixture(message)) return "skip";
  }
  if (testIds.length) {
    if (!testIds.includes(message.notificationId)) return "skip";
    const recipient = env.FIKA_HOSPITALITY_EMAIL_TEST_RECIPIENT?.trim().toLowerCase();
    const recipients = [...message.to, ...message.cc];
    if (!recipient || !message.to.length || recipients.some(value => value.trim().toLowerCase() !== recipient)) {
      throw new Error("Test email is outside the explicit test recipient scope; no email sent.");
    }
  }
  return "eligible";
}
