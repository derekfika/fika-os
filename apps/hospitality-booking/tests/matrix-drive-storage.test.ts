import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";
import { driveOwnerEnvKey } from "../lib/drive-owner";
import { resolveMatrixDriveStorage } from "../lib/matrix-drive-storage";
import { POST } from "../app/api/allergen-matrix/drive/route";

const sites = [
  { name: "RCoA", oplocId: "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2", owner: "rcoa@fikacatering.com", folder: "1-RuVcoHccoKDuk3kBym-5n3RuF9ncn3X" },
  { name: "Angel Court", oplocId: "oploc:24a93500-d75d-4fe0-8beb-672d36f9da10", owner: "seven@fikacatering.com", folder: "1H3U3JxbECLYfgUSVJxkeQfI3CQ5ooD6X" },
];
const originalEnv = { ...process.env };
const originalFetch = globalThis.fetch;
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
test.beforeEach(() => {
  Object.assign(process.env, { NODE_ENV: "production", FIKA_RUNTIME_MODE: "staging", FIKA_HUB_BASE_URL: "https://hub.test", GOOGLE_DRIVE_CPU_PRODUCTION_FOLDER_ID: "cpu-global", GOOGLE_DRIVE_OWNER_EMAIL_APP_CPU_PRODUCTION: "cpu@example.com", GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "test@example.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) }) });
  for (const site of sites) {
    const key = driveOwnerEnvKey({ type: "oploc-workspace", oplocId: site.oplocId });
    process.env[`GOOGLE_DRIVE_OWNER_EMAIL_${key}`] = site.owner;
    delete process.env[`GOOGLE_DRIVE_ROOT_FOLDER_ID_${key}`];
  }
});
test.afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  Object.assign(process.env, originalEnv);
});
const context = (site = sites[0]) => ({ kind: "hospitality-site" as const, oplocId: site.oplocId, googleMatrixFolderId: site.folder });
const request = () => new NextRequest("https://hospitality.test/api/allergen-matrix/drive", { method: "POST", headers: { "content-type": "application/json", "x-fika-internal-token": "internal-test" }, body: JSON.stringify({ name: "matrix.pdf", html: "<p>matrix</p>", pdfBase64: "cGRm", productionOrderId: "production:test", releaseId: "release:unchanged:v2", weekCommencing: "2026-10-12", owner: "attacker", oplocId: sites[1].oplocId, folderId: "attacker" }) });

for (const site of sites) test(`${site.name} route uses its governed owner/folder and preserves release bytes and weekly storage`, async () => {
  const subjects: string[] = [];
  const queries: string[] = [];
  let uploaded = "";
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "hub.test") {
      assert.equal(url.searchParams.get("canonicalId"), "production:test");
      assert.equal(url.searchParams.get("includeMatrixStorage"), "true");
      assert.equal(new Headers(init?.headers).get("x-fika-internal-token"), "internal-test");
      return Response.json({ order: { origin: "hospitality_booking" }, matrixStorage: context(site) });
    }
    if (url.hostname === "oauth2.googleapis.com") {
      const jwt = new URLSearchParams(String(init?.body)).get("assertion")!;
      subjects.push(JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).sub);
      return Response.json({ access_token: "site-token" });
    }
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer site-token");
    if (url.pathname.startsWith("/drive/v3/files/")) {
      assert.equal(url.pathname.split("/").pop(), site.folder);
      return Response.json({ mimeType: "application/vnd.google-apps.folder", trashed: false });
    }
    if (url.searchParams.has("q")) {
      const query = url.searchParams.get("q")!; queries.push(query);
      if (query.includes("WC_2026-10-12")) {
        assert.ok(query.includes(`'${site.folder}' in parents`));
        return Response.json({ files: [{ id: "site-week" }] });
      }
      assert.ok(query.includes("'site-week' in parents"));
      return Response.json({ files: [] });
    }
    assert.equal(init?.method, "POST");
    assert.ok(url.pathname.startsWith("/upload/drive/v3/files"));
    uploaded = await new Response(init?.body).text();
    return Response.json({ id: "matrix-file" });
  };
  const response = await POST(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { saved: { fileId: "matrix-file", driveUrl: "https://drive.google.com/open?id=matrix-file", reused: false } });
  assert.deepEqual(subjects, [site.owner]);
  assert.ok(uploaded.includes('"parents":["site-week"]'));
  assert.ok(uploaded.includes("cGRm"));
  assert.ok(uploaded.includes(createHash("sha256").update("release:unchanged:v2").digest("hex")));
  assert.ok(queries.every(query => !query.includes("cpu-global") && !query.includes(sites.find(other => other !== site)!.folder)));
});

