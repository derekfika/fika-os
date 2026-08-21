import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import goldenWeek from "./golden-week.json" with { type: "json" };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const marker = goldenWeek.marker;
const note = goldenWeek.note;
const dates = goldenWeek.week.dates;
const urls = {
  hub: process.env.UAT_HUB_URL || "http://localhost:3200",
  menu: process.env.UAT_MENU_URL || "http://localhost:3500",
  delivered: process.env.UAT_DELIVERED_URL || "http://localhost:3800",
  hospitality: process.env.UAT_HOSPITALITY_URL || "http://localhost:3300",
  logistics: process.env.UAT_LOGISTICS_URL || "http://localhost:3900",
};
const manifestPath = path.join(root, "local-data", "uat", `${marker}.json`);

function localUrl(value, name) {
  const url = new URL(value);
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error(`${name} must point to localhost; refusing to contact a cloud or production service.`);
  return url;
}

async function guardLocal() {
  for (const [name, value] of Object.entries(urls)) localUrl(value, name);
  if (process.env.NODE_ENV === "production") throw new Error("UAT fixtures are disabled in production.");
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== "fika-os-local") throw new Error("UAT fixtures require Firebase project fika-os-local.");
  const probe = await fetch("http://127.0.0.1:8085", { signal: AbortSignal.timeout(3000) }).catch(() => undefined);
  if (!probe) throw new Error("Firebase Firestore emulator is not reachable on 127.0.0.1:8085; no UAT data was changed.");
}

async function request(base, route, options = {}, cookie) {
  const response = await fetch(`${base.replace(/\/$/, "")}${route}`, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...(options.headers || {}) },
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let body; try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) throw new Error(`${options.method || "GET"} ${route} failed (${response.status}): ${body?.error?.message || body?.error || text.slice(0, 300)}`);
  return { body, response };
}

async function localSession() {
  const { response } = await request(urls.hospitality, "/api/local-session", { method: "POST", body: "{}" });
  const setCookie = response.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  if (!cookie) throw new Error("Local session did not return a cookie.");
  return cookie;
}

