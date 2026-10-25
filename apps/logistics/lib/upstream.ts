import type { FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import { requiredUpstreamUrl } from "./runtime";
export type GovernedOploc = { id:string; label:string; address?:string };
export type ProductionContext = { canonicalId:string; sourceBookingId?:string; status?:string; workflowStatus?:string; serviceDate?:string; clientName?:string; serviceType?:string; guestCount?:number; origin?:string; productionCategory?:string; destinationLabel?:string; requiredBy?:string; serviceWindow?:{startTime:string;endTime?:string}; operationalNotes?:string };
export type AuthoritativeProductionOrder = { canonicalId:string; origin:string; status:string; version:number; sourceEntityId?:string; sourceVersion?:number; sourcePublicationId?:string; sourcePublicationDayId?:string; sourceContentHash?:string; destinationOplocId?:string; serviceDate?:string; supersededBy?:string };
type AuthoritativePublicationDay = { publicationDayId:string; sourceDayId:string; date:string; version:number; status:string; contentHash:string; entries:Array<{ allocations:Array<{ destinationId?:string }> }> };
type AuthoritativePublication = { publicationId:string; sourceWeekId:string; days:AuthoritativePublicationDay[] };
const hub = requiredUpstreamUrl("FIKA_HUB_BASE_URL");
const cpu = requiredUpstreamUrl("FIKA_CPU_BASE_URL");
const menu = requiredUpstreamUrl("MENU_PLANNING_BASE_URL");
function requestInit(cookie?:string): RequestInit { const headers: Record<string,string> = {}; if (cookie) headers.cookie = cookie; if (process.env.FIKA_INTERNAL_API_TOKEN) headers["x-fika-internal-token"] = process.env.FIKA_INTERNAL_API_TOKEN; return { cache:"no-store", redirect:"error" as const, ...(Object.keys(headers).length ? { headers } : {}) }; }
function upstreamUnavailable(message:string, cause?:unknown) { return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), { status:503 }); }
async function fetchUpstream(url:string, label:string, cookie?:string):Promise<Response> { let response:Response; try { response = await fetch(url, requestInit(cookie)); } catch (error) { throw upstreamUnavailable(`${label} request failed.`, error); } if (!response.ok) throw upstreamUnavailable(`${label} read failed (${response.status}).`); return response; }
export async function fetchRequirements(serviceDate?:string, cookie?:string):Promise<FulfilmentRequirement[]> { const response = await fetchUpstream(`${hub}/api/fulfilment-requirements${serviceDate ? `?serviceDate=${encodeURIComponent(serviceDate)}` : ""}`, "Integration Hub fulfilment", cookie); const body = await response.json() as {requirements?:FulfilmentRequirement[]}; return body.requirements || []; }
export async function fetchAuthoritativeProductionOrder(canonicalId:string, cookie?:string):Promise<AuthoritativeProductionOrder | undefined> { const params = new URLSearchParams({ canonicalId }); const response = await fetchUpstream(`${hub}/api/production?${params.toString()}`, "Integration Hub Production Order", cookie); const body = await response.json() as {order?:AuthoritativeProductionOrder}; return body.order; }
async function fetchAuthoritativeMenuPublication(publicationId:string, cookie?:string):Promise<AuthoritativePublication | undefined> {
  const params = new URLSearchParams({ publicationId });
  let response:Response;
  try { response = await fetch(`${menu}/api/rolling-menu/publications?${params}`, { cache:"no-store", redirect:"error", headers: cookie ? { cookie } : {} }); }
  catch (error) { throw upstreamUnavailable("Menu Planning publication authority request failed.", error); }
  if (!response.ok) throw upstreamUnavailable(`Menu Planning publication authority read failed (${response.status}).`);
  const body = await response.json() as {publication?:AuthoritativePublication};
  return body.publication;
}
function menuProductionOrderId(requirement:FulfilmentRequirement) {
  // Keep in step with Integration Hub materialisedProductionId(): this is the
  // canonical identity used when a menu publication becomes a Production Order.
  const safe = (value:string) => value.replace(/[^A-Za-z0-9:_-]+/g, "_");
  return `production-order:v1:menu-planning:${safe(requirement.sourceEntityId)}:${safe(requirement.destinationOplocId)}`;
}
/** Recheck both Menu Planning publication authority and Hub's canonical order immediately before Logistics commits menu-originated work. */
export async function assertMenuProductionAuthority(requirements:FulfilmentRequirement[], cookie?:string, expectedRequirementIds?:readonly string[]):Promise<void> {
  const expectedIds = [...new Set(expectedRequirementIds || requirements.map(requirement => requirement.canonicalId))];
  const byId = new Map(requirements.map(requirement => [requirement.canonicalId, requirement]));
  const missingIds = expectedIds.filter(id => !byId.has(id));
  if (missingIds.length) throw Object.assign(new Error("Expected fulfilment authority is missing; refresh Logistics before continuing."), { status:503 });
  await Promise.all(expectedIds.map(async id => {
    const requirement = byId.get(id)!;
    const directMenuSource = requirement.sourceDomain === "menu-planning";
    const deliveredInOrderSource = requirement.sourceDomain === "cpu-production" && requirement.workstream === "Delivered-In";
    if (!directMenuSource && !deliveredInOrderSource) return;
    if (requirement.status === "withdrawn") throw Object.assign(new Error("Menu Planning fulfilment is withdrawn; refresh Logistics before continuing."), { status: 409 });
    const canonicalId = directMenuSource ? menuProductionOrderId(requirement) : requirement.sourceEntityId;
    const order = await fetchAuthoritativeProductionOrder(canonicalId, cookie);
    if (!order) throw Object.assign(new Error("Menu Planning Production Order authority is unavailable; refresh Logistics before continuing."), { status: 503 });
    if (order.origin !== "menu_planning" || order.canonicalId !== canonicalId || order.status === "cancelled" || order.supersededBy) throw Object.assign(new Error("Menu Planning source is withdrawn or superseded; refresh Logistics before continuing."), { status: 409 });
    const sourceVersionMatches = directMenuSource ? order.sourceVersion === requirement.sourceVersion : order.version === requirement.sourceVersion;
    if (!sourceVersionMatches || order.destinationOplocId !== requirement.destinationOplocId || order.serviceDate !== requirement.serviceDate || directMenuSource && order.sourceEntityId !== requirement.sourceEntityId) throw Object.assign(new Error("Menu Planning source changed. Reconcile fulfilment before continuing."), { status: 409 });
    const publicationId = order.sourcePublicationId;
    const publicationDayId = order.sourcePublicationDayId;
    if (!publicationId || !publicationDayId || !order.sourceContentHash) throw Object.assign(new Error("Menu Planning publication lineage is incomplete; refresh Logistics before continuing."), { status:503 });
    const publication = await fetchAuthoritativeMenuPublication(publicationId, cookie);
    if (!publication) throw Object.assign(new Error("Menu Planning publication authority is unavailable; refresh Logistics before continuing."), { status:503 });
    if (publication.publicationId !== publicationId || publication.publicationId !== `menu-publication:${publication.sourceWeekId}` || (publication as AuthoritativePublication & { publicationStatus?:string }).publicationStatus === "withdrawn") throw Object.assign(new Error("Menu Planning publication identity is inconsistent or withdrawn; refresh Logistics before continuing."), { status:409 });
    const day = publication.days.find(candidate => candidate.publicationDayId === publicationDayId);
    const currentDay = publication.days.filter(candidate => candidate.sourceDayId === requirement.sourceEntityId && candidate.status === "published").sort((left, right) => right.version - left.version)[0];
    const siteAllocationExists = day?.entries.some(entry => entry.allocations.some(allocation => allocation.destinationId === requirement.destinationOplocId));
    const menuSourceVersion = directMenuSource ? requirement.sourceVersion : order.sourceVersion;
    if (!menuSourceVersion || !day || day.sourceDayId !== requirement.sourceEntityId || day.date !== requirement.serviceDate || day.version !== menuSourceVersion || day.contentHash !== order.sourceContentHash || day.status !== "published" || currentDay?.publicationDayId !== publicationDayId || !siteAllocationExists) throw Object.assign(new Error("Menu Planning publication day is withdrawn, superseded or inconsistent with this Logistics requirement."), { status:409 });
  }));
}
export async function fetchRequirementsForDateRange(fromDate:string, toDateExclusive:string, cookie?:string):Promise<FulfilmentRequirement[]> { const params = new URLSearchParams({ serviceDateFrom: fromDate, serviceDateToExclusive: toDateExclusive }); const response = await fetchUpstream(`${hub}/api/fulfilment-requirements?${params.toString()}`, "Integration Hub fulfilment", cookie); const body = await response.json() as {requirements?:FulfilmentRequirement[]}; return body.requirements || []; }
export async function fetchOplocs(cookie?:string):Promise<GovernedOploc[]> { const response = await fetchUpstream(`${hub}/api/internal/oplocs`, "Integration Hub OPLOC", cookie); const body = await response.json() as {oplocs?:Array<{canonicalId:string;label:string;address?:string}>}; const oplocs=(body.oplocs || []).map(oploc=>({id:oploc.canonicalId,label:oploc.label.trim(),...(oploc.address?.trim() ? { address: oploc.address.trim() } : {})})); if (!oplocs.length) throw new Error("Integration Hub returned no governed OPLOCs."); return oplocs; }
export async function fetchProductionContexts(serviceDate:string, cookie?:string):Promise<ProductionContext[]> { const response = await fetchUpstream(`${cpu}/api/production?view=site_manager&serviceDate=${encodeURIComponent(serviceDate)}`, "CPU Production", cookie); const body = await response.json() as {orders?:ProductionContext[]}; return (body.orders || []).filter(order => !order.serviceDate || order.serviceDate === serviceDate); }
