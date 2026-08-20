import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hub = path.join(root, "apps", "integration-hub");
const recoveryRoot = path.join(root, "local-data", "integration-hub", "recovery");
const safetyRoot = path.join(root, "restored-data-safety-copies");
const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");

function newestDirectory(parent) {
  if (!fs.existsSync(parent)) return undefined;
  return fs.readdirSync(parent, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({ name: entry.name, mtime: fs.statSync(path.join(parent, entry.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(entry => path.join(parent, entry.name))
    .find(candidate => fs.existsSync(path.join(candidate, "firestore_export", "firestore_export.overall_export_metadata")));
}

function isListening(port) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
    socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
  });
}

const occupied = (await Promise.all([8085, 9099].map(isListening))).some(Boolean);
if (occupied) {
  console.error("Firebase emulators are already running on port 8085 or 9099. Stop the existing emulator before starting fikaos.bat again.");
  process.exit(1);
}

const importPath = process.env.FIKA_HUB_EMULATOR_IMPORT || newestDirectory(safetyRoot) || newestDirectory(recoveryRoot);
if (!importPath) {
  console.error("No Integration Hub emulator backup was found. Set FIKA_HUB_EMULATOR_IMPORT or create a recovery export first.");
  process.exit(1);
}

const exportPath = path.join(recoveryRoot, `session-${timestamp}`);
fs.mkdirSync(recoveryRoot, { recursive: true });
const localFirebase = path.join(hub, "node_modules", ".bin", process.platform === "win32" ? "firebase.cmd" : "firebase");
const firebase = fs.existsSync(localFirebase) ? localFirebase : (process.platform === "win32" ? "firebase.cmd" : "firebase");
const args = [
  "emulators:start",
  "--only", "auth,firestore",
  "--config", "firebase.json",
  "--project", "fika-os-local",
  "--import", importPath,
  "--export-on-exit", exportPath,
];

console.log(`Importing Integration Hub emulator data from ${importPath}`);
console.log(`A shutdown backup will be written to ${exportPath}`);
const child = spawn(firebase, args, { cwd: hub, stdio: "inherit", shell: process.platform === "win32" });
let stopping = false;
function forward(signal) {
  if (stopping) return;
  stopping = true;
  child.kill(signal);
}
process.on("SIGINT", () => forward("SIGINT"));
process.on("SIGTERM", () => forward("SIGTERM"));
child.once("error", error => { console.error(error); process.exitCode = 1; });
child.once("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
