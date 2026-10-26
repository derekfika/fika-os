import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  SCRYPT_PARAMETERS,
  SESSION_SECRET_NAME,
  STAGING_PROJECT,
  VEHICLE_VERIFIER_SECRETS,
  createPinVerifier,
  newSessionSecret,
  provisionSecretVersions,
  updatePinnedStagingVersions,
} from "../scripts/provision-mobile-pin-secrets.mjs";
import { verifyMobilePin } from "../lib/mobile-pin-session.ts";

test("PIN provisioning matches the mobile verifier format and scrypt parameters", async () => {
  const pin = Buffer.from("123456", "ascii");
  const salt = Buffer.from("00112233445566778899aabbccddeeff", "hex");
  const verifier = await createPinVerifier(pin, salt);
  assert.deepEqual(SCRYPT_PARAMETERS, { N: 16_384, r: 8, p: 1, keyLength: 32, saltLength: 16 });
  assert.match(verifier, /^scrypt\$[A-Za-z0-9_-]{22,}\$[A-Za-z0-9_-]{43}$/);
  assert.equal(await verifyMobilePin("123456", verifier), true);
  assert.equal(await verifyMobilePin("123457", verifier), false);
  pin.fill(0);
});

test("PIN verification accepts only six to twelve ASCII digits", async () => {
  for (const value of ["12345", "1234567890123", "12345a", "\u00b912345"]) {
    await assert.rejects(createPinVerifier(Buffer.from(value, "utf8")), /6–12 digits/);
  }
});

test("session secret has 256 bits of random material in the app's UTF-8 secret format", () => {
  const first = newSessionSecret();
  const second = newSessionSecret();
  assert.equal(Buffer.from(first, "utf8").length, 43);
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
});

test("Secret Manager provisioning is restricted to the three staging names and streams bytes on stdin", async () => {
  const calls = [];
  const run = async (args, input) => {
    calls.push({ args, input: input && Buffer.from(input) });
    if (args[0] === "secrets" && args[1] === "list") return "";
    if (args[0] === "secrets" && args[1] === "versions" && args[2] === "add") {
      return `projects/123/secrets/${args[3]}/versions/${calls.length}`;
    }
    return "created";
  };
  const entries = [
    [SESSION_SECRET_NAME, Buffer.from("session-secret-sample")],
    [VEHICLE_VERIFIER_SECRETS.van1, Buffer.from("verifier-sample")],
    [VEHICLE_VERIFIER_SECRETS.van2, Buffer.from("verifier-sample-2")],
  ];
  const versions = await provisionSecretVersions(entries, { execute: run });
  assert.equal(versions.length, 3);
  assert.ok(calls.every(({ args }) => args.includes(`--project=${STAGING_PROJECT}`)));
  assert.ok(calls.every(({ args }) => !args.some(arg => arg.includes("sample"))));
  const adds = calls.filter(({ args }) => args[1] === "versions");
  assert.equal(adds.length, 3);
  assert.deepEqual(adds.map(({ input }) => input.toString("utf8")), entries.map(([, value]) => value.toString("utf8")));
  await assert.rejects(provisionSecretVersions([["UNRELATED_SECRET", "x"]], { execute: run }), /Only the three/);
});

test("rotation updates only explicit pinned staging secret versions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fika-pin-"));
  const path = join(directory, "apphosting.staging.yaml");
  const source = [
    "env:",
    `  - variable: SESSION\n    secret: ${SESSION_SECRET_NAME}@1\n    availability: [RUNTIME]`,
    `  - variable: VAN1\n    secret: ${VEHICLE_VERIFIER_SECRETS.van1}@8\n    availability: [RUNTIME]`,
    `  - variable: VAN2\n    secret: ${VEHICLE_VERIFIER_SECRETS.van2}@2\n    availability: [RUNTIME]`,
  ].join("\n");
  try {
    await writeFile(path, source, "utf8");
    const changed = await updatePinnedStagingVersions(path, [
      { secretName: VEHICLE_VERIFIER_SECRETS.van1, version: 9 },
    ]);
    assert.equal(changed, true);
    const actual = await readFile(path, "utf8");
    assert.match(actual, new RegExp(`${VEHICLE_VERIFIER_SECRETS.van1}@9`));
    assert.match(actual, new RegExp(`${SESSION_SECRET_NAME}@1`));
    assert.match(actual, new RegExp(`${VEHICLE_VERIFIER_SECRETS.van2}@2`));
    assert.equal(await updatePinnedStagingVersions(path, [{ secretName: "UNRELATED_SECRET", version: 1 }]).then(() => false, () => true), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