test("dashboard matrix folder wins over OPLOC root and CPU folder; OPLOC root wins when no dashboard override", () => {
  const key = driveOwnerEnvKey({ type: "oploc-workspace", oplocId: sites[0].oplocId });
  process.env[`GOOGLE_DRIVE_ROOT_FOLDER_ID_${key}`] = "site-root";
  assert.equal(resolveMatrixDriveStorage(context()).folderId, sites[0].folder);
  assert.equal(resolveMatrixDriveStorage({ kind: "hospitality-site", oplocId: sites[0].oplocId }).folderId, "site-root");
});

test("explicit site folder with absent/placeholder owner fails before any Drive operation", async () => {
  const key = driveOwnerEnvKey({ type: "oploc-workspace", oplocId: sites[0].oplocId });
  for (const owner of ["", "REPLACE_ME@example.com", "invalid"]) {
    process.env[`GOOGLE_DRIVE_OWNER_EMAIL_${key}`] = owner;
    assert.throws(() => resolveMatrixDriveStorage(context()), /Matrix Drive owner is not configured/);
  }
  globalThis.fetch = async (input) => {
    assert.ok(String(input).startsWith("https://hub.test/"), "must not authenticate or call Drive");
    return Response.json({ order: { origin: "hospitality_booking" }, matrixStorage: context() });
  };
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.match((await response.json()).error.message, /explicit site folder/);
});

test("an inaccessible site folder never retries with CPU identity or global folder", async () => {
  const calls: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input); calls.push(url);
    if (url.startsWith("https://hub.test")) return Response.json({ order: { origin: "hospitality_booking" }, matrixStorage: context() });
    if (url.startsWith("https://oauth2.googleapis.com")) return Response.json({ access_token: "site-only" });
    assert.ok(url.includes(sites[0].folder));
    return Response.json({ error: "not found" }, { status: 404 });
  };
  assert.equal((await POST(request())).status, 503);
  assert.equal(calls.length, 3);
});

test("site destination requires DWD and never switches to local OAuth", () => {
  delete process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON;
  assert.throws(() => resolveMatrixDriveStorage(context()), /Domain-Wide Delegation is not configured/);
  process.env.FIKA_RUNTIME_MODE = "local";
  assert.throws(() => resolveMatrixDriveStorage(context()), /DWD authentication/);
  assert.throws(() => resolveMatrixDriveStorage({ kind: "unknown" } as never), /context is invalid/);
});

test("explicit invalid folder cannot trigger automatic folder creation; copied Drive URLs remain supported", () => {
  for (const folder of ["REPLACE_ME", ";", "https://example.com/not-a-folder"]) {
    assert.throws(() => resolveMatrixDriveStorage({ ...context(), googleMatrixFolderId: folder }), /folder is invalid/);
  }
  assert.equal(resolveMatrixDriveStorage({ ...context(), googleMatrixFolderId: `https://drive.google.com/drive/folders/${sites[0].folder}` }).folderId, sites[0].folder);
});

test("unconfigured sites and other Production origins retain the CPU default", () => {
  for (const input of [{ kind: "cpu-default" as const }, { kind: "hospitality-site" as const, oplocId: sites[0].oplocId }]) {
    assert.deepEqual(resolveMatrixDriveStorage(input), { owner: { type: "app-workspace", appId: "cpu-production" }, folderId: "cpu-global", folderLabel: "CPU production" });
  }
  delete process.env.GOOGLE_DRIVE_CPU_PRODUCTION_FOLDER_ID;
  assert.equal(resolveMatrixDriveStorage({ kind: "cpu-default" }).folderId, undefined);
});

test("Hospitality order without Hub storage context fails closed during rollout version mismatch", async () => {
  globalThis.fetch = async (input) => {
    assert.ok(String(input).startsWith("https://hub.test"));
    return Response.json({ order: { origin: "hospitality_booking" } });
  };
  const response = await POST(request());
  assert.equal(response.status, 503);
  assert.match((await response.json()).error.message, /no Drive fallback was attempted/);
});
