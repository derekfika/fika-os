import { spawn } from "node:child_process";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const STAGING_PROJECT = "fika-os-dev";
export const SESSION_SECRET_NAME = "LOGISTICS_MOBILE_SESSION_SECRET";
export const VEHICLE_VERIFIER_SECRETS = Object.freeze({
  van1: "LOGISTICS_MOBILE_VAN1_PIN_VERIFIER",
  van2: "LOGISTICS_MOBILE_VAN2_PIN_VERIFIER",
});
export const SCRYPT_PARAMETERS = Object.freeze({ N: 16_384, r: 8, p: 1, keyLength: 32, saltLength: 16 });

const scrypt = promisify(scryptCallback);
const configPath = join(dirname(fileURLToPath(import.meta.url)), "..", "apphosting.staging.yaml");

export function newSessionSecret() {
  return randomBytes(32).toString("base64url");
}

export async function createPinVerifier(pin, salt = randomBytes(SCRYPT_PARAMETERS.saltLength)) {
  if (!Buffer.isBuffer(pin) || pin.length < 6 || pin.length > 12 || [...pin].some(byte => byte < 0x30 || byte > 0x39)) {
    throw new Error("PIN must contain 6–12 digits.");
  }
  if (!Buffer.isBuffer(salt) || salt.length < SCRYPT_PARAMETERS.saltLength) throw new Error("A cryptographic salt of at least 16 bytes is required.");
  const derived = await scrypt(pin, salt, SCRYPT_PARAMETERS.keyLength, {
    N: SCRYPT_PARAMETERS.N,
    r: SCRYPT_PARAMETERS.r,
    p: SCRYPT_PARAMETERS.p,
    maxmem: 64 * 1024 * 1024,
  });
  try {
    return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
  } finally {
    derived.fill(0);
  }
}

