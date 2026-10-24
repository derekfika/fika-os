import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { emailRolloutDisposition, RCOA_UAT_NOTIFICATION_EXCLUSIONS } from "../lib/booking-email-rollout-guard";
import { HOSPITALITY_EMAIL_SITE_IDENTITIES } from "../lib/booking-email-site-identities";
import { createRcoaEmailTestFixture, isRcoaEmailTestFixture, RCOA_EMAIL_TEST_NOTIFICATION_IDS, RCOA_EMAIL_TEST_RECIPIENT } from "../lib/booking-email-test-fixture";
import type { BookingNotificationRecord } from "../lib/booking-notifications";

const rcoa = "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2";
const message = (notificationId = "booking:rcoa:launch:submitted:1", oplocId = rcoa, to = ["customer@example.com"], cc: string[] = []) => ({
  notificationId, oplocId, to, cc,
} as BookingNotificationRecord);

test("production is RCoA-only and fails closed when its allowlist is missing", () => {
  assert.equal(emailRolloutDisposition(message(), { FIKA_RUNTIME_MODE: "production", FIKA_HOSPITALITY_EMAIL_ALLOWED_OPLOCS: rcoa }), "eligible");
  assert.equal(emailRolloutDisposition(message("other", "oploc:other"), { FIKA_RUNTIME_MODE: "production", FIKA_HOSPITALITY_EMAIL_ALLOWED_OPLOCS: rcoa }), "skip");
  assert.equal(emailRolloutDisposition(message(), { FIKA_RUNTIME_MODE: "production" }), "skip");
});

test("newly enabled sites require a per-OPLOC launch cutoff and never drain older pending rows", () => {
  const [[cfcOploc]] = Object.entries(HOSPITALITY_EMAIL_SITE_IDENTITIES);
  const oldPending = { ...message("cfc:old:submitted:1", cfcOploc), createdAt: "2026-10-23T23:59:59.999Z" };
  const newPending = { ...message("cfc:new:submitted:1", cfcOploc), createdAt: "2026-10-24T00:00:00.000Z" };
  const base = { FIKA_RUNTIME_MODE: "production", FIKA_HOSPITALITY_EMAIL_ALLOWED_OPLOCS: cfcOploc };
  assert.equal(emailRolloutDisposition(oldPending, base), "skip", "missing cutoff must fail closed");
  const cutoffs = { FIKA_HOSPITALITY_EMAIL_LAUNCH_CUTOFFS_JSON: JSON.stringify({ [cfcOploc]: "2026-10-24T00:00:00.000Z" }) };
  assert.equal(emailRolloutDisposition(oldPending, { ...base, ...cutoffs }), "skip");
  assert.equal(emailRolloutDisposition(newPending, { ...base, ...cutoffs }), "eligible");
  assert.equal(emailRolloutDisposition(newPending, { ...base, FIKA_HOSPITALITY_EMAIL_LAUNCH_CUTOFFS_JSON: "{}" }), "skip");
  assert.equal(emailRolloutDisposition(newPending, { ...base, FIKA_HOSPITALITY_EMAIL_LAUNCH_CUTOFFS_JSON: "not-json" }), "skip");
  assert.equal(emailRolloutDisposition(newPending, { ...base, FIKA_HOSPITALITY_EMAIL_LAUNCH_CUTOFFS_JSON: JSON.stringify({ [cfcOploc]: "2026-10-24T00:00:00Z" }) }), "skip", "cutoff must use exact UTC milliseconds");
});

test("all seven historical RCoA UAT notifications stay excluded after test mode is removed", () => {
  assert.equal(RCOA_UAT_NOTIFICATION_EXCLUSIONS.length, 7);
  for (const notificationId of RCOA_UAT_NOTIFICATION_EXCLUSIONS) {
    assert.equal(emailRolloutDisposition(message(notificationId), { FIKA_RUNTIME_MODE: "production", FIKA_HOSPITALITY_EMAIL_ALLOWED_OPLOCS: rcoa }), "skip");
  }
});

test("legacy arbitrary test IDs fail closed unless fixed synthetic test mode is enabled", () => {
  const config = {
    FIKA_RUNTIME_MODE: "production",
    FIKA_HOSPITALITY_EMAIL_ALLOWED_OPLOCS: rcoa,
    FIKA_HOSPITALITY_EMAIL_TEST_NOTIFICATION_IDS: "booking:rcoa:launch:submitted:1",
    FIKA_HOSPITALITY_EMAIL_TEST_RECIPIENT: "derek@fikacatering.com",
  };
  assert.equal(emailRolloutDisposition(message("other", rcoa, ["derek@fikacatering.com"]), config), "skip");
  assert.equal(emailRolloutDisposition(message("booking:rcoa:launch:submitted:1", rcoa, ["derek@fikacatering.com"]), config), "skip");
});

