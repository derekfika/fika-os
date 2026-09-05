import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const script = new URL("./rebuild-staging.ts", import.meta.url);

test("staging rebuild source has exact safety guards and outcome gates", async () => {
  const source = await readFile(script, "utf8");
  assert.match(source, /FIKA_RUNTIME_MODE !== "staging"/);
  assert.match(source, /projectId !== "fika-os-dev"/);
  assert.match(source, /FIRESTORE_EMULATOR_HOST/);
  assert.match(source, /FIKA_SNAPSHOT_BUCKET/);
  assert.match(source, /publishCataloguePackage/);
  assert.match(source, /intentionally absent/);
  assert.match(source, /process\.exitCode = 1/);
});

test("staging rebuild refuses without the exact staging runtime", async () => {
  await assert.rejects(
    exec(process.env.ComSpec || "sh", process.platform === "win32" ? ["/d", "/s", "/c", "npm run staging:rebuild"] : ["-c", "npm run staging:rebuild"], { cwd: process.cwd(), env: { ...process.env, FIKA_RUNTIME_MODE: "local", FIREBASE_PROJECT_ID: "fika-os-dev", FIKA_SNAPSHOT_BUCKET: "unused" } }),
    /FIKA_RUNTIME_MODE must be staging/,
  );
});
