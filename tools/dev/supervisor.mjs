import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const appsFile = path.join(root, "tools", "launcher", "apps.json");
const sessionFile = path.join(root, ".fika-os-session.json");
const stopRequestFile = path.join(root, ".fika-os-stop-request.json");
const controlRequestFile = path.join(root, ".fika-os-control-request.json");
const pointerFile = path.join(root, "FIKA-RESTORED-DATA.json");
const hubRoot = path.join(root, "apps", "integration-hub");
const firebaseConfig = path.join(hubRoot, "firebase.json");
const firebaseCli = path.join(hubRoot, "node_modules", "firebase-tools", "lib", "bin", "firebase.js");
const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const ports = [3100, 3200, 3300, 3400, 3500, 3600, 3700, 3800, 3900, 4005, 8085, 9099];
const firebasePorts = [8085, 9099];
const apps = JSON.parse(fs.readFileSync(appsFile, "utf8"));
const appById = new Map(apps.map((app) => [app.id, app]));
const children = new Map();
const session = {
  pid: process.pid,
  host: os.hostname(),
  startedAt: new Date().toISOString(),
  mode: "normal",
  state: "preflight",
  apps: {},
};
let stopping = false;
let firebaseExportPath;
let liveBackupTimer;
let liveBackupInFlight = false;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function writeSession() {
  const temp = `${sessionFile}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(session, null, 2));
  fs.renameSync(temp, sessionFile);
}

function removeSession() {
  try {
    const current = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    if (current.pid === process.pid) fs.unlinkSync(sessionFile);
  } catch {
    // A missing or malformed session file is safe to remove at shutdown.
    try { fs.unlinkSync(sessionFile); } catch {}
  }
}

function processIsAlive(pid) {
  if (!pid || pid === process.pid) return pid === process.pid;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function portOwner(port) {
  if (process.platform !== "win32") return undefined;
  try {
    const output = execFileSync("netstat.exe", ["-ano", "-p", "tcp"], { encoding: "utf8" });
    const pattern = new RegExp(`\\s+TCP\\s+\\S+:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "i");
    for (const line of output.split(/\r?\n/)) {
      const match = line.match(pattern);
      if (match) return Number(match[1]);
    }
  } catch {}
  return undefined;
}

function checkPort(port, timeout = 400) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    const finish = (occupied) => { socket.destroy(); resolve(occupied); };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(timeout, () => finish(false));
  });
}

async function preflight() {
  const occupied = [];
  for (const port of ports) {
    if (await checkPort(port)) occupied.push({ port, pid: portOwner(port) });
  }
  if (occupied.length) {
    const details = occupied.map(({ port, pid }) => `${port}${pid ? ` (PID ${pid})` : ""}`).join(", ");
    throw new Error(`Required FIKA port(s) already in use: ${details}. Stop the owning process intentionally, then retry.`);
  }
}

function validateExport(directory, label) {
  const resolved = path.resolve(directory);
  const metadata = path.join(resolved, "firestore_export", "firestore_export.overall_export_metadata");
  if (!fs.existsSync(resolved) || !fs.existsSync(metadata)) {
    throw new Error(`${label} is missing a valid Firestore export at ${resolved}. Restore/verify the saved emulator data first.`);
  }
  return resolved;
}

