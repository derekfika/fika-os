import { appBaseUrl, addDays, fetchJson, mondayOf, unavailableSource } from "./common.mjs";
import { discoverBuilds } from "./builds.mjs";

const asArray = (value) => Array.isArray(value) ? value : [];
const first = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");

export function normalizeMenuState(body, serviceDate, oplocId) {
  const publications = asArray(body?.publications || (body?.publication ? [body.publication] : []));
  const candidates = publications.flatMap((publication) => asArray(publication.days).filter((day) => day?.date === serviceDate).map((day) => ({ publication, day })));
  const selected = candidates.find(({ day }) => day.status === "published") || candidates[0];
  if (!selected) return { available: true, date: serviceDate, oplocId, status: "missing", publicationId: null, day: null, targetHasAllocations: false, totalPortions: 0, evidence: "No publication day for the target date." };
  const entries = asArray(selected.day.entries);
  const allocations = entries.flatMap((entry) => asArray(entry.allocations).filter((allocation) => first(allocation.destinationId, allocation.oplocId, allocation.destinationOplocId) === oplocId).map((allocation) => ({ entry, allocation })));
  const totalPortions = allocations.reduce((sum, { entry, allocation }) => sum + Number(first(allocation.quantity, allocation.portions, entry.portions, 0)) || 0, 0);
  return { available: true, date: serviceDate, oplocId, status: selected.day.status || "unknown", publicationId: first(selected.publication.publicationId, selected.publication.id, null), publicationWeek: first(selected.publication.weekCommencing, selected.publication.sourceWeekId, null), publicationDayId: first(selected.day.publicationDayId, selected.day.id, null), version: Number(selected.day.version) || null, contentHash: first(selected.day.contentHash, selected.day.dayContentHash, null), targetHasAllocations: allocations.length > 0, totalPortions, allocationCount: allocations.length };
}

export function normalizeCpuState(body, serviceDate, oplocId) {
  const signatures = asArray(body?.signatures);
  const sourceOrders = asArray(body?.sourceOrders || body?.projection?.sourceOrders);
  const queueOrders = asArray(body?.orders).filter((order) => !order?.destinationOplocId || order.destinationOplocId === oplocId);
  const sourceIdentity = first(body?.sourceIdentity, sourceOrders[0]?.sourceIdentity, body?.projection?.sourceLineage?.[0]);
  const scopes = signatures.map((signature) => signature.scope).filter(Boolean);
  const sourceHash = first(sourceIdentity?.sourceContentHash, scopes[0]?.sourceContentHash, body?.package?.sourceHash, body?.sourceHash, null);
  const reviewStatus = first(body?.status, body?.reviewStatus, sourceOrders.length ? "pending" : null);
  const packageHead = body?.package || (body?.packageVersion !== undefined ? { packageVersion: body.packageVersion, contentHash: body.contentHash, sourceVersion: body.sourceVersion } : null);
  const queueHashes = queueOrders.map((order) => order.sourceContentHash).filter(Boolean);
  return { available: true, serviceDate, oplocId, orderIds: [...new Set([...sourceOrders, ...queueOrders].map((order) => first(order.productionOrderId, order.orderId, order.canonicalId, order.id)).filter(Boolean))], reviewStatus: reviewStatus || "unknown", authoritativeReviewedState: reviewStatus === "signed" ? "signed" : reviewStatus === "pending" ? "pending" : reviewStatus === "missing" ? "missing" : "unknown", signatureRoles: signatures.map((signature) => signature.role).filter(Boolean), completedSignatureRoles: asArray(body?.completedSignatureRoles), releaseStatus: first(body?.release?.status, body?.package?.status, body?.package?.state, body?.packageVersion !== undefined ? "present" : null, reviewStatus === "signed" ? "signed" : null), sourceHash: first(sourceHash, ...queueHashes, null), sourcePublicationDayId: first(sourceIdentity?.sourcePublicationDayId, scopes[0]?.sourcePublicationDayId, null), sourceVersion: first(sourceIdentity?.sourceVersion, scopes[0]?.sourceVersion, body?.sourceVersion, null), package: packageHead ? { packageVersion: packageHead.packageVersion, contentHash: packageHead.contentHash, sourceHash: packageHead.sourceHash, sourceVersion: packageHead.sourceVersion } : null };
}

