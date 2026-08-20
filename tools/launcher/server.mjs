import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const workspaceRoot = join(directory, "..", "..");
const sessionFile = join(workspaceRoot, ".fika-os-session.json");
const controlRequestFile = join(workspaceRoot, ".fika-os-control-request.json");
const port = Number(process.env.LAUNCHER_PORT || 3100);
const apps = JSON.parse(await readFile(join(directory, "apps.json"), "utf8"));

async function isReachable(app) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(app.url, { signal: controller.signal, redirect: "manual", headers: { "user-agent": "FIKA OS local launcher" } });
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function readSession() {
  try {
    const session = JSON.parse(await readFile(sessionFile, "utf8"));
    if (!session.pid) return undefined;
    try { process.kill(session.pid, 0); } catch { return undefined; }
    return session;
  } catch {
    return undefined;
  }
}

async function checkApp(app, session) {
  const supervisorState = session?.apps?.[app.id]?.state;
  const online = await isReachable(app);
  if (online) return { id: app.id, status: "online" };
  if (supervisorState === "starting" || supervisorState === "stopping") return { id: app.id, status: "starting" };
  if (supervisorState === "error") return { id: app.id, status: "error", message: session.apps[app.id].message };
  return { id: app.id, status: "offline" };
}

function send(response, status, body, contentType) {
  response.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  response.end(body);
}

async function requestStop(target) {
  const session = await readSession();
  if (!session) return { status: 409, body: { error: "FIKA OS supervisor is not running." } };
  const app = target === "all" ? undefined : apps.find((candidate) => candidate.id === target);
  if (target !== "all" && (!app || app.planned)) return { status: 404, body: { error: "This app cannot be stopped." } };
  await writeFile(controlRequestFile, JSON.stringify({ action: "stop", target, requestedAt: new Date().toISOString() }));
  return { status: 200, body: { ok: true, target } };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/config") return send(response, 200, JSON.stringify(apps), "application/json; charset=utf-8");
  if (url.pathname === "/status") {
    const session = await readSession();
    const statuses = await Promise.all(apps.map((app) => checkApp(app, session)));
    const supervisor = session ? { pid: session.pid, state: session.state, mode: session.mode } : { state: "offline" };
    return send(response, 200, JSON.stringify({ refreshedAt: new Date().toISOString(), supervisor, statuses }), "application/json; charset=utf-8");
  }
  if (request.method === "POST" && (url.pathname === "/stop-all" || url.pathname.startsWith("/stop/"))) {
    const target = url.pathname === "/stop-all" ? "all" : url.pathname.slice("/stop/".length);
    const result = await requestStop(target);
    return send(response, result.status, JSON.stringify(result.body), "application/json; charset=utf-8");
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

server.listen(port, "127.0.0.1", () => console.log(`FIKA OS launcher running at http://localhost:${port}`));
