import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { driveOwnerEnvKey, resolveDriveOwner } from "@fika/server-shared/drive-owner";
import { GOVERNED_OPLOCS } from "@fika/server-shared/governed-oplocs";
import { menuFormatsForSite, resolveMenuTemplate } from "@fika/server-shared/menu-artifact";
import { resolveBookingSender } from "../lib/booking-email-delivery";

const repoRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

function valueFor(source: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`- variable: ${escaped}\\r?\\n\\s+value: (.+)`, "m"));
  assert.ok(match, `Missing App Hosting variable ${key}`);
  const value = match[1].trim();
  return (value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))
    ? value.slice(1, -1)
    : value;
}

function withEnv<T>(values: Record<string, string | undefined>, run: () => T): T {
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try { return run(); }
  finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

const angel = GOVERNED_OPLOCS.find(site => site.label === "One Angel Court");
assert.ok(angel, "Angel Court must resolve through the governed OPLOC registry");
const ANGEL_OPLOC = angel.id;

test("Angel Court production config is OPLOC-scoped and uses only its approved tablet assets", () => {
  assert.equal(ANGEL_OPLOC, "oploc:24a93500-d75d-4fe0-8beb-672d36f9da10");
  const ownerKey = driveOwnerEnvKey({ type: "oploc-workspace", oplocId: ANGEL_OPLOC });
  assert.equal(ownerKey, "OPLOC_24A93500_D75D_4FE0_8BEB_672D36F9DA10");

  const hospitality = read("apps/hospitality-booking/apphosting.production.yaml");
  const deliveredIn = read("apps/delivered-in/apphosting.production.yaml");
  const guide = read("docs/deployment/angel-court-production-config.md");
  assert.equal(valueFor(hospitality, `GOOGLE_DRIVE_OWNER_EMAIL_${ownerKey}`), "seven@fikacatering.com");
  assert.equal(valueFor(hospitality, `GOOGLE_MENU_PARENT_FOLDER_ID_${ownerKey}`), "1opIa9eW5OPAkD4zQcwiMvTmmc36U0jRc");
  assert.equal(valueFor(hospitality, "GOOGLE_MENU_TEMPLATE_ID_ANGEL_COURT"), "1LsxxcW1hhxCtJQZ3jAA4WIhEY0jRQWlBENL4ulqDpis");
  assert.equal(valueFor(deliveredIn, `GOOGLE_DRIVE_OWNER_EMAIL_${ownerKey}`), "seven@fikacatering.com");
  assert.equal(valueFor(deliveredIn, `GOOGLE_MENU_PARENT_FOLDER_ID_${ownerKey}`), "1opIa9eW5OPAkD4zQcwiMvTmmc36U0jRc");
  assert.equal(valueFor(deliveredIn, "GOOGLE_MENU_TEMPLATE_ID_ANGEL_COURT"), "1bkaXTTCStSDqo_YZOCnTZbHzaAzzzIAWIL6ooS1EEGw");
  assert.match(guide, /googleMenuFolderId = 1opIa9eW5OPAkD4zQcwiMvTmmc36U0jRc/);
  assert.match(guide, /googleMatrixFolderId = 1H3U3JxbECLYfgUSVJxkeQfI3CQ5ooD6X/);
  assert.match(guide, /googleQuoteFolderId = 18dLsE5Xatj5v6BnxOZFVYspJRWPRx5bO/);

  assert.deepEqual(menuFormatsForSite("angel-court"), ["tablet"]);
  const hospitalityTemplate = resolveMenuTemplate({ siteKey: "angel-court", oplocId: ANGEL_OPLOC }, {
    GOOGLE_MENU_TEMPLATE_ID_ANGEL_COURT: valueFor(hospitality, "GOOGLE_MENU_TEMPLATE_ID_ANGEL_COURT"),
  });
  const deliveredInTemplate = resolveMenuTemplate({ siteKey: "angel-court", oplocId: ANGEL_OPLOC }, {
    GOOGLE_MENU_TEMPLATE_ID_ANGEL_COURT: valueFor(deliveredIn, "GOOGLE_MENU_TEMPLATE_ID_ANGEL_COURT"),
  });
  assert.equal(hospitalityTemplate.templateId, "1LsxxcW1hhxCtJQZ3jAA4WIhEY0jRQWlBENL4ulqDpis");
  assert.equal(deliveredInTemplate.templateId, "1bkaXTTCStSDqo_YZOCnTZbHzaAzzzIAWIL6ooS1EEGw");
  assert.throws(() => resolveMenuTemplate({ siteKey: "angel-court", oplocId: ANGEL_OPLOC, format: "flat-label" }, {
    GOOGLE_MENU_TEMPLATE_ID_ANGEL_COURT: deliveredInTemplate.templateId,
  }), /does not support the "flat-label"/);
  assert.throws(() => resolveMenuTemplate({ siteKey: "angel-court", oplocId: ANGEL_OPLOC, format: "tent-label" }, {
    GOOGLE_MENU_TEMPLATE_ID_ANGEL_COURT: deliveredInTemplate.templateId,
  }), /does not support the "tent-label"/);
});

test("Angel Court sender is exact and remains fail-closed until Send As verification", () => {
  const hub = read("apps/integration-hub/apphosting.production.yaml");
  const senders = JSON.parse(valueFor(hub, "FIKA_HOSPITALITY_EMAIL_SENDERS_JSON")) as Record<string, {
    from: string; replyTo: string; authenticatedAccount: string; displayName: string; verifiedSendAs: boolean; enabled: string[];
  }>;
  const sender = senders[ANGEL_OPLOC];
  assert.deepEqual({ from: sender.from, replyTo: sender.replyTo, authenticatedAccount: sender.authenticatedAccount }, {
    from: "seven@fikacatering.com", replyTo: "seven@fikacatering.com", authenticatedAccount: "seven@fikacatering.com",
  });
  assert.equal(sender.displayName, "One Angel Court Hospitality");
  assert.deepEqual(sender.enabled, ["submitted", "confirmed", "amended", "cancelled"]);
  assert.equal(sender.verifiedSendAs, false, "do not assert Workspace Send As verification without manual evidence");
  assert.equal(valueFor(hub, "FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED"), "false");
  assert.doesNotMatch(hub, /variable:\s*FIKA_ANGEL_COURT_NOTIFICATION_RECIPIENTS/);

  const env = { FIKA_HOSPITALITY_EMAIL_SENDERS_JSON: JSON.stringify(senders) };
  assert.throws(() => resolveBookingSender(ANGEL_OPLOC, "submitted", env), /has not been verified/);
  const readyForOwnerVerification = { ...senders, [ANGEL_OPLOC]: { ...sender, verifiedSendAs: true } };
  assert.equal(resolveBookingSender(ANGEL_OPLOC, "submitted", { FIKA_HOSPITALITY_EMAIL_SENDERS_JSON: JSON.stringify(readyForOwnerVerification) }).from, "seven@fikacatering.com");
  assert.throws(() => resolveBookingSender("oploc:angel-court", "submitted", env), /not configured/);
});

test("Drive owner configuration cannot be inherited through an Angel Court label or alias", () => {
  const key = `GOOGLE_DRIVE_OWNER_EMAIL_${driveOwnerEnvKey({ type: "oploc-workspace", oplocId: ANGEL_OPLOC })}`;
  withEnv({
    NODE_ENV: "production",
    FIKA_RUNTIME_MODE: "production",
    GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON: "test-placeholder",
    [key]: "seven@fikacatering.com",
    GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_ANGEL_COURT: undefined,
  }, () => {
    assert.equal(resolveDriveOwner({ type: "oploc-workspace", oplocId: ANGEL_OPLOC }).workspaceEmail, "seven@fikacatering.com");
    assert.throws(() => resolveDriveOwner({ type: "oploc-workspace", oplocId: "oploc:angel-court" }), /owner is not configured/);
  });
});
