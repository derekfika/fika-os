import assert from "node:assert/strict";
import test from "node:test";
import { resolveGroupQuoteTarget } from "../lib/hospitality-group-quote-destination";
import type { CanonicalBooking } from "../lib/hospitality-booking-service";
import type { DashboardQuoteSettings } from "../lib/quote-engine";

const root = "1B3oV4dmb3UpwTPRDjJ4B0hES1rRL1M5z";
const driveId = "0ALgY_Zkd_k3cUk9PVA";
const quoteFolder = "1ba16ycYD2KcGPyRlNhb55NQvvXEh_enG";
const oploc = "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2";
const booking = { service: { portalSiteId: "rcoa", oplocId: oploc } } as CanonicalBooking;
const settings = { googleQuoteFolderId: quoteFolder, googleDriveFolderId: "production-folder" } as DashboardQuoteSettings;
const stageEnv = {
  FIKA_RUNTIME_MODE: "staging", FIKA_STAGING_DRIVE_ENABLED: "true", FIKA_STAGING_DRIVE_AUTH_MODE: "shared-drive",
  FIKA_STAGING_RCOA_QUOTE_FOLDER_ID: quoteFolder,
  FIKA_STAGING_DRIVE_SHARED_DRIVE_ID: driveId, FIKA_STAGING_DRIVE_EMAIL: "fika-staging-drive@fika-os-dev.iam.gserviceaccount.com",
  FIKA_STAGING_DRIVE_PERMISSION_ID: "08677769820296169060", FIKA_STAGING_DRIVE_ROOT_ID: root,
  FIKA_STAGING_DRIVE_ALLOWED_PERMISSION_IDS: "13815538875660772973,08677769820296169060",
  FIKA_STAGING_DRIVE_PRODUCTION_SENTINEL_IDS: "production-sentinel", FIREBASE_PROJECT_ID: "fika-os-dev",
  FIREBASE_CONFIG: undefined, GOOGLE_CLOUD_PROJECT: undefined, GCLOUD_PROJECT: undefined,
  GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON: undefined, GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON_MAILER: undefined,
};

async function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { return await run(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function drive(overrides: { parent?: string; drive?: string; mimeType?: string; trashed?: boolean; canAddChildren?: boolean } = {}) {
  const reads: string[] = [];
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input); reads.push(url);
    const id = new URL(url).pathname.split("/").pop();
    if (url.includes("fields=id,parents,mimeType,trashed")) return Response.json({ id, parents: [overrides.parent ?? root], mimeType: "application/vnd.google-apps.folder" });
    if (url.includes("capabilities(canAddChildren)")) return Response.json({ id, driveId: overrides.drive ?? driveId, mimeType: overrides.mimeType ?? "application/vnd.google-apps.folder", trashed: overrides.trashed ?? false, capabilities: { canAddChildren: overrides.canAddChildren ?? true } });
    throw Error("Unexpected Drive request");
  }) as typeof fetch;
  return { fetcher, reads };
}

test("staging targets the configured RCoA Quotes child and verifies ancestry, Shared Drive, and write capability", async () => withEnv(stageEnv, async () => {
  const d = drive();
  const target = await resolveGroupQuoteTarget(booking, settings, d.fetcher, async requested => { assert.equal(requested, oploc); return "staging-token"; });
  assert.deepEqual(target, { folderId: quoteFolder, oplocId: oploc });
  assert.equal(d.reads.length, 2);
  assert.ok(d.reads.every(url => url.includes(quoteFolder)));
}));

test("staging refuses missing, outside-root, cross-drive, non-folder, trashed, and non-writable destinations", async () => withEnv(stageEnv, async () => {
  await withEnv({ FIKA_STAGING_RCOA_QUOTE_FOLDER_ID: "" }, async () => {
    await assert.rejects(resolveGroupQuoteTarget(booking, { googleDriveFolderId: "production-folder" } as DashboardQuoteSettings, drive().fetcher, async () => "stage"), /Configure the location's quote/);
  });
  for (const override of [
    { parent: "outside-root" }, { drive: "production-drive" }, { mimeType: "application/pdf" }, { trashed: true }, { canAddChildren: false },
  ]) {
    const d = drive(override);
    await assert.rejects(resolveGroupQuoteTarget(booking, settings, d.fetcher, async () => "stage"));
  }
}));

test("staging rejects production project claims before a destination metadata call", async () => withEnv({ ...stageEnv, GOOGLE_CLOUD_PROJECT: "fika-os" }, async () => {
  const d = drive();
  await assert.rejects(resolveGroupQuoteTarget(booking, settings, d.fetcher, async () => "stage"), /consistent development project claims/);
  assert.equal(d.reads.length, 0);
}));

test("production keeps the existing site-specific quote destination without selecting staging credentials", async () => withEnv({ FIKA_RUNTIME_MODE: "production" }, async () => {
  const target = await resolveGroupQuoteTarget(booking, settings, async () => { throw Error("Drive preflight should stay unchanged in production"); }, async () => { throw Error("Staging token must not be selected"); });
  assert.deepEqual(target, { folderId: quoteFolder, oplocId: oploc });
}));

test("staging destination is explicitly configured while production ignores the staging-only setting", async () => {
  await withEnv({ ...stageEnv, FIKA_STAGING_RCOA_QUOTE_FOLDER_ID: "" }, async () => {
    await assert.rejects(resolveGroupQuoteTarget(booking, settings, drive().fetcher, async () => "stage"), /Configure the location's quote Drive folder/);
  });
  await withEnv({ FIKA_RUNTIME_MODE: "production", FIKA_STAGING_RCOA_QUOTE_FOLDER_ID: "staging-folder" }, async () => {
    const target = await resolveGroupQuoteTarget(booking, settings, async () => { throw Error("unexpected fetch"); }, async () => { throw Error("staging identity must not be used"); });
    assert.deepEqual(target, { folderId: quoteFolder, oplocId: oploc });
  });
});

test("other staging sites continue to use their configured destination rather than the RCoA folder", async () => withEnv(stageEnv, async () => {
  const otherBooking = { service: { portalSiteId: "mnk", oplocId: "oploc:other" } } as CanonicalBooking;
  const otherFolder = "staging-mnk-quotes";
  const otherSettings = { ...settings, googleQuoteFolderId: otherFolder } as DashboardQuoteSettings;
  const d = drive();
  const target = await resolveGroupQuoteTarget(otherBooking, otherSettings, d.fetcher, async () => "stage");
  assert.deepEqual(target, { folderId: otherFolder, oplocId: "oploc:other" });
}));
