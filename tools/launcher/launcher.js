const sections = ["Core Platform", "Operations", "Commercial / Service"];
let apps = [];
let statuses = new Map();

const sectionRoot = document.querySelector("#app-sections");
const summary = document.querySelector("#summary");
const refreshed = document.querySelector("#refreshed");

function openApp(app, { newTab = true } = {}) {
  if (newTab) window.open(app.url, "_blank", "noopener,noreferrer");
  else window.location.assign(app.url);
}

async function stopApp(app) {
  const response = await fetch(`/stop/${app.id}`, { method: "POST" });
  if (!response.ok) throw new Error((await response.json()).error || "Stop request failed");
  statuses.set(app.id, "stopping");
  render();
  window.setTimeout(() => refreshStatus({ reset: false }), 900);
}
async function startApp(app) {
  const response = await fetch(`/start/${app.id}`, { method: "POST" });
  if (!response.ok) throw new Error((await response.json()).error || "Start request failed");
  statuses.set(app.id, "starting");
  render();
  window.setTimeout(() => refreshStatus({ reset: false }), 900);
}

async function stopAllApps() {
  const response = await fetch("/stop-all", { method: "POST" });
  if (!response.ok) throw new Error((await response.json()).error || "Stop request failed");
  statuses = new Map(apps.map((app) => [app.id, statuses.get(app.id) === "online" ? "stopping" : statuses.get(app.id)]));
  summary.textContent = "Stopping local apps…";
  render();
  window.setTimeout(() => refreshStatus({ reset: false }), 900);
}

function openRunning(group) {
  const running = apps.filter((app) => !app.planned && group(app) && statuses.get(app.id) === "online");
  if (!running.length) {
    summary.textContent = "No selected apps are currently online";
    return;
  }
  running.forEach((app) => openApp(app, { newTab: true }));
  summary.textContent = `Opened ${running.length} running app${running.length === 1 ? "" : "s"}`;
}

function render() {
  sectionRoot.innerHTML = sections.map((section) => {
    const items = apps.filter((app) => app.section === section);
    return `<section class="section"><div class="section-heading"><h2>${section}</h2><span class="section-count">${items.length} ${items.length === 1 ? "app" : "apps"}</span></div><div class="cards">${items.map(card).join("")}</div></section>`;
  }).join("");
  document.querySelectorAll("[data-open]").forEach((button) => button.addEventListener("click", () => openApp(apps.find((app) => app.id === button.dataset.open))));
  document.querySelectorAll("[data-stop]").forEach((button) => button.addEventListener("click", async () => {
    try { await stopApp(apps.find((app) => app.id === button.dataset.stop)); } catch (error) { summary.textContent = error.message; }
  }));
  document.querySelectorAll("[data-start]").forEach((button) => button.addEventListener("click", async () => {
    try { await startApp(apps.find((app) => app.id === button.dataset.start)); } catch (error) { summary.textContent = error.message; }
  }));
}

function card(app) {
  const status = statuses.get(app.id) || "checking";
  const statusBadge = ["checking", "starting"].includes(status)
    ? '<span class="status pending" aria-hidden="true"></span>'
    : `<span class="status ${status}"><i></i>${status}</span>`;
  const action = ["online", "starting"].includes(status)
    ? `<div class="card-actions"><button class="open" ${status === "online" ? `data-open="${app.id}"` : "disabled"}>${status === "online" ? "Open app" : "Starting…"} <span>${status === "online" ? "↗" : ""}</span></button><button class="stop" data-stop="${app.id}">Stop</button></div>`
    : app.planned ? `<button class="open" disabled>Coming soon <span>·</span></button>` : `<button class="open start" data-start="${app.id}">${status === "starting" ? "Starting…" : status === "stopping" ? "Stopping…" : status === "checking" ? "Checking…" : status === "error" ? "Retry app" : "Start app"} <span>▶</span></button>`;
  return `<article class="card"><div class="card-top"><div class="app-title"><span class="app-glyph">${app.name.slice(0, 1)}</span><h3>${app.name}</h3></div>${statusBadge}</div>${app.planned ? '<span class="planned">Coming soon</span>' : ""}<p>${app.description}</p><div class="url">${app.url.replace("http://", "")}</div>${action}</article>`;
}

async function refreshStatus({ reset = true } = {}) {
  if (reset) {
    statuses = new Map(apps.map((app) => [app.id, "checking"]));
    render();
  }
  try {
    const response = await fetch("/status", { cache: "no-store" });
    const data = await response.json();
    statuses = new Map(data.statuses.map((item) => [item.id, item.status]));
    const online = data.statuses.filter((item) => item.status === "online").length;
    const errors = data.statuses.filter((item) => item.status === "error").length;
    summary.textContent = errors ? `${online} online · ${errors} error${errors === 1 ? "" : "s"}` : `${online} of ${apps.length} apps online`;
    refreshed.textContent = `Last refreshed ${new Date(data.refreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    statuses = new Map(apps.map((app) => [app.id, "error"]));
    summary.textContent = "Status service unavailable";
  }
  render();
}

document.querySelector("[data-action=core]").addEventListener("click", () => openRunning((app) => app.core));
document.querySelector("[data-action=all]").addEventListener("click", () => openRunning(() => true));
document.querySelector("[data-action=stop-all]").addEventListener("click", async () => {
  try { await stopAllApps(); } catch (error) { summary.textContent = error.message; }
});
document.querySelector("[data-action=refresh]").addEventListener("click", refreshStatus);

apps = await fetch("/config").then((response) => response.json());
render();
refreshStatus();