export function normalizeDeliveredState(body, serviceDate, oplocId, response = { ok: true, status: 200 }) {
  const projection = body?.projection || (body?.serviceDate ? body : null);
  if (!response.ok && response.status === 404) return { available: true, serviceDate, oplocId, targetDatePresent: false, projectionState: "absent", freshness: "unknown", completeness: "missing", menu: "missing", cpu: "unknown", sourceLineage: null, unavailableServiceDates: Array.isArray(body?.unavailableServiceDates) ? body.unavailableServiceDates : null, withdrawnServiceDates: Array.isArray(body?.withdrawnServiceDates) ? body.withdrawnServiceDates : null, evidence: "The targeted Delivered-In endpoint reported no day projection." };
  if (!response.ok || !projection) return { available: false, serviceDate, oplocId, targetDatePresent: false, projectionState: "unavailable", freshness: "unknown", completeness: "unknown", menu: "unknown", cpu: "unknown", sourceLineage: null, unavailableServiceDates: Array.isArray(body?.unavailableServiceDates) ? body.unavailableServiceDates : null, withdrawnServiceDates: Array.isArray(body?.withdrawnServiceDates) ? body.withdrawnServiceDates : null, ...unavailableSource("delivered-in", response, "Delivered-In projection was not available.") };
  const state = projection.state || {};
  return { available: true, serviceDate, oplocId, targetDatePresent: projection.serviceDate === serviceDate, projectionState: projection.state?.status || (state.completeness === "complete" && state.freshness === "current" ? "current" : "partial"), freshness: state.freshness || "unknown", completeness: state.completeness || "unknown", menu: state.menu || (asArray(projection.entries).length ? "present" : "empty"), cpu: state.cpu || "unknown", sourceLineage: projection.sourceLineage || null, unavailableServiceDates: Array.isArray(body?.unavailableServiceDates) ? body.unavailableServiceDates : null, withdrawnServiceDates: Array.isArray(body?.withdrawnServiceDates) ? body.withdrawnServiceDates : null, exceptions: asArray(state.exceptions).map((exception) => ({ code: exception.code, source: exception.source, message: exception.message })) };
}

export async function captureState({ serviceDate, oplocId, env = process.env, fetchImpl = globalThis.fetch, builds = true } = {}) {
  const week = mondayOf(serviceDate);
  const menuUrl = `${appBaseUrl("menu-planning", env)}/api/rolling-menu/publications?fromWeek=${encodeURIComponent(week)}&toWeek=${encodeURIComponent(addDays(week, 7))}`;
  // The existing review GET can rebuild a missing package on its fallback
  // path. Keep the default capture strictly read-only by using the CPU
  // production queue and projection-head endpoints; an operator may provide an approved read-only
  // review URL explicitly when that endpoint exists in their environment.
  const cpuUrl = env.FIKA_UAT_CPU_REVIEW_URL ? new URL(env.FIKA_UAT_CPU_REVIEW_URL) : new URL(`${appBaseUrl("cpu-production", env)}/api/production`);
  cpuUrl.searchParams.set("serviceDate", serviceDate);
  if (env.FIKA_UAT_CPU_REVIEW_URL) cpuUrl.searchParams.set("oplocId", oplocId);
  else cpuUrl.searchParams.set("scope", "delivered_in");
  const cpuHeadUrl = env.FIKA_UAT_CPU_REVIEW_URL ? null : new URL(`${appBaseUrl("cpu-production", env)}/api/production?projectionHead=1`);
  if (cpuHeadUrl) cpuHeadUrl.searchParams.set("serviceDate", serviceDate);
  const cpuReviewConfigured = Boolean(env.FIKA_UAT_CPU_REVIEW_URL);
  const deliveredUrl = `${appBaseUrl("delivered-in", env)}/api/delivered-in/projection?oplocId=${encodeURIComponent(oplocId)}&serviceDate=${encodeURIComponent(serviceDate)}`;
  const [menuResponse, cpuResponse, cpuHeadResponse, deliveredResponse, buildResult] = await Promise.all([
    fetchJson(menuUrl, { cookie: env.FIKA_UAT_COOKIE, fetchImpl }),
    fetchJson(cpuUrl.toString(), { cookie: env.FIKA_UAT_COOKIE, fetchImpl }),
    cpuHeadUrl ? fetchJson(cpuHeadUrl.toString(), { cookie: env.FIKA_UAT_COOKIE, fetchImpl }) : Promise.resolve(null),
    fetchJson(deliveredUrl, { cookie: env.FIKA_UAT_COOKIE, fetchImpl }),
    builds ? discoverBuilds({ env, fetchImpl }) : Promise.resolve(null),
  ]);
  const menu = menuResponse.ok ? normalizeMenuState(menuResponse.body, serviceDate, oplocId) : { ...unavailableSource("menu-planning", menuResponse, "Menu Planning state could not be queried."), date: serviceDate, oplocId, status: "unknown", targetHasAllocations: null, totalPortions: null };
  const queueOrReviewCpu = cpuResponse.ok ? normalizeCpuState(cpuResponse.body, serviceDate, oplocId) : { ...unavailableSource("cpu-production", cpuResponse, "CPU production/review state could not be queried."), serviceDate, oplocId, reviewStatus: "unknown", authoritativeReviewedState: "unknown", signatureRoles: [], orderIds: [], sourceHash: null };
  const packageHeadCpu = cpuHeadResponse?.ok ? normalizeCpuState(cpuHeadResponse.body, serviceDate, oplocId) : null;
  const cpu = { ...queueOrReviewCpu, ...(packageHeadCpu ? { releaseStatus: packageHeadCpu.releaseStatus, package: packageHeadCpu.package, sourceVersion: packageHeadCpu.sourceVersion || queueOrReviewCpu.sourceVersion } : {}), ...(cpuReviewConfigured ? {} : { evidence: "CPU review endpoint was not queried because its existing GET may rebuild a missing package; production-order and projection-head evidence are read-only." }) };
  const delivered = normalizeDeliveredState(deliveredResponse.body, serviceDate, oplocId, deliveredResponse);
  return { generatedAt: new Date().toISOString(), target: { serviceDate, oplocId }, menu, cpu, deliveredIn: delivered, builds: buildResult, requestIds: { menu: menuResponse.requestId, cpu: cpuResponse.requestId, deliveredIn: deliveredResponse.requestId } };
}