test("RCoA delivery test is synthetic, fixed-ID, Derek-only and permanently disabled outside test mode", () => {
  const config = {
    FIKA_RUNTIME_MODE: "production",
    FIKA_HOSPITALITY_EMAIL_ALLOWED_OPLOCS: rcoa,
    FIKA_HOSPITALITY_EMAIL_TEST_MODE_ENABLED: "true",
    FIKA_HOSPITALITY_EMAIL_TEST_NOTIFICATION_IDS: Object.values(RCOA_EMAIL_TEST_NOTIFICATION_IDS).join(","),
    FIKA_HOSPITALITY_EMAIL_TEST_RECIPIENT: RCOA_EMAIL_TEST_RECIPIENT,
  };
  const fixture = createRcoaEmailTestFixture("submitted");
  assert.equal(isRcoaEmailTestFixture(fixture), true);
  assert.deepEqual(fixture.to, ["derek@fikacatering.com"]);
  assert.deepEqual(fixture.cc, []);
  assert.match(fixture.subject, /^\[TEST ONLY\]/);
  assert.equal(emailRolloutDisposition(fixture, config), "eligible");
  assert.equal(emailRolloutDisposition(fixture, { ...config, FIKA_HOSPITALITY_EMAIL_TEST_MODE_ENABLED: "false" }), "skip");
  assert.equal(emailRolloutDisposition(fixture, { ...config, FIKA_HOSPITALITY_EMAIL_TEST_MODE_ENABLED: "false", FIKA_HOSPITALITY_EMAIL_TEST_NOTIFICATION_IDS: "" }), "skip");
  assert.equal(emailRolloutDisposition(message("ordinary-rcoa-message", rcoa, ["derek@fikacatering.com"]), config), "skip");
  assert.equal(emailRolloutDisposition({ ...fixture, to: ["customer@example.com"] }, config), "skip");
  assert.equal(emailRolloutDisposition(fixture, { ...config, FIKA_HOSPITALITY_EMAIL_TEST_RECIPIENT: "other@fikacatering.com" }), "skip");
  assert.equal(emailRolloutDisposition(message(fixture.notificationId, "oploc:other", ["derek@fikacatering.com"]), config), "skip");
});

test("production release enables RCoA-only customer delivery with test mode off and the RCoA sender without CC", () => {
  const manifest = readFileSync(new URL("../apphosting.production.yaml", import.meta.url), "utf8");
  assert.match(manifest, /variable: FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED\r?\n\s+value: "true"/);
  assert.match(manifest, /variable: FIKA_HOSPITALITY_EMAIL_TEST_MODE_ENABLED\r?\n\s+value: "false"/);
  assert.doesNotMatch(manifest, /variable: FIKA_HOSPITALITY_EMAIL_TEST_NOTIFICATION_IDS/);
  assert.doesNotMatch(manifest, /variable: FIKA_HOSPITALITY_EMAIL_TEST_RECIPIENT/);
  assert.match(manifest, /variable: FIKA_HOSPITALITY_EMAIL_ALLOWED_OPLOCS\r?\n\s+value: oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2/);
  assert.match(manifest, /variable: FIKA_HOSPITALITY_EMAIL_LAUNCH_CUTOFFS_JSON\r?\n\s+value: '\{\}'/);
  assert.match(manifest, /variable: FIKA_HOSPITALITY_EMAIL_AUTHENTICATED_ACCOUNTS_JSON\r?\n\s+value: '\{\}'/);
  assert.match(manifest, /variable: FIKA_HOSPITALITY_EMAIL_MAILER_VERIFY_MAILBOX\r?\n\s+value: rcoa@fikacatering\.com/);
  const senderEntry = manifest.match(/variable: FIKA_HOSPITALITY_EMAIL_SENDERS_JSON\r?\n\s+value: '([^']+)'/);
  assert.ok(senderEntry);
  const senders = JSON.parse(senderEntry[1]);
  const sender = senders[rcoa];
  assert.equal(sender.from, "rcoa@fikacatering.com");
  assert.equal(sender.authenticatedAccount, "rcoa@fikacatering.com");
  assert.equal(sender.replyTo, "rcoa@fikacatering.com");
  assert.equal(sender.verifiedSendAs, true); // From is the authenticated mailbox itself
  assert.equal("cc" in sender, false);
  assert.doesNotMatch(manifest.match(/variable: FIKA_HOSPITALITY_EMAIL_ALLOWED_OPLOCS[\s\S]*?(?=\r?\n  - variable:|$)/)?.[0] || "", /oploc:(?!be0becbe-b6cf-4d7f-9c1e-f36e689feab2)/);
});