async function readManifest() { try { return JSON.parse(await fs.readFile(manifestPath, "utf8")); } catch { return { marker, note, created: [] }; } }
async function writeManifest(value) { await fs.mkdir(path.dirname(manifestPath), { recursive: true }); await fs.writeFile(manifestPath, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function remember(manifest, type, id, date, details = {}) { if (!manifest.created.some(item => item.type === type && item.id === id)) manifest.created.push({ type, id, date, ...details }); }

async function governed(cookie) {
  const { body } = await request(urls.hub, "/api/oplocs", {}, cookie);
  const byLabel = new Map((body.oplocs || []).map(item => [item.label.toLowerCase(), item]));
  const required = ["Haleon", "FIKA Xchange", "MNK", "One Angel Court", "WCC"];
  for (const label of required) if (!byLabel.has(label.toLowerCase())) throw new Error(`Required governed OPLOC '${label}' is missing; no local fallback was used.`);
  return { byLabel, all: body.oplocs };
}

async function seedMenus(manifest, cookie) {
  const weekId = "rolling-week:2026-08-24";
  const { body } = await request(urls.menu, `/api/rolling-menu?weekId=${encodeURIComponent(weekId)}`, {}, cookie);
  const snapshot = body.snapshot;
  if (!snapshot?.week || snapshot.week.weekCommencing !== dates[0]) throw new Error("The target menu week could not be read safely.");
  // Existing restored menu entries are never overwritten. Only populated draft days are
  // sent through the real publication command, using the application validation/sign-off gate.
  for (const day of snapshot.days.filter(item => dates.includes(item.date) && item.entryIds.length)) {
    const state = body.publicationState?.[day.id];
    if (state?.status === "published") { remember(manifest, "menu-publication", day.id, day.date, { existing: true }); continue; }
    const preview = await request(urls.menu, `/api/rolling-menu?weekId=${encodeURIComponent(weekId)}&publicationPreview=true&dayId=${encodeURIComponent(day.id)}`, {}, cookie);
    if ((preview.body.dayBlockers || []).length) { manifest.warnings.push(`${day.date}: menu publication skipped: ${preview.body.dayBlockers.join("; ")}`); continue; }
    const signature = (role) => ({ printedName: `Local UAT ${role}`, signatureDataUrl: "data:image/png;base64,AA==", signedAt: new Date().toISOString(), actor: "uat-runner", attestation: `${note} (${marker})` });
    const signoff = { date: day.date, dayContentHash: preview.body.publicationPreview?.[0]?.contentHash, productionChef: signature("Production Chef"), headChefSiteManager: signature("Head Chef / Site Manager") };
    await request(urls.menu, "/api/rolling-menu", { method: "POST", body: JSON.stringify({ action: "publish", weekId, dayId: day.id, signoff }) }, cookie);
    remember(manifest, "menu-publication", day.id, day.date, { created: true });
  }
  if (snapshot.days.some(item => item.date === "2026-08-28" && item.entryIds.length === 0)) manifest.warnings.push("2026-08-28: no populated Menu Planning day existed, so no fake publication was created.");
}

async function seedGrabAndGo(manifest, cookie, oplocs) {
  const catalogue = (await request(urls.delivered, `/api/delivered-in/grab-and-go?oplocId=${encodeURIComponent(oplocs.byLabel.get("haleon")?.canonicalId || "")}`, {}, cookie)).body.catalogue || [];
  const products = catalogue.filter(item => item.active).slice(0, 4);
  if (products.length < 2) { manifest.warnings.push("Grab & Go catalogue returned fewer than two active products; no synthetic products were created."); return; }
  for (const date of goldenWeek.grabAndGo.dates) {
    for (const siteConfig of goldenWeek.grabAndGo.sites) {
      const { label } = siteConfig;
      const site = oplocs.byLabel.get(label.toLowerCase());
      const current = (await request(urls.delivered, `/api/delivered-in/grab-and-go?oplocId=${encodeURIComponent(site.canonicalId)}`, {}, cookie)).body.orders?.find(order => order.deliveryDate === date);
      const id = `grab-and-go:${site.canonicalId}:${date}`;
      if (current) { remember(manifest, "grab-and-go", id, date, { existing: true }); continue; }
      const lines = products.slice(0, siteConfig.productCount).map((product, index) => ({ productId: product.productId, quantity: siteConfig.quantities[index] }));
      await request(urls.delivered, "/api/delivered-in/grab-and-go", { method: "POST", body: JSON.stringify({ oplocId: site.canonicalId, deliveryDate: date, action: "submit", lines }) }, cookie);
      remember(manifest, "grab-and-go", id, date, { created: true });
    }
  }
}

async function seedHospitality(manifest, cookie, oplocs) {
  for (const item of goldenWeek.hospitality) {
    const site = oplocs.byLabel.get(item.destination.toLowerCase());
    const workspace = (await request(urls.hub, `/api/hospitality-bookings?site=${encodeURIComponent(item.key)}`, {}, cookie)).body;
    const existing = (workspace.bookings || []).find(booking => booking.source?.sourceBookingId === `${marker}:${item.key}:${item.date}:${item.time}`);
    if (existing) { remember(manifest, "hospitality-booking", existing.canonicalId, item.date, { existing: true }); continue; }
    const menu = (await request(urls.hospitality, `/api/reference-data?site=${encodeURIComponent(item.key)}`, {}, cookie)).body.menu || [];
    const selected = menu.slice(0, 2);
    if (!selected.length) { manifest.warnings.push(`${item.date}: no hospitality menu available for ${item.label}; booking not created.`); continue; }
    const bookingId = `${marker}:${item.key}:${item.date}:${item.time}`;
    const payload = { bookingId, submittedAt: new Date().toISOString(), site: item.label, siteId: item.key, client: { name: "FIKA OS UAT", email: "uat@local.fika", phone: "02000000000", companyName: "FIKA OS UAT", requester: { name: "FIKA OS UAT", email: "uat@local.fika", phone: "02000000000", companyName: "FIKA OS UAT" } }, event: { eventDate: item.date, startTime: item.time, endTime: item.time === "08:30" ? "09:00" : "13:30", guestCount: item.guests, roomOrArea: "UAT meeting room", deliveryPoint: item.destination, onsiteContactName: "FIKA OS UAT", onsiteContactPhone: "02000000000" }, order: { eventType: "working lunch", items: selected.map((value, index) => ({ itemId: value.id, itemName: value.name, category: value.category, description: value.description, unitPrice: Number(value.unitPrice || 0), quantity: index === 0 ? item.guests : Math.max(1, Math.floor(item.guests / 2)), lineTotal: Number(value.unitPrice || 0) * (index === 0 ? item.guests : Math.max(1, Math.floor(item.guests / 2))) })), netTotal: 0, vatNote: note }, dietaries: {}, acknowledgements: { quoteSubjectToConfirmation: true, noticePolicyAccepted: true, dietaryResponsibilityAccepted: true }, specialInstructions: `${note} · ${marker}` };
    const created = (await request(urls.hospitality, "/api/bookings", { method: "POST", body: JSON.stringify(payload) }, cookie)).body;
    const canonicalId = created.canonicalBookingId;
    remember(manifest, "hospitality-booking", canonicalId, item.date, { sourceBookingId: bookingId, created: true });
    let current = (await request(urls.hub, `/api/hospitality-bookings?site=${encodeURIComponent(item.key)}`, {}, cookie)).body.bookings.find(booking => booking.canonicalId === canonicalId);
    if (!current) throw new Error(`Hospitality booking ${bookingId} was accepted but could not be read back.`);
    for (const action of ["review", "quote"]) {
      const result = await request(urls.hub, "/api/hospitality-bookings", { method: "POST", body: JSON.stringify({ action, canonicalId, expectedVersion: current.version, ...(action === "review" ? { checks: { commercialIntent: true, serviceTiming: true, deliveryContext: true, dietaryRequirements: true }, notes: `${note} · ${marker}` } : {}) }) }, cookie);
      current = result.body.booking || result.body;
    }
    const approved = await request(urls.hub, "/api/hospitality-bookings", { method: "POST", body: JSON.stringify({ action: "approve", canonicalId, expectedVersion: current.version, quoteRevisionId: current.quoteState?.currentRevisionId }) }, cookie);
    current = approved.body.booking || approved.body;
    const handed = await request(urls.hub, "/api/hospitality-bookings", { method: "POST", body: JSON.stringify({ action: "production-handoff", canonicalId, expectedVersion: current.version }) }, cookie);
    remember(manifest, "production-order", handed.body.canonicalId || canonicalId, item.date, { bookingId: canonicalId, created: true });
  }
}

async function seedLogistics(manifest, cookie, oplocs) {
  manifest.warnings.push("Governed OPLOC 'FIKA DC' was not present in the emulator; WCC was used as the governed warehouse-side source and this substitution is recorded.");
  const movements = goldenWeek.logistics.movements.map((item) => ({
    canonicalId: `movement:${marker}:${item.id}`, entityType: "Movement Request", serviceDate: item.date, type: item.type,
    fromOplocId: oplocs.byLabel.get(item.from.toLowerCase()).canonicalId, toOplocId: oplocs.byLabel.get(item.to.toLowerCase()).canonicalId,
    requiredTime: item.requiredTime, items: [{ description: item.id === "mon-delivery" ? "Hot cupboards / insulated units" : item.id === "mon-collection" ? "Cambro boxes" : "Insulated lunch loads", quantity: item.quantity, unit: item.unit }], notes: `${note} · ${marker}`, createdBy: "Franco", status: "open", version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), audit: []
  }));
  for (const movement of movements) {
    const day = (await request(urls.logistics, `/api/logistics?serviceDate=${movement.serviceDate}`, {}, cookie)).body;
    const current = (day.movements || []).find(item => item.canonicalId === movement.canonicalId);
    if (current) { remember(manifest, "movement", movement.canonicalId, movement.serviceDate, { existing: true }); continue; }
    await request(urls.logistics, "/api/logistics", { method: "POST", body: JSON.stringify({ action: "save-movement", by: "Franco", movement }) }, cookie);
    remember(manifest, "movement", movement.canonicalId, movement.serviceDate, { created: true });
  }
  // Wednesday is intentionally left as the manual dispatch-planning day.
  // Remove only this runner's deterministic Wednesday logistics documents so
  // repeated local seeds cannot leave stale runs or assignments behind.
  const unplannedDate = goldenWeek.logistics.unplannedDate;
  const wednesdayState = (await request(urls.logistics, `/api/logistics?serviceDate=${unplannedDate}`, {}, cookie)).body;
  for (const stop of (wednesdayState.stops || []).filter(item => String(item.runId || "").startsWith(`run:${marker}:${unplannedDate}:`) || String(item.canonicalId).startsWith(`stop:${marker}:`))) {
    await fetch(`http://127.0.0.1:8085/v1/projects/fika-os-local/databases/(default)/documents/fikaLogisticsDeliveryStopsV1/${encodeURIComponent(stop.canonicalId)}`, { method: "DELETE", headers: { Authorization: "Bearer owner" } });
  }
  for (const run of (wednesdayState.runs || []).filter(item => String(item.canonicalId).startsWith(`run:${marker}:${unplannedDate}:`))) {
    await fetch(`http://127.0.0.1:8085/v1/projects/fika-os-local/databases/(default)/documents/fikaLogisticsDeliveryRunsV1/${encodeURIComponent(run.canonicalId)}`, { method: "DELETE", headers: { Authorization: "Bearer owner" } });
  }
  for (const date of goldenWeek.logistics.runDates) {
    for (const driver of ["Franco", "Dee"].slice(0, goldenWeek.logistics.runsPerDate)) {
      const id = `run:${marker}:${date}:${driver.toLowerCase()}`;
      const current = (await request(urls.logistics, `/api/logistics?serviceDate=${date}`, {}, cookie)).body.runs?.find(run => run.canonicalId === id);
      if (current) { remember(manifest, "run", id, date, { existing: true }); continue; }
      await request(urls.logistics, "/api/logistics", { method: "POST", body: JSON.stringify({ action: "create-run", by: "Franco", run: { canonicalId: id, serviceDate: date, status: "draft", driverId: driver, driverLabel: driver, vehicleLabel: `UAT van ${driver}`, orderedStopIds: [], version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), audit: [] } }) }, cookie);
      remember(manifest, "run", id, date, { created: true });
    }
  }
  // Drive the real planner assignment command for any currently eligible work.
  // The command re-reads canonical requirements and applies its own transaction.
  for (const date of goldenWeek.logistics.runDates) {
    const state = (await request(urls.logistics, `/api/logistics?serviceDate=${date}`, {}, cookie)).body;
    const runsForDate = (state.runs || []).filter(run => run.canonicalId.startsWith(`run:${marker}:${date}:`));
    if (!runsForDate.length) continue;
    const plannedRequirements = new Set((state.stops || []).flatMap(stop => (stop.requirementRefs || []).map(ref => ref.requirementId)));
    const requirements = (await request(urls.hub, `/api/fulfilment-requirements?serviceDate=${date}`, {}, cookie)).body.requirements || [];
    let cursor = 0;
    for (const requirement of requirements.filter(item => ["ready_for_planning", "amended"].includes(item.status) && !plannedRequirements.has(item.canonicalId))) {
      const run = runsForDate[cursor % runsForDate.length];
      try {
        await request(urls.logistics, "/api/logistics", { method: "POST", body: JSON.stringify({ action: "assign", by: "Franco", runId: run.canonicalId, requirementId: requirement.canonicalId, expectedSourceVersion: requirement.sourceVersion, expectedRunVersion: run.version }) }, cookie);
        run.version += 1; cursor += 1;
      } catch (error) { manifest.warnings.push(`${date}: requirement ${requirement.canonicalId} was not assigned: ${error.message}`); }
    }
    const refreshed = (await request(urls.logistics, `/api/logistics?serviceDate=${date}`, {}, cookie)).body;
    for (const movement of (refreshed.movements || []).filter(item => item.status === "open" && item.canonicalId.startsWith(`movement:${marker}:`))) {
      const run = runsForDate[cursor % runsForDate.length];
      const latestRun = refreshed.runs.find(item => item.canonicalId === run.canonicalId);
      try {
        await request(urls.logistics, "/api/logistics", { method: "POST", body: JSON.stringify({ action: "assign", by: "Franco", runId: latestRun.canonicalId, movementId: movement.canonicalId, expectedRunVersion: latestRun.version }) }, cookie);
        cursor += 1;
      } catch (error) { manifest.warnings.push(`${date}: movement ${movement.canonicalId} was not assigned: ${error.message}`); }
    }
  }
}

