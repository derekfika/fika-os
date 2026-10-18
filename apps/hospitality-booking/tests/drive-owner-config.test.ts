import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveDriveOwner } from "@fika/server-shared/drive-owner";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
function yamlValue(source: string, variable: string) {
  const lines = source.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() === `- variable: ${variable}`);
  return index >= 0 ? /value:\s*(\S+)/.exec(lines[index + 1])?.[1] : undefined;
}
const APPROVED = [
  ["One Angel Court", "oploc:24a93500-d75d-4fe0-8beb-672d36f9da10", "24A93500_D75D_4FE0_8BEB_672D36F9DA10"],
  ["RCoA", "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2", "BE0BECBE_B6CF_4D7F_9C1E_F36E689FEAB2"],
] as const;

test("production Hospitality carries the approved Drive owner and root folder for each approved site, identical to the Hub", () => {
  const hospitality = read("../apphosting.production.yaml");
  const hub = read("../../integration-hub/apphosting.production.yaml");
  for (const [label, , key] of APPROVED) {
    for (const prefix of ["GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_", "GOOGLE_DRIVE_ROOT_FOLDER_ID_OPLOC_"]) {
      const value = yamlValue(hospitality, prefix + key);
      assert.ok(value, `${label}: ${prefix}${key} must be set for Hospitality quote saving`);
      assert.equal(value, yamlValue(hub, prefix + key), `${label}: Hospitality and Hub must agree on ${prefix}`);
    }
  }
});

test("a hosted quote save resolves its Drive owner from the production configuration, and fails closed for an unconfigured site", () => {
  const hospitality = read("../apphosting.production.yaml");
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { FIKA_RUNTIME_MODE: "production", NODE_ENV: "production", GOOGLE_WORKSPACE_DWD_SERVICE_ACCOUNT_JSON: "{}" });
    for (const key of Object.keys(process.env)) if (key.startsWith("GOOGLE_DRIVE_")) delete process.env[key];
    for (const [, oplocId, key] of APPROVED) {
      process.env[`GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_${key}`] = yamlValue(hospitality, `GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_${key}`)!;
      process.env[`GOOGLE_DRIVE_ROOT_FOLDER_ID_OPLOC_${key}`] = yamlValue(hospitality, `GOOGLE_DRIVE_ROOT_FOLDER_ID_OPLOC_${key}`)!;
      const owner = resolveDriveOwner({ type: "oploc-workspace", oplocId });
      assert.equal(owner.authMode, "dwd");
      assert.ok(owner.workspaceEmail);
    }
    assert.throws(() => resolveDriveOwner({ type: "oploc-workspace", oplocId: "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f" }), /Google Drive owner is not configured/);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
