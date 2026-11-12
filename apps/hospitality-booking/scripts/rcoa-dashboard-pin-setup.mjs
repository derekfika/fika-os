import { randomBytes, scryptSync } from "node:crypto";
import { spawnSync } from "node:child_process";

const targets = {
  staging: { project: "fika-os-dev", label: "staging" },
  production: { project: "fika-os", label: "production" },
};
const target = targets[process.argv[2]];
if (!target || process.argv.length !== 3) {
  console.error("Choose exactly one target: staging or production.");
  process.exit(2);
}

const secretName = "RCOA_DASHBOARD_PIN_HASH";
const projectArg = `--project=${target.project}`;
const comspec = process.env.ComSpec || "cmd.exe";
function runGcloud(command, input) {
  return spawnSync(comspec, ["/d", "/s", "/c", command], {
    input,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
}

let result = runGcloud(`gcloud secrets describe ${secretName} ${projectArg} --format=json`);
if (result.error) {
  console.error("Secret Manager check failed. No PIN was requested or written.");
  process.exit(1);
}
if (result.status !== 0) {
  const diagnostic = `${result.stdout || ""}\n${result.stderr || ""}`;
  if (!/NOT_FOUND|not found/i.test(diagnostic)) {
    console.error("Secret Manager check failed. No PIN was requested or written.");
    process.exit(1);
  }
  result = runGcloud(`gcloud secrets create ${secretName} ${projectArg} --replication-policy=automatic --quiet`);
  if (result.error || result.status !== 0) {
    console.error("Secret Manager setup failed. No PIN was requested or written.");
    process.exit(1);
  }
}

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    if (!input.isTTY || typeof input.setRawMode !== "function") {
      reject(new Error("Run this command in an interactive PowerShell terminal."));
      return;
    }
    let value = "";
    process.stdout.write(prompt);
    input.setRawMode(true);
    input.resume();
    const finish = (result) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
      resolve(result);
    };
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") {
          input.off("data", onData);
          input.setRawMode(false);
          input.pause();
          process.stdout.write("\n");
          process.exit(130);
        }
        if (character === "\r" || character === "\n") {
          finish(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value.length) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        if (/^\d$/.test(character) && value.length < 12) {
          value += character;
          process.stdout.write("*");
        }
      }
    };
    input.on("data", onData);
  });
}

try {
  let pin = await readHidden(`Choose a custom ${target.label} PIN (4–12 digits; input hidden): `);
  if (!/^\d{4,12}$/.test(pin)) {
    pin = "";
    console.error("PIN must contain 4–12 digits. No value was written.");
    process.exit(1);
  }
  const confirmation = await readHidden("Confirm the PIN (input hidden): ");
  if (pin !== confirmation) {
    pin = "";
    console.error("PIN confirmation did not match. No value was written.");
    process.exit(1);
  }

  const salt = randomBytes(16);
  const key = scryptSync(pin, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const verifier = `scrypt$16384$8$1$${salt.toString("hex")}$${key.toString("hex")}`;
  pin = "";
  const stored = runGcloud(`gcloud secrets versions add ${secretName} ${projectArg} --data-file=- --quiet`, verifier);
  key.fill(0);
  if (stored.error || stored.status !== 0) {
    console.error("PIN hash was not stored. The PIN was not displayed; check gcloud access and retry.");
    process.exit(1);
  }
  console.log(`Stored only the salted scrypt hash in ${target.project}/${secretName}. Keep the PIN locally.`);
} catch (error) {
  const message = error instanceof Error && error.message.includes("interactive PowerShell")
    ? error.message
    : "PIN setup failed before any PIN was displayed.";
  console.error(message);
  process.exit(1);
}