function firebasePaths(mode) {
  fs.mkdirSync(path.join(root, "local-data", "integration-hub", "recovery"), { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const exportPath = path.join(root, "local-data", "integration-hub", "recovery", `session-${stamp}`);
  firebaseExportPath = exportPath;
  const args = ["emulators:start", "--only", "auth,firestore", "--config", firebaseConfig, "--project", "fika-os-local"];

  if (mode === "fresh") {
    args.push("--export-on-exit", exportPath);
    console.log("Firebase mode: FRESH blank emulator; shutdown export will be saved to:", exportPath);
    return args;
  }

  if (!fs.existsSync(pointerFile)) throw new Error(`Normal startup requires ${pointerFile}, but it was not found. Use the existing restore workflow before starting FIKA OS.`);
  const pointer = JSON.parse(fs.readFileSync(pointerFile, "utf8"));
  if (pointer.format !== "fika.restored-emulator-pointer.v1" || pointer.projectId !== "fika-os-local") {
    throw new Error(`${pointerFile} is not a verified fika-os-local restore pointer.`);
  }
  const importPath = validateExport(pointer.restoredDataPath, "The configured restored emulator data");
  args.push("--import", importPath, "--export-on-exit", exportPath);
  console.log("Firebase mode: NORMAL restored startup");
  console.log("Import:", importPath);
  console.log("Shutdown export:", exportPath);
  return args;
}

function promoteExport(exportPath, label = "Firebase export") {
  const metadata = path.join(exportPath, "firestore_export", "firestore_export.overall_export_metadata");
  if (!fs.existsSync(metadata)) {
    console.error(`${label} was not found at ${exportPath}; retaining the previous restore pointer.`);
    return;
  }
  let pointer;
  try { pointer = JSON.parse(fs.readFileSync(pointerFile, "utf8")); } catch { pointer = { format: "fika.restored-emulator-pointer.v1", projectId: "fika-os-local" }; }
  const next = { ...pointer, format: "fika.restored-emulator-pointer.v1", projectId: "fika-os-local", verifiedAt: new Date().toISOString(), restoredDataPath: exportPath, recoverySource: pointer.recoverySource || pointer.restoredDataPath || exportPath };
  const temp = `${pointerFile}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(next, null, 2));
  fs.renameSync(temp, pointerFile);
  console.log(`Updated FIKA-RESTORED-DATA.json to the latest verified ${label.toLowerCase()}.`);
}

function promoteShutdownExport() {
  if (!firebaseExportPath) return;
  promoteExport(firebaseExportPath, "Firebase shutdown export");
}

function runFirebaseExport(exportPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [firebaseCli, "emulators:export", "--project", "fika-os-local", "--only", "auth,firestore", "--force", exportPath], { cwd: hubRoot, env: { ...process.env, FIREBASE_EMULATOR_HOST: "127.0.0.1" }, stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve(undefined) : reject(new Error(`Firebase live export exited with code ${code}: ${stderr.trim()}`)));
  });
}

async function exportLiveBackup(reason) {
  if (liveBackupInFlight || stopping && reason === "interval") return;
  liveBackupInFlight = true;
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const exportPath = path.join(root, "local-data", "integration-hub", "recovery", `autosave-${stamp}`);
  try {
    fs.mkdirSync(path.dirname(exportPath), { recursive: true });
    await runFirebaseExport(exportPath);
    promoteExport(exportPath, `Firebase ${reason} export`);
  } catch (error) {
    console.error(`Firebase ${reason} export failed; the previous restore pointer is retained: ${error.message}`);
  } finally {
    liveBackupInFlight = false;
  }
}

function setState(id, state, extra = {}) {
  session.apps[id] = { ...(session.apps[id] || {}), state, ...extra };
  writeSession();
}

function logChild(id, stream, chunk) {
  const text = String(chunk).trimEnd();
  if (text) process.stdout.write(`[${id}:${stream}] ${text}\n`);
}

function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    try { execFileSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true }); } catch {}
  } else {
    try { child.kill("SIGKILL"); } catch {}
  }
}

async function stopApp(id) {
  const child = children.get(id);
  if (!child) return false;
  setState(id, "stopping");
  if (process.platform === "win32") {
    // npm launches Next as a child process; killing only npm can leave the app port orphaned.
    killTree(child);
  } else {
    try { child.kill("SIGTERM"); } catch {}
  }
  const deadline = Date.now() + 5000;
  while (children.has(id) && Date.now() < deadline) await sleep(250);
  if (children.has(id)) {
    killTree(child);
    await sleep(500);
  }
  if (!children.has(id)) setState(id, "offline", { message: undefined });
  return true;
}

async function handleControlRequest() {
  let request;
  try {
    request = JSON.parse(fs.readFileSync(controlRequestFile, "utf8"));
    fs.unlinkSync(controlRequestFile);
  } catch {
    return;
  }
  if (request.action !== "stop") return;
  if (request.target === "all") {
    await Promise.all(apps.map((app) => stopApp(app.id)));
  } else if (appById.has(request.target)) {
    await stopApp(request.target);
  }
}

function spawnManaged(id, command, args, cwd, env = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
    windowsHide: true,
  });
  children.set(id, child);
  setState(id, "starting", { pid: child.pid });
  child.stdout.on("data", (chunk) => logChild(id, "stdout", chunk));
  child.stderr.on("data", (chunk) => logChild(id, "stderr", chunk));
  child.once("exit", (code, signal) => {
    children.delete(id);
    if (!stopping && session.state !== "preflight") setState(id, "error", { code, signal, message: `${id} exited before the session stopped.` });
  });
  return new Promise((resolve, reject) => {
    child.once("spawn", () => resolve(child));
    child.once("error", reject);
  });
}

async function waitForPorts(requiredPorts, timeoutMs, childId) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (childId && !children.has(childId)) throw new Error(`${childId} exited before ports ${requiredPorts.join(", ")} became available.`);
    const ready = (await Promise.all(requiredPorts.map((port) => checkPort(port)))).every(Boolean);
    if (ready) return;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ports ${requiredPorts.join(", ")} to become available.`);
}

function npmCommand(app) {
  if (process.platform !== "win32") return { command: "npm", args: ["run", "dev"] };
  if (fs.existsSync(npmCli)) return { command: process.execPath, args: [npmCli, "run", "dev"] };
  return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", "npm.cmd run dev"] };
}

async function startApp(app) {
  const npm = npmCommand(app);
  try {
    await spawnManaged(app.id, npm.command, npm.args, path.join(root, app.directory), { PORT: String(app.port) });
  } catch (error) {
    setState(app.id, "error", { message: `Could not spawn ${app.name}: ${error.message}` });
    console.error(`[${app.id}] ${error.message}`);
  }
}

async function openBrowser() {
  if (process.platform === "win32") {
    spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "start", "", "http://localhost:3100"], { detached: true, windowsHide: true, stdio: "ignore" }).unref();
  } else {
    const opener = process.platform === "darwin" ? "open" : "xdg-open";
    spawn(opener, ["http://localhost:3100"], { detached: true, stdio: "ignore" }).unref();
  }
}

