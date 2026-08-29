import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { driveFolderPath, driveOwnerEnvKey, resolveDriveOwner } from "../lib/drive-owner";

const originalEnv = { ...process.env };
function setNodeEnv(value: string) { (process.env as Record<string, string | undefined>).NODE_ENV = value; }
function restoreEnv() {
  for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
  for (const [key, value] of Object.entries(originalEnv)) process.env[key] = value;
}

test.afterEach(restoreEnv);

test("canonical site and CPU owners have separate governed configuration keys", () => {
  assert.equal(driveOwnerEnvKey({ type: "oploc-workspace", oplocId: "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f" }), "OPLOC_66E621FA_6E6F_4F46_9AED_462313ABBE8F");
  assert.equal(driveOwnerEnvKey({ type: "app-workspace", appId: "cpu-production" }), "APP_CPU_PRODUCTION");
  assert.deepEqual(driveFolderPath({ type: "oploc-workspace", oplocId: "oploc:mnk" }, "quote"), ["FIKA OS", "Hospitality", "Quotes"]);
  assert.deepEqual(driveFolderPath({ type: "app-workspace", appId: "cpu-production" }, "production"), ["FIKA OS", "CPU Production", "Production"]);
});

test("hosted Drive ownership fails closed when the governed owner or DWD is absent", () => {
  setNodeEnv("production");
  process.env.FIKA_RUNTIME_MODE = "staging";
  delete process.env.GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_66E621FA_6E6F_4F46_9AED_462313ABBE8F;
  assert.throws(() => resolveDriveOwner({ type: "oploc-workspace", oplocId: "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f" }), /owner is not configured/);
  process.env.GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_66E621FA_6E6F_4F46_9AED_462313ABBE8F = "mnk@workspace.example";
  assert.throws(() => resolveDriveOwner({ type: "oploc-workspace", oplocId: "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f" }), /Domain-Wide Delegation is not configured/);
});

test("local mode is the only mode that permits the OAuth fallback", () => {
  setNodeEnv("development");
  process.env.FIKA_RUNTIME_MODE = "local";
  const resolved = resolveDriveOwner({ type: "oploc-workspace", oplocId: "oploc:mnk" });
  assert.equal(resolved.authMode, "local-oauth");
  process.env.FIKA_RUNTIME_MODE = "staging";
  setNodeEnv("production");
  process.env.GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_MNK = "mnk@workspace.example";
  process.env.GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON = "{\"client_email\":\"test@example.com\",\"private_key\":\"unused\"}";
  assert.equal(resolveDriveOwner({ type: "oploc-workspace", oplocId: "oploc:mnk" }).authMode, "dwd");
});

test("Drive API routes do not accept browser-selected owners or folders", async () => {
  const menus = await readFile(new URL("../app/api/menus/route.ts", import.meta.url), "utf8");
  const quotes = await readFile(new URL("../app/api/quotes/drive/route.ts", import.meta.url), "utf8");
  const matrix = await readFile(new URL("../app/api/allergen-matrix/drive/route.ts", import.meta.url), "utf8");
  assert.match(menus, /canonicalId=\$\{encodeURIComponent\(body\.bookingId\)\}/);
  assert.match(menus, /booking\.service\.oplocId/);
  assert.doesNotMatch(menus, /body\.driveFolderId|body\.menuTemplateId/);
  assert.match(quotes, /canonicalId=\$\{encodeURIComponent\(body\.canonicalId\)\}/);
  assert.match(quotes, /booking\.service\.oplocId/);
  assert.doesNotMatch(quotes, /body\.siteKey|body\.oplocId|body\.owner/);
  assert.match(matrix, /hubUserFetch/);
  assert.match(matrix, /booking\.productionOrderId|body\.productionOrderId/);
  assert.doesNotMatch(matrix, /siteKey|oplocFolder|body\.owner|body\.oplocId/);
});