function runGcloud(args, input, runner = spawn) {
  return new Promise((resolve, reject) => {
    const child = runner("gcloud", args, {
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.on("error", () => reject(new Error("Google Cloud CLI could not be started; no secret value was displayed.")));
    child.on("close", code => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Google Cloud CLI failed (exit ${code ?? "unknown"}); secret values and CLI diagnostics were suppressed.`));
    });
    child.stdin.end(input);
  });
}

function commandArgs(args) {
  return [...args, `--project=${STAGING_PROJECT}`, "--quiet"];
}

function versionNumber(resourceName) {
  const match = resourceName.match(/(?:^|\/)versions\/(\d+)$/);
  if (!match) throw new Error("Google Cloud CLI did not return a secret version identifier.");
  return Number(match[1]);
}

async function ensureSecretExists(secretName, execute = runGcloud) {
  const listed = await execute(commandArgs(["secrets", "list", `--filter=name:${secretName}`, "--format=value(name)"]));
  const found = listed.split(/\r?\n/).some(line => line.trim().endsWith(`/secrets/${secretName}`));
  if (!found) await execute(commandArgs(["secrets", "create", secretName, "--replication-policy=automatic", "--format=value(name)"]));
}

export async function provisionSecretVersions(entries, { execute = runGcloud } = {}) {
  const allowed = new Set([SESSION_SECRET_NAME, ...Object.values(VEHICLE_VERIFIER_SECRETS)]);
  const created = [];
  for (const [secretName, value] of entries) {
    if (!allowed.has(secretName)) throw new Error("Only the three Logistics mobile staging secrets may be provisioned.");
    await ensureSecretExists(secretName, execute);
    const resource = await execute(commandArgs([
      "secrets", "versions", "add", secretName, "--data-file=-", "--format=value(name)",
    ]), Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8"));
    created.push({ secretName, version: versionNumber(resource) });
  }
  return created;
}

export async function updatePinnedStagingVersions(path, versions) {
  const existing = await readFile(path, "utf8");
  let updated = existing;
  for (const { secretName, version } of versions) {
    const expression = new RegExp(`(^\\s*secret:\\s*${secretName})@\\d+(\\s*$)`, "m");
    if (!expression.test(updated)) throw new Error(`Staging config does not contain the expected pinned secret ${secretName}.`);
    updated = updated.replace(expression, `$1@${version}$2`);
  }
  if (updated === existing) return false;
  const temporary = `${path}.tmp`;
  await writeFile(temporary, updated, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
  return true;
}

async function privateDigits(prompt, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || typeof input.setRawMode !== "function") throw new Error("Run this utility directly in an interactive Windows PowerShell terminal; redirected input is not accepted.");
  const pin = Buffer.alloc(12);
  let length = 0;
  output.write(prompt);
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      input.removeListener("data", onData);
      input.setRawMode(false);
      output.write("\r\n");
    };
    const onData = (chunk) => {
      for (const byte of chunk) {
        if (byte === 3) {
          cleanup();
          pin.fill(0);
          reject(new Error("PIN entry cancelled."));
          return;
        }
        if (byte === 13 || byte === 10) {
          if (length < 6 || length > 12) {
            output.write("Enter 6–12 digits.\r\n");
            pin.fill(0);
            length = 0;
            output.write(prompt);
            continue;
          }
          cleanup();
          resolve(Buffer.from(pin.subarray(0, length)));
          pin.fill(0);
          return;
        }
        if (byte === 8 || byte === 127) {
          if (length) pin[--length] = 0;
          continue;
        }
        if (byte >= 48 && byte <= 57 && length < 12) pin[length++] = byte;
      }
    };
    input.on("data", onData);
  });
}

async function confirmedPin(vehicleId) {
  for (;;) {
    const first = await privateDigits(`Enter staging ${vehicleId} PIN (6–12 digits; input hidden): `);
    let transferPinToCaller = false;
    try {
      const confirmation = await privateDigits(`Re-enter staging ${vehicleId} PIN (input hidden): `);
      try {
        const matches = first.length === confirmation.length && timingSafeEqual(first, confirmation);
        if (matches) {
          transferPinToCaller = true;
          return first;
        }
      } finally {
        confirmation.fill(0);
      }
      process.stdout.write("PIN entries did not match.\r\n");
    } finally {
      if (!transferPinToCaller) first.fill(0);
    }
  }
}

function selectedMode(args) {
  if (!args.length) return ["all"];
  if (args.length === 2 && args[0] === "--rotate" && ["van1", "van2", "all"].includes(args[1])) return [args[1]];
  if (args.length === 1 && args[0] === "--rotate-session") return ["session"];
  throw new Error("Usage: node scripts/provision-mobile-pin-secrets.mjs [--rotate van1|van2|all|--rotate-session]");
}

async function main(args = process.argv.slice(2)) {
  const mode = selectedMode(args);
  const entries = [];
  try {
    if (mode.includes("all") || mode.includes("session")) entries.push([SESSION_SECRET_NAME, Buffer.from(newSessionSecret(), "utf8")]);
    const vehicles = mode.includes("all") ? ["van1", "van2"] : mode.filter(value => value === "van1" || value === "van2");
    for (const vehicleId of vehicles) {
      const pin = await confirmedPin(vehicleId);
      try {
        entries.push([VEHICLE_VERIFIER_SECRETS[vehicleId], Buffer.from(await createPinVerifier(pin), "utf8")]);
      } finally {
        pin.fill(0);
      }
    }
    const created = await provisionSecretVersions(entries);
    const changed = await updatePinnedStagingVersions(configPath, created);
    for (const entry of created) process.stdout.write(`Created ${entry.secretName} version ${entry.version} in ${STAGING_PROJECT}.\r\n`);
    if (changed) process.stdout.write("Updated the pinned staging secret versions in apps/logistics/apphosting.staging.yaml; review and commit this config through the governed PR workflow.\r\n");
    process.stdout.write("Secret values were not printed. No deployment was started.\r\n");
  } finally {
    for (const [, value] of entries) if (Buffer.isBuffer(value)) value.fill(0);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : "Provisioning failed."}\r\n`);
    process.exitCode = 1;
  });
}