function stopRequested() {
  try {
    const request = JSON.parse(fs.readFileSync(stopRequestFile, "utf8"));
    if (request.pid === process.pid) {
      fs.unlinkSync(stopRequestFile);
      return true;
    }
  } catch {}
  return false;
}

async function shutdown(reason, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  if (liveBackupTimer) clearInterval(liveBackupTimer);
  session.state = "stopping";
  session.stopReason = reason;
  await exportLiveBackup("pre-shutdown");
  writeSession();
  console.log(`\nStopping FIKA OS (${reason}). Waiting for Firebase export and child processes...`);
  for (const [id, child] of children) {
    setState(id, "stopping");
    if (id === "firebase") {
      // Firebase needs SIGINT so its --export-on-exit snapshot is written.
      try { child.kill("SIGINT"); } catch {}
    } else if (process.platform === "win32") {
      // npm launches Next as a descendant; killing only npm leaves orphaned ports.
      killTree(child);
    } else {
      try { child.kill("SIGTERM"); } catch {}
    }
  }
  const deadline = Date.now() + 90000;
  while (children.size && Date.now() < deadline) await sleep(500);
  if (children.size) {
    console.error("Some child processes did not stop gracefully; terminating their known process trees.");
    for (const child of children.values()) killTree(child);
  }
  await sleep(1000);
  promoteShutdownExport();
  removeSession();
  process.exitCode = exitCode;
}