async function seed() {
  await guardLocal();
  const manifest = await readManifest(); manifest.warnings = [];
  const cookie = await localSession();
  const oplocs = await governed(cookie);
  await seedMenus(manifest, cookie);
  await seedGrabAndGo(manifest, cookie, oplocs);
  await seedHospitality(manifest, cookie, oplocs);
  await seedLogistics(manifest, cookie, oplocs);
  manifest.lastSeededAt = new Date().toISOString();
  await writeManifest(manifest);
  console.log(JSON.stringify({ marker, note, created: manifest.created.length, warnings: manifest.warnings }, null, 2));
}

async function verify() {
  await guardLocal();
  const cookie = await localSession();
  const oplocs = await governed(cookie);
  const manifest = await readManifest();
  const report = { marker, note, dates: {} };
  for (const date of dates) {
    const [menu, fulfilment, logistics, gngHaleon, gngXchange, hospitalityMnk, hospitalityAngel] = await Promise.all([
      request(urls.menu, "/api/rolling-menu?weekId=rolling-week:2026-08-24", {}, cookie).then(result => result.body),
      request(urls.hub, `/api/fulfilment-requirements?serviceDate=${date}`, {}, cookie).then(result => result.body),
      request(urls.logistics, `/api/logistics?serviceDate=${date}`, {}, cookie).then(result => result.body),
      request(urls.delivered, `/api/delivered-in/grab-and-go?oplocId=${encodeURIComponent(oplocs.byLabel.get("haleon").canonicalId)}`, {}, cookie).then(result => result.body).catch(() => ({})),
      request(urls.delivered, `/api/delivered-in/grab-and-go?oplocId=${encodeURIComponent(oplocs.byLabel.get("fika xchange").canonicalId)}`, {}, cookie).then(result => result.body).catch(() => ({})),
      request(urls.hub, "/api/hospitality-bookings?site=mnk", {}, cookie).then(result => result.body).catch(() => ({})),
      request(urls.hub, "/api/hospitality-bookings?site=angel-court", {}, cookie).then(result => result.body).catch(() => ({})),
    ]);
    const pubs = (menu.snapshot.days || []).filter(day => day.date === date && menu.publicationState?.[day.id]?.status === "published").length;
    const gngOrders = [...(gngHaleon.orders || []), ...(gngXchange.orders || [])].filter(order => order.deliveryDate === date && order.status === "submitted");
    const hospitalityRows = [...(hospitalityMnk.bookings || []), ...(hospitalityAngel.bookings || [])].filter(booking => booking.service?.eventDate === date);
    const productionOrders = [...(Object.values(hospitalityMnk.productionOrders || {})), ...(Object.values(hospitalityAngel.productionOrders || {}))].filter(order => hospitalityRows.some(booking => booking.canonicalId === order.bookingId));
    const requirements = fulfilment.requirements || [];
    const local = manifest.created.filter(item => item.date === date);
    const plannable = (logistics.planner?.workGroups || []).filter(item => ["unplanned", "partially_planned"].includes(item.planningState)).length + (logistics.planner?.movements || []).filter(item => item.planningState !== "planned").length;
    const wednesdayCheck = date === "2026-08-26" ? { expectedRuns: 0, expectedStops: 0, expectedUnassigned: plannable, passed: (logistics.runs || []).length === 0 && (logistics.stops || []).length === 0 && (logistics.planner?.summary?.unplanned || 0) + (logistics.planner?.movements || []).filter(item => item.planningState === "unplanned").length === plannable } : undefined;
    if (wednesdayCheck && !wednesdayCheck.passed) throw new Error(`Wednesday must remain an unplanned board: expected 0 runs, 0 stops and ${plannable} unassigned; received ${(logistics.runs || []).length} runs, ${(logistics.stops || []).length} stops.`);
    report.dates[date] = { menuPublications: pubs, grabAndGoOrders: gngOrders.length, hospitalityBookings: hospitalityRows.length, productionOrders: productionOrders.length, fulfilmentRequirements: requirements.length, duplicateFulfilmentIds: requirements.length - new Set(requirements.map(item => item.canonicalId)).size, workGroups: logistics.planner?.workGroups?.length || 0, movements: (logistics.movements || []).length, runs: (logistics.runs || []).length, stops: (logistics.stops || []).length, unassignedPlannable: plannable, wednesdayCheck, attention: logistics.planner?.summary?.attention || 0, uatRecords: local.length, governedOplocs: oplocs.all.length };
  }
  console.log(JSON.stringify(report, null, 2));
}

