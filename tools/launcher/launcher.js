const sections = ["Core Platform", "Operations", "Commercial / Service"];
let apps = [];
let statuses = new Map();

const sectionRoot = document.querySelector("#app-sections");
const summary = document.querySelector("#summary");
const refreshed = document.querySelector("#refreshed");

function openApp(app) { window.open(app.url, "_blank", "noopener"); }

async function startApp(app) {
  statuses.set(app.id, "starting");
  render();
  try {
    const response = await fetch(`/start/${encodeURIComponent(app.id)}`, { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || `Could not start ${app.name}`);
    summary.textContent = result.status === "online" ? `${app.name} is already running` : `Starting ${app.name}…`;
    await watchStatus(app.id);
  } catch (error) {
    statuses.set(app.id, "failed");
    summary.textContent = error.message;
    render();
  }
}

async function startGroup(group) {
  if ([...statuses.values()].some((status) => status === "checking")) await refreshStatus({ reset: false });
  const targets = apps.filter((app) => !app.planned && group(app));
  const offlineTargets = targets.filter((app) => ["offline", "failed"].includes(statuses.get(app.id)));
  if (!offlineTargets.length) {
    summary.textContent = "Selected apps are already running";
    return;
  }
  await Promise.all(offlineTargets.map((app) => startApp(app)));
}

async function watchStatus(appId) {
  for (let attempt = 0; attempt < 35; attempt += 1) {
    await refreshStatus({ reset: false });
    if (statuses.get(appId) !== "starting") return;
    await new Promise((resolve) => window.setTimeout(resolve, 1000));
  }
}

function render() {
  sectionRoot.innerHTML = sections.map((section) => {
    const items = apps.filter((app) => app.section === section);
    return `<section class="section"><div class="section-heading"><h2>${section}</h2><span class="section-count">${items.length} ${items.length === 1 ? "app" : "apps"}</span></div><div class="cards">${items.map(card).join("")}</div></section>`;
  }).join("");
  document.querySelectorAll("[data-open]").forEach((button) => button.addEventListener("click", () => openApp(apps.find((app) => app.id === button.dataset.open))));
  document.querySelectorAll("[data-start]").forEach((button) => button.addEventListener("click", () => startApp(apps.find((app) => app.id === button.dataset.start))));
}

function card(app) {
  const status = statuses.get(app.id) || "checking";
  const statusBadge = ["checking", "starting"].includes(status)
    ? '<span class="status pending" aria-hidden="true"></span>'
    : `<span class="status ${status}"><i></i>${status}</span>`;
  const action = ["offline", "failed"].includes(status) && !app.planned
    ? `<button class="open start" data-start="${app.id}">${status === "failed" ? "Retry" : "Start app"} <span>▶</span></button>`
    : `<button class="open" data-open="${app.id}" ${status === "starting" || status === "checking" || app.planned ? "disabled" : ""}>${status === "starting" ? "Starting…" : status === "checking" ? "Checking…" : app.planned ? "Coming soon" : "Open app"} <span>${app.planned ? "·" : "↗"}</span></button>`;
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
    const failed = data.statuses.filter((item) => item.status === "failed").length;
    summary.textContent = failed ? `${online} online · ${failed} failed` : `${online} of ${apps.length} apps online`;
    refreshed.textContent = `Last refreshed ${new Date(data.refreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    statuses = new Map(apps.map((app) => [app.id, statuses.get(app.id) === "starting" ? "starting" : "failed"]));
    summary.textContent = "Status service unavailable";
  }
  render();
}

document.querySelector("[data-action=core]").addEventListener("click", () => startGroup((app) => app.core));
document.querySelector("[data-action=all]").addEventListener("click", () => startGroup(() => true));
document.querySelector("[data-action=refresh]").addEventListener("click", refreshStatus);

apps = await fetch("/config").then((response) => response.json());
render();
refreshStatus();