export function formatState(state) {
  const menu = state.menu;
  const cpu = state.cpu;
  const di = state.deliveredIn;
  const lines = ["TARGET", `  Date: ${state.target.serviceDate}`, `  OPLOC: ${state.target.oplocId}`, "", "MENU", `  Publication: ${menu.publicationId || "unavailable"}`, `  Day: ${menu.version ? `v${menu.version} / ${menu.status}` : menu.status || "unknown"}`, `  Hash: ${menu.contentHash || "unavailable"}`, `  Target allocations: ${menu.targetHasAllocations === true ? "YES" : menu.targetHasAllocations === false ? "NO" : "UNKNOWN"}`, `  Portions: ${menu.available ? menu.totalPortions ?? "unknown" : "unknown"}`, "", "CPU", `  Review: ${cpu.reviewStatus || "unknown"}`, `  Signature roles: ${cpu.signatureRoles?.join(", ") || "unknown"}`, `  Release/package: ${cpu.releaseStatus || "unknown"}`, `  Source hash: ${cpu.sourceHash || "unavailable"}`, "", "DELIVERED-IN", `  Target date: ${di.targetDatePresent ? "present" : di.available === false ? "unknown" : "absent"}`, `  Projection: ${di.projectionState || "unknown"}`, `  Freshness: ${di.freshness || "unknown"}`, `  Completeness: ${di.completeness || "unknown"}`, `  Menu: ${di.menu || "unknown"}`, `  CPU: ${di.cpu || "unknown"}`, `  Unavailable marker: ${Array.isArray(di.unavailableServiceDates) ? di.unavailableServiceDates.includes(state.target.serviceDate) ? "YES" : "NO" : "UNKNOWN"}`, `  Withdrawn marker: ${Array.isArray(di.withdrawnServiceDates) ? di.withdrawnServiceDates.includes(state.target.serviceDate) ? "YES" : "NO" : "UNKNOWN"}`];
  const unavailable = [menu, cpu, di].filter((source) => source.available === false).map((source) => `  ${source.source || "source"}: ${source.message || "unavailable"}`);
  if (unavailable.length) lines.push("", "SOURCES", ...unavailable);
  return lines.join("\n");
}
