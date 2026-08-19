import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const workspaceRoot = join(directory, "..", "..");
const port = Number(process.env.LAUNCHER_PORT || 3100);
const apps = JSON.parse(await readFile(join(directory, "apps.json"), "utf8"));
const startingApps = new Map();

async function checkApp(app) {
  const startedAt = startingApps.get(app.id);
  if (startedAt && Date.now() - startedAt < 15000) return { id: app.id, status: "starting" };
  if (startedAt) startingApps.delete(app.id);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);

  try {
    const response = await fetch(app.url, {
      signal: controller.signal,
      redirect: "manual",
      headers: { "user-agent": "FIKA OS local launcher" },
    });
    const status = response.status >= 200 && response.status < 500 ? "online" : "offline";
    if (status === "online") startingApps.delete(app.id);
    return { id: app.id, status };
  } catch {
    return { id: app.id, status: "offline" };
  } finally {
    clearTimeout(timeout);
  }
}

function startApp(app) {
  if (!app.directory || app.planned) return { ok: false, message: `${app.name} is not available to start yet.` };
  if (startingApps.has(app.id)) return { ok: true, message: `${app.name} is already starting.` };

  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(command, ["run", "dev"], {
    cwd: join(workspaceRoot, app.directory),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, PORT: String(app.port) },
  });
  child.unref();
  child.once("error", () => startingApps.delete(app.id));
  startingApps.set(app.id, Date.now());
  return { ok: true, message: `Starting ${app.name}.` };
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
    if (!app) return send(response, 404, JSON.stringify({ ok: false, message: "App not found." }), "application/json; charset=utf-8");
    const result = startApp(app);
    return send(response, result.ok ? 202 : 409, JSON.stringify(result), "application/json; charset=utf-8");
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

server.listen(port, "127.0.0.1", () => {
  console.log(`FIKA OS launcher running at http://localhost:${port}`);
});
