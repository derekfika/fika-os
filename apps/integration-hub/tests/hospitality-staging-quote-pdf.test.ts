import assert from "node:assert/strict";
import test from "node:test";
import { verifyStagingQuotePdfStatus } from "../lib/hospitality-staging-quote-pdf";

const root = "1B3oV4dmb3UpwTPRDjJ4B0hES1rRL1M5z";
const fileId = "staging-quote-file";
const booking = { version: 7, service: { oplocId: "oploc:staging-fixture" }, quoteState: { currentRevisionId: "quote:booking:fixture:r2", revisions: [{ id: "quote:booking:fixture:r2", stale: false }] } };
const saved = { expectedVersion: 7, revisionId: "quote:booking:fixture:r2", status: "saved" as const, driveFileId: fileId, driveUrl: "https://drive.google.com/file/d/untrusted/view" };
async function withEnv<T>(changes: Record<string, string | undefined>, action: () => Promise<T>): Promise<T> {
  const previous = Object.fromEntries(Object.keys(changes).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(changes)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  try { return await action(); } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
const stage = { FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev", GCLOUD_PROJECT: undefined, GOOGLE_CLOUD_PROJECT: undefined, FIREBASE_CONFIG: undefined, FIKA_STAGING_DRIVE_ENABLED: "true", FIKA_STAGING_DRIVE_AUTH_MODE: "user-oauth", FIKA_STAGING_DRIVE_EMAIL: "staging@example.test", FIKA_STAGING_DRIVE_PERMISSION_ID: "stage-user", FIKA_STAGING_DRIVE_ROOT_ID: root, FIKA_STAGING_DRIVE_ALLOWED_PERMISSION_IDS: "owner,stage-user", FIKA_STAGING_DRIVE_PRODUCTION_SENTINEL_IDS: "production-file", GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON: undefined, GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON_MAILER: undefined };
function files(options: { outside?: boolean; shortcut?: boolean; mime?: string; size?: string } = {}) {
  const requests: string[] = [];
  const fetcher = async (input: string | URL | Request) => {
    const url = String(input); requests.push(url);
    if (url.includes("fields=id,mimeType,trashed,size")) return Response.json({ id: fileId, mimeType: options.mime || "application/pdf", size: options.size ?? "12", trashed: false });
    if (url.includes(`/files/${fileId}?`)) return Response.json({ id: fileId, mimeType: options.shortcut ? "application/vnd.google-apps.shortcut" : "application/pdf", parents: [options.outside ? "outside-root" : root] });
    return Response.json({ id: "outside-root", mimeType: "application/vnd.google-apps.folder", parents: ["another-root"] });
  };
  return { requests, fetcher: fetcher as typeof fetch };
}

test("staging quote PDF status verifies the file inside the approved root and derives its link", async () => withEnv(stage, async () => {
  const { fetcher, requests } = files();
  const verified = await verifyStagingQuotePdfStatus(saved, booking, fetcher, async oplocId => { assert.equal(oplocId, booking.service.oplocId); return "synthetic-token"; });
  assert.equal(verified.driveFileId, fileId);
  assert.equal(verified.driveUrl, `https://drive.google.com/file/d/${fileId}/view`);
  assert.equal(requests.length, 2);
}));

test("staging fails closed for unverified identity, stale quote, non-PDF and outside-root files", async () => withEnv(stage, async () => {
  const noFetch = async () => { throw Error("Unexpected Drive read"); };
  await assert.rejects(verifyStagingQuotePdfStatus(saved, booking, noFetch as typeof fetch, async () => { throw Error("No isolated identity"); }), { code: "FIKA_STAGING_DRIVE_ISOLATION_UNVERIFIED", status: 404 });
  await assert.rejects(verifyStagingQuotePdfStatus(saved, { ...booking, version: 8 }, noFetch as typeof fetch, async () => { throw Error("Unexpected token"); }), /current quote changed/);
  for (const options of [{ mime: "text/html" }, { size: "0" }, { outside: true }, { shortcut: true }]) {
    const { fetcher } = files(options);
    await assert.rejects(verifyStagingQuotePdfStatus(saved, booking, fetcher, async () => "synthetic-token"), /not a current PDF|outside the approved staging Drive root/);
  }
  await assert.rejects(verifyStagingQuotePdfStatus({ ...saved, status: "failed" }, booking, noFetch as typeof fetch, async () => "synthetic-token"), /cannot carry a Drive pointer/);
}));

test("disabled staging Drive remains closed and production keeps its existing quote path", async () => {
  await withEnv({ ...stage, NODE_ENV: "production", FIKA_STAGING_DRIVE_ENABLED: "false", GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON: "synthetic-test-credential", GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_STAGING_FIXTURE: "staging@example.test" }, async () => {
    await assert.rejects(verifyStagingQuotePdfStatus(saved, booking), { code: "FIKA_STAGING_DRIVE_ISOLATION_UNVERIFIED", status: 404 });
  });
  const noFetch = (async () => { throw Error("Unexpected Drive read"); }) as typeof fetch;
  await withEnv({ FIKA_RUNTIME_MODE: "production" }, async () => assert.deepEqual(await verifyStagingQuotePdfStatus(saved, booking, noFetch), saved));
});