async function runSupervisor(mode) {
  const existing = readSession();
  if (existing && processIsAlive(existing.pid)) {
    console.log(`FIKA OS is already running (PID ${existing.pid}, state ${existing.state || "unknown"})`);
    return 0;
  }
  if (existing) { try { fs.unlinkSync(sessionFile); } catch {} }
  await preflight();
  const firebaseArgs = firebasePaths(mode);
  if (!fs.existsSync(firebaseCli)) throw new Error(`Firebase CLI not found at ${firebaseCli}. Install Integration Hub dependencies first.`);

  session.mode = mode;
  session.state = "starting-firebase";
  writeSession();
  await spawnManaged("firebase", process.execPath, [firebaseCli, ...firebaseArgs], hubRoot, { FIREBASE_EMULATOR_HOST: "127.0.0.1" });
  await waitForPorts(firebasePorts, 120000, "firebase");
  setState("firebase", "online", { ports: firebasePorts });
  await exportLiveBackup("startup");
  liveBackupTimer = setInterval(() => { void exportLiveBackup("periodic"); }, 60000);
  console.log("Firebase Auth and Firestore are available.");

  session.state = "starting-apps";
  writeSession();
  await Promise.all(apps.map(startApp));
  session.state = "starting-launcher";
  writeSession();
  await spawnManaged("launcher", process.execPath, [path.join(root, "tools", "launcher", "server.mjs")], root, { FIKA_SUPERVISOR_SESSION: sessionFile });
  await waitForPorts([3100], 30000, "launcher");
  setState("launcher", "online", { ports: [3100] });
  session.state = "running";
  writeSession();
  console.log("FIKA OS is running. Launcher: http://localhost:3100");
  await openBrowser();

  while (!stopping) {
    if (stopRequested()) await shutdown("fikaos stop");
    await handleControlRequest();
    await sleep(500);
  }
  return 0;
}

function readSession() {
  try { return JSON.parse(fs.readFileSync(sessionFile, "utf8")); } catch { return undefined; }
}

function printStatus() {
  const current = readSession();
  if (!current || !processIsAlive(current.pid)) {
    console.log("FIKA OS is not running.");
    return 0;
  }
  console.log(`FIKA OS is running (PID ${current.pid}, state ${current.state}, mode ${current.mode}).`);
  for (const port of ports) console.log(`  :${port} ${portOwner(port) ? `LISTENING PID ${portOwner(port)}` : "free"}`);
  for (const [id, record] of Object.entries(current.apps || {})) {
    const app = apps.find((candidate) => candidate.id === id);
    const listening = app && portOwner(app.port);
    const effectiveState = record.state === "starting" && listening ? "online" : record.state;
    console.log(`  ${id}: ${effectiveState}${record.pid ? ` (PID ${record.pid})` : ""}`);
  }
  return 0;
}

function requestStop() {
  const current = readSession();
  if (!current || !processIsAlive(current.pid)) {
    console.log("FIKA OS is not running.");
    try { fs.unlinkSync(sessionFile); } catch {}
    return 0;
  }
  fs.writeFileSync(stopRequestFile, JSON.stringify({ pid: current.pid, requestedAt: new Date().toISOString() }));
  console.log(`Stop requested for FIKA OS supervisor PID ${current.pid}.`);
  return 0;
}

const command = process.argv[2];
if (command === "status") process.exitCode = printStatus();
else if (command === "stop") process.exitCode = requestStop();
else if (command && command !== "--fresh") {
  console.error("Usage: fikaos [--fresh|status|stop]");
  process.exitCode = 2;
} else {
  const mode = command === "--fresh" ? "fresh" : "normal";
  process.once("SIGINT", () => { void shutdown("Ctrl+C"); });
  process.once("SIGTERM", () => { void shutdown("termination"); });
  runSupervisor(mode).catch(async (error) => {
    console.error(`FIKA OS startup failed: ${error.message}`);
    await shutdown("startup failure", 1);
  });
}
