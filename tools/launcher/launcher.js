const tiles = [
  ["ad-hoc-production", "Ad-Hoc Production", "One-off production requirements"],
  ["cpu-production", "CPU Production", "Production planning and kitchen workflows"],
  ["delivered-in", "Delivered-In", "Delivered-in production workflow"],
  ["hospitality-booking", "Hospitality Booking", "Hospitality booking management"],
  ["integration-hub", "Integration Hub", "Data governance and integrations"],
  ["logistics", "Logistics", "Deliveries, collections and dispatch"],
  ["menu-planning", "Menu Planning", "Plan and publish operational menus"],
  ["authmod", "Access Administration", "AUTHMOD"],
];

const grid = document.querySelector("#home-grid");
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));

const apps = await fetch("/config", { cache: "no-store" }).then((response) => response.json()).catch(() => []);
const appMap = new Map(apps.map((app) => [app.id, app]));

grid.innerHTML = tiles.map(([id, title, description]) => {
  const target = id === "authmod" ? { url: "http://localhost:3200/authmod" } : appMap.get(id);
  const content = `<div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div><span>Open &nbsp;→</span>`;
  return target?.url
    ? `<a class="home-tile${id === "authmod" ? " home-tile-admin" : ""}" href="${escapeHtml(target.url)}">${content}</a>`
    : `<div class="home-tile home-tile-disabled" aria-disabled="true">${content}</div>`;
}).join("");