async function cleanup() {
  await guardLocal();
  const manifest = await readManifest();
  const warnings = ["Only deterministic UAT IDs in the manifest are eligible for cleanup.", "Source records without a supported deletion API are retained and listed for manual domain cancellation."];
  const removed = [];
  // Logistics currently has no domain delete command. Delete only the exact
  // manifest-owned documents through the local emulator REST surface; never
  // sweep by date or collection.
  const collection = { run: "fikaLogisticsDeliveryRunsV1", movement: "fikaLogisticsMovementRequestsV1", stop: "fikaLogisticsDeliveryStopsV1" };
  for (const item of manifest.created.filter(value => value.created && collection[value.type])) {
    const target = `http://127.0.0.1:8085/v1/projects/fika-os-local/databases/(default)/documents/${collection[item.type]}/${encodeURIComponent(item.id)}`;
    const response = await fetch(target, { method: "DELETE", headers: { Authorization: "Bearer owner" }, signal: AbortSignal.timeout(5000) });
    if (response.ok || response.status === 404) { removed.push(item); continue; }
    warnings.push(`Could not remove ${item.type} ${item.id} (HTTP ${response.status}).`);
  }
  warnings.push(...manifest.created.filter(value => value.type === "menu-publication" || value.type === "grab-and-go" || value.type === "hospitality-booking").map(value => `${value.type} ${value.id} retained: use its supported withdrawal/cancellation flow after reviewing ownership.`));
  manifest.created = manifest.created.filter(item => !removed.some(value => value.type === item.type && value.id === item.id));
  manifest.lastCleanupAt = new Date().toISOString();
  await writeManifest(manifest);
  console.log(JSON.stringify({ marker, note, removed, retained: manifest.created, warnings }, null, 2));
}

const command = process.argv[2];
try {
  if (!["seed", "verify", "cleanup"].includes(command)) throw new Error("Usage: node tools/uat/week.mjs <seed|verify|cleanup>");
  await ({ seed, verify, cleanup }[command])();
} catch (error) {
  console.error(`UAT ${command || "command"} failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
