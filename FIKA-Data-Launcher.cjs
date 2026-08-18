const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const readline = require("node:readline/promises");

const ROOT = __dirname;
const APP_DIR = path.join(ROOT, "apps", "integration-hub");
const SOURCE_DIR = path.join(
  ROOT,
  "recovery",
  "integration-hub-restore",
  "recovery",
  "oploc-alignment-prechange-2026-07-28",
);
const CONFIG_PATH = path.join(ROOT, "FIKA-RESTORED-DATA.json");
const FIREBASE_CMD = path.join(APP_DIR, "node_modules", ".bin", "firebase.cmd");
const EXPECTED_PROJECT = "fika-os-local";
const EMULATOR_PORTS = [8085, 9099];

function fail(message) {
  throw new Error(message);
}

function timestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function readJson(file, label) {
  if (!fs.existsSync(file)) fail(`${label} is missing: ${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function walkFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? walkFiles(target) : [target];
  });
}

function validateExport(exportDir, options = {}) {
  const resolved = path.resolve(exportDir);
  const metadata = readJson(path.join(resolved, "firebase-export-metadata.json"), "Firebase export metadata");
  if (!metadata.firestore?.path || !metadata.firestore?.metadata_file) {
    fail(`Firestore export references are incomplete in ${resolved}`);
  }
  if (!metadata.auth?.path) fail(`Auth export reference is missing in ${resolved}`);

  const firestoreDir = path.resolve(resolved, metadata.firestore.path);
  const firestoreMetadata = path.resolve(resolved, metadata.firestore.metadata_file);
  const authDir = path.resolve(resolved, metadata.auth.path);
  for (const candidate of [firestoreDir, firestoreMetadata, authDir]) {
    if (!isInside(resolved, candidate)) fail(`Export metadata points outside its directory: ${candidate}`);
  }
  if (!fs.existsSync(firestoreMetadata)) fail(`Referenced Firestore metadata is missing: ${firestoreMetadata}`);
  if (!fs.existsSync(path.join(authDir, "accounts.json"))) fail(`Referenced Auth accounts are missing: ${authDir}`);
  if (!fs.existsSync(path.join(authDir, "config.json"))) fail(`Referenced Auth configuration is missing: ${authDir}`);

  const outputFiles = walkFiles(firestoreDir).filter((file) => /^output-\d+$/.test(path.basename(file)));
  if (outputFiles.length === 0) fail(`No Firestore data files were found in ${firestoreDir}`);
  const firestoreBytes = outputFiles.reduce((total, file) => total + fs.statSync(file).size, 0);
  if (options.minimumFirestoreBytes && firestoreBytes < options.minimumFirestoreBytes) {
    fail(`Firestore data is unexpectedly small (${firestoreBytes} bytes; minimum ${options.minimumFirestoreBytes}).`);
  }

  const inventoryPath = path.join(resolved, "inventory.json");
  const inventory = options.requireInventory ? readJson(inventoryPath, "Recovery inventory") : undefined;
  if (inventory && inventory.projectId !== EXPECTED_PROJECT) {
    fail(`Recovery project ${inventory.projectId} does not match ${EXPECTED_PROJECT}.`);
  }
  return { resolved, metadata, firestoreBytes, inventory, inventoryPath };
}

function validateApplication() {
  for (const file of [
    path.join(APP_DIR, "firebase.json"),
    path.join(APP_DIR, ".firebaserc"),
    path.join(APP_DIR, "package.json"),
    FIREBASE_CMD,
  ]) {
    if (!fs.existsSync(file)) fail(`Required Integration Hub file is missing: ${file}`);
  }
  const projects = readJson(path.join(APP_DIR, ".firebaserc"), "Firebase project configuration");
  if (projects.projects?.default !== EXPECTED_PROJECT) {
    fail(`Integration Hub Firebase project must be ${EXPECTED_PROJECT}.`);
  }
}

function listeningPorts() {
  const result = spawnSync("netstat.exe", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return new Map();
  const listeners = new Map();
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/i);
    if (match) listeners.set(Number(match[1]), Number(match[2]));
  }
  return listeners;
}

function assertEmulatorPortsFree() {
  const listeners = listeningPorts();
  const blocked = EMULATOR_PORTS.filter((port) => listeners.has(port));
  if (blocked.length) {
    const details = blocked.map((port) => `port ${port} (process ${listeners.get(port)})`).join(", ");
    fail(`A Firebase emulator is already using ${details}. Close its Firebase terminal window cleanly with Ctrl+C, wait for export to finish, then try again. No process was stopped.`);
  }
}

function startIntegrationHub() {
  const listeners = listeningPorts();
  if (listeners.has(3200)) {
    console.log(`Integration Hub already detected on port 3200 (process ${listeners.get(3200)}); no duplicate server was started.`);
    return;
  }
  const command = `title FIKA OS Integration Hub && cd /d "${APP_DIR}" && npm.cmd run dev`;
  const child = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/k", command], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
  console.log("Integration Hub started in a separate terminal window.");
}

function firebaseEnvironment() {
  return {
    ...process.env,
    FIREBASE_PROJECT_ID: EXPECTED_PROJECT,
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8085",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  };
}

function runFirebase(args) {
  const result = spawnSync(FIREBASE_CMD, args, {
    cwd: APP_DIR,
    env: firebaseEnvironment(),
    stdio: "inherit",
    shell: true,
  });
  if (result.error) fail(`Firebase could not start: ${result.error.message}`);
  return result.status ?? 1;
}

function verificationCommand(inventoryPath) {
  return `npm.cmd run recovery:verify -- "${inventoryPath.replaceAll('"', '\\"')}"`;
}

function exactVerify(importDir, inventoryPath) {
  assertEmulatorPortsFree();
  const status = runFirebase([
    "emulators:exec",
    "--only", "auth,firestore",
    "--config", "firebase.json",
    "--project", EXPECTED_PROJECT,
    "--import", importDir,
    verificationCommand(inventoryPath),
  ]);
  if (status !== 0) fail("The restored export did not match the verified recovery inventory.");
}

function preserveConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return;
  const history = path.join(ROOT, `FIKA-RESTORED-DATA.history-${timestamp()}.json`);
  fs.copyFileSync(CONFIG_PATH, history, fs.constants.COPYFILE_EXCL);
}

function writeVerifiedConfig(destination, sourceValidation) {
  preserveConfig();
  const inventory = sourceValidation.inventory;
  const config = {
    format: "fika.restored-emulator-pointer.v1",
    projectId: EXPECTED_PROJECT,
    verifiedAt: new Date().toISOString(),
    recoverySource: SOURCE_DIR,
    restoredDataPath: destination,
    minimumFirestoreBytes: Math.max(1024, Math.floor(sourceValidation.firestoreBytes * 0.25)),
    aggregateHash: inventory.aggregateHash,
    collections: inventory.collections,
  };
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { flag: "w" });
}

function readVerifiedConfig() {
  const config = readJson(CONFIG_PATH, "Verified restored-data configuration");
  if (config.format !== "fika.restored-emulator-pointer.v1" || config.projectId !== EXPECTED_PROJECT) {
    fail(`The restored-data configuration is not valid for ${EXPECTED_PROJECT}.`);
  }
  if (!config.restoredDataPath) fail("The restored-data configuration contains no data path.");
  return config;
}

async function confirmRestore(source, destination) {
  console.log("\nFIKA OS DATA RECOVERY\n");
  console.log(`Verified source: ${source}`);
  console.log(`New restored destination: ${destination}`);
  console.log("The source and all existing local-data directories will remain untouched.\n");
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await terminal.question("Type YES to restore and verify: ")).trim().toUpperCase();
  terminal.close();
  return answer === "YES";
}

async function restore() {
  validateApplication();
  const source = validateExport(SOURCE_DIR, { requireInventory: true });
  assertEmulatorPortsFree();
  const destination = path.join(ROOT, `local-data-restored-${timestamp()}`);
  if (fs.existsSync(destination)) fail(`New destination already exists: ${destination}`);
  if (!(await confirmRestore(source.resolved, destination))) {
    console.log("Restore cancelled. Nothing was changed.");
    return;
  }

  startIntegrationHub();
  console.log("\nFirebase is starting with the verified recovery data.");
  console.log("When inspection is complete, press Ctrl+C once and wait for the export to finish.\n");
  const status = runFirebase([
    "emulators:start",
    "--only", "auth,firestore",
    "--config", "firebase.json",
    "--project", EXPECTED_PROJECT,
    "--import", source.resolved,
    "--export-on-exit", destination,
  ]);
  if (status !== 0) fail("Firebase did not stop cleanly; the new destination was not accepted as verified.");

  validateExport(destination, { minimumFirestoreBytes: Math.floor(source.firestoreBytes * 0.25) });
  console.log("\nReopening the new export for an exact read-only verification...");
  exactVerify(destination, source.inventoryPath);
  writeVerifiedConfig(destination, source);
  console.log(`\nRESTORE VERIFIED\nActive restored data: ${destination}\nPointer: ${CONFIG_PATH}`);
}

function safetyCopy(dataPath) {
  const safetyRoot = path.join(ROOT, "restored-data-safety-copies");
  fs.mkdirSync(safetyRoot, { recursive: true });
  const target = path.join(safetyRoot, `${path.basename(dataPath)}-prestart-${timestamp()}`);
  if (fs.existsSync(target)) fail(`Safety-copy destination already exists: ${target}`);
  fs.cpSync(dataPath, target, { recursive: true, errorOnExist: true, force: false });
  return target;
}

function startNormally() {
  validateApplication();
  const config = readVerifiedConfig();
  const data = validateExport(config.restoredDataPath, {
    minimumFirestoreBytes: Number(config.minimumFirestoreBytes) || 1024,
  });
  assertEmulatorPortsFree();
  const backup = safetyCopy(data.resolved);
  console.log(`Verified data: ${data.resolved}`);
  console.log(`Pre-start safety copy: ${backup}`);
  startIntegrationHub();
  console.log("\nFIKA OS is starting. Stop Firebase with Ctrl+C and wait for export to finish.\n");
  const status = runFirebase([
    "emulators:start",
    "--only", "auth,firestore",
    "--config", "firebase.json",
    "--project", EXPECTED_PROJECT,
    "--import", data.resolved,
    "--export-on-exit", data.resolved,
  ]);
  if (status !== 0) fail(`Firebase did not stop cleanly. The pre-start safety copy remains at ${backup}`);
  validateExport(data.resolved, {
    minimumFirestoreBytes: Number(config.minimumFirestoreBytes) || 1024,
  });
  console.log(`\nClean export verified. The reusable data remains at:\n${data.resolved}`);
}

function dryRun() {
  validateApplication();
  const source = validateExport(SOURCE_DIR, { requireInventory: true });
  const config = readVerifiedConfig();
  const restored = validateExport(config.restoredDataPath, {
    minimumFirestoreBytes: Number(config.minimumFirestoreBytes) || 1024,
  });
  const listeners = listeningPorts();
  console.log(JSON.stringify({
    valid: true,
    projectId: EXPECTED_PROJECT,
    recoverySource: source.resolved,
    recoveryFirestoreBytes: source.firestoreBytes,
    restoredDataPath: restored.resolved,
    restoredFirestoreBytes: restored.firestoreBytes,
    ports: Object.fromEntries([3200, ...EMULATOR_PORTS].map((port) => [port, listeners.get(port) || null])),
  }, null, 2));
}

async function main() {
  const mode = process.argv[2];
  if (mode === "restore") await restore();
  else if (mode === "start") startNormally();
  else if (mode === "dry-run") dryRun();
  else fail("Use restore, start, or dry-run.");
}

main().catch((error) => {
  console.error(`\nERROR: ${error.message}\n`);
  process.exitCode = 1;
});
