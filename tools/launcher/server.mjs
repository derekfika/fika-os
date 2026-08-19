import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const workspaceRoot = join(directory, "..", "..");
const port = Number(process.env.LAUNCHER_PORT || 3100);
const startupTimeoutMs = 30000;
const apps = JSON.parse(await readFile(join(directory, "apps.json"), "utf8"));
const launchedApps = new Map();
const startingRequests = new Set();

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function isReachable(app) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(app.url, {
      signal: controller.signal,
      redirect: "manual",
      headers: { "user-agent": "FIKA OS local launcher" },
    });
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function appStatus(app) {
  const record = launchedApps.get(app.id);
  if (record?.state === "starting") return { id: app.id, status: "starting" };
  if (record?.state === "failed") return { id: app.id, status: "failed", message: record.message };
  return { id: app.id, status: record?.state || "offline" };
}

async function checkApp(app) {
  const record = launchedApps.get(app.id);
  if (record?.state === "starting" || record?.state === "failed") return appStatus(app);

  const online = await isReachable(app);
  if (online) {
    if (record) record.state = "online";
    return { id: app.id, status: "online" };
  }

  if (record?.state === "online") record.state = "offline";
  return { id: app.id, status: "offline" };
}

function writeLog(app, stream, chunk) {
  const text = String(chunk).trim();
  if (text) console.log(`[${app.id}:${stream}] ${text}`);
}

function killProcessTree(record) {
  if (!record?.child?.pid) return;
  if (process.platform === "win32") {
    const pids = new Set([record.child.pid]);
    try {
      const netstat = execFileSync("netstat.exe", ["-ano", "-p", "tcp"], { encoding: "utf8" });
      const portPattern = new RegExp(`\\s+TCP\\s+\\S+:${record.port}\\s+\\S+\\s+LISTENING\\s+(\\d+)`, "i");
      for (const line of netstat.split(/\r?\n/)) {
        const match = line.match(portPattern);
        if (match) pids.add(Number(match[1]));
      }
    } catch (error) {
      console.error(`[${record.appId}] Could not inspect port ${record.port} during shutdown: ${error.message}`);
    }
    for (const pid of pids) {
      try {
        execFileSync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], { stdio: "ignore", windowsHide: true });
      } catch {
        // The process may already have exited between netstat and taskkill.
      }
    }
  } else {
    record.child.kill("SIGTERM");
  }
}

function spawnApp(app, record) {
  let command = "npm";
  let args = ["run", "dev"];
  if (process.platform === "win32") {
    const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    if (existsSync(npmCli)) {
      command = process.execPath;
      args = [npmCli, "run", "dev"];
    } else {
      command = process.env.ComSpec || "cmd.exe";
      args = ["/d", "/s", "/c", "npm.cmd run dev"];
    }
  }
  const child = spawn(command, args, {
    cwd: join(workspaceRoot, app.directory),
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    env: { ...process.env, PORT: String(app.port) },
  });
  record.child = child;
  child.stdout.on("data", (chunk) => writeLog(app, "stdout", chunk));
  child.stderr.on("data", (chunk) => writeLog(app, "stderr", chunk));
  child.once("exit", (code, signal) => {
    if (record.state !== "online") {
      record.state = "failed";
      record.message = `${app.name} stopped before becoming online (code ${code ?? "?"}, signal ${signal ?? "none"}).`;
    } else {
      record.state = "failed";
      record.message = `${app.name} stopped (code ${code ?? "?"}, signal ${signal ?? "none"}).`;
    }
  });
  return new Promise((resolve, reject) => {
    child.once("spawn", () => resolve(child));
    child.once("error", (error) => reject(error));
  });
}

async function monitorStartup(app, record) {
  const deadline = Date.now() + startupTimeoutMs;
  while (record.state === "starting" && Date.now() < deadline) {
    if (await isReachable(app)) {
      record.state = "online";
      return;
    }
    if (record.child.exitCode !== null) return;
    await delay(1000);
  }
  if (record.state === "starting") {
    record.state = "failed";
    record.message = `${app.name} did not become reachable within ${startupTimeoutMs / 1000} seconds.`;
  }
}

async function startApp(app) {
  if (!app.directory || app.planned) {
    return { ok: false, status: "failed", message: `${app.name} is not available to start yet.` };
  }

  if (startingRequests.has(app.id)) return { ok: true, status: "starting", message: `${app.name} is already starting.` };
  startingRequests.add(app.id);

  try {
    return await startAppInternal(app);
  } finally {
    startingRequests.delete(app.id);
  }
}

async function startAppInternal(app) {

  const existing = launchedApps.get(app.id);
  if (existing?.state === "starting") return { ok: true, status: "starting", message: `${app.name} is already starting.` };
  if (existing?.state === "online" && existing.child?.exitCode === null) return { ok: true, status: "online", alreadyRunning: true, message: `${app.name} is already running.` };
  if (await isReachable(app)) {
    if (existing) existing.state = "online";
    return { ok: true, status: "online", alreadyRunning: true, message: `${app.name} is already running.` };
  }

  const record = { appId: app.id, port: app.port, state: "starting", child: null, message: "" };
  launchedApps.set(app.id, record);
  try {
    await spawnApp(app, record);
  } catch (error) {
    record.state = "failed";
    record.message = `Could not start ${app.name}: ${error.message}`;
    console.error(`[${app.id}] ${record.message}`);
    return { ok: false, status: "failed", message: record.message };
  }

  console.log(`[${app.id}] spawned process ${record.child.pid}`);
  monitorStartup(app, record).catch((error) => {
    record.state = "failed";
    record.message = `Startup monitor failed for ${app.name}: ${error.message}`;
    console.error(`[${app.id}] ${record.message}`);
  });
  return { ok: true, status: "starting", message: `Starting ${app.name}.` };
}

function send(response, status, body, contentType) {
  response.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  response.end(body);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/config") {
    return send(response, 200, JSON.stringify(apps), "application/json; charset=utf-8");
  }

  if (url.pathname === "/status") {
    const statuses = await Promise.all(apps.map(checkApp));
    return send(response, 200, JSON.stringify({ refreshedAt: new Date().toISOString(), statuses }), "application/json; charset=utf-8");
  }

  if (request.method === "POST" && url.pathname.startsWith("/start/")) {
    const app = apps.find((item) => item.id === decodeURIComponent(url.pathname.slice("/start/".length)));
    if (!app) return send(response, 404, JSON.stringify({ ok: false, status: "failed", message: "App not found." }), "application/json; charset=utf-8");
    const result = await startApp(app);
    return send(response, result.ok ? (result.alreadyRunning ? 200 : 202) : 500, JSON.stringify(result), "application/json; charset=utf-8");
  }

  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const baseDirectory = url.pathname.startsWith("/assets/") ? workspaceRoot : directory;
  const file = normalize(join(baseDirectory, requested));
  if (!file.startsWith(baseDirectory)) return send(response, 403, "Forbidden", "text/plain; charset=utf-8");

  try {
    const body = await readFile(file);
    const type = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json" }[extname(file)] || "application/octet-stream";
    return send(response, 200, body, `${type}; charset=utf-8`);
  } catch {
    return send(response, 404, "Not found", "text/plain; charset=utf-8");
  }
});

function shutdown() {
  for (const record of launchedApps.values()) killProcessTree(record);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

server.listen(port, "127.0.0.1", () => {
  console.log(`FIKA OS launcher running at http://localhost:${port}`);
});
