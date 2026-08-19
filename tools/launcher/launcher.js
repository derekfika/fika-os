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
    if (!response.ok) throw new Error("Unable to start app");
    summary.textContent = `Starting ${app.name}…`;
    window.setTimeout(refreshStatus, 1800);
  } catch {
    statuses.set(app.id, "offline");
    summary.textContent = `Could not start ${app.name}`;
    render();
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
  const action = status === "offline" && !app.planned
    ? `<button class="open start" data-start="${app.id}">Start app <span>▶</span></button>`
    : `<button class="open" data-open="${app.id}" ${status === "starting" || app.planned ? "disabled" : ""}>${status === "starting" ? "Starting…" : app.planned ? "Coming soon" : "Open app"} <span>${app.planned ? "·" : "↗"}</span></button>`;
  return `<article class="card"><div class="card-top"><div class="app-title"><span class="app-glyph">${app.name.slice(0, 1)}</span><h3>${app.name}</h3></div><span class="status ${status}"><i></i>${status}</span></div>${app.planned ? '<span class="planned">Coming soon</span>' : ""}<p>${app.description}</p><div class="url">${app.url.replace("http://", "")}</div>${action}</article>`;
}

async function refreshStatus() {
  statuses = new Map(apps.map((app) => [app.id, "checking"]));
  render();
  summary.textContent = "Checking local apps…";
  try {
    const response = await fetch("/status", { cache: "no-store" });
    const data = await response.json();
    statuses = new Map(data.statuses.map((item) => [item.id, item.status]));
    const online = data.statuses.filter((item) => item.status === "online").length;
    summary.textContent = `${online} of ${apps.length} apps online`;
    refreshed.textContent = `Last refreshed ${new Date(data.refreshedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  } catch {
    summary.textContent = "Status service unavailable";
  }
  render();
}

document.querySelector("[data-action=core]").addEventListener("click", () => apps.filter((app) => app.core).forEach(openApp));
document.querySelector("[data-action=all]").addEventListener("click", () => apps.filter((app) => !app.planned).forEach(openApp));
document.querySelector("[data-action=refresh]").addEventListener("click", refreshStatus);

apps = await fetch("/config").then((response) => response.json());
render();
refreshStatus();
