/**
 * Pure read model for the Hospitality Catalogue admin screen: one row per canonical Item with its Offerings aggregated,
 * company defaults resolved against sparse site overrides, and routing state. No I/O.
 */
import { adaptCpuProductionWorkstreams } from "../../shared/production-workstreams";
import type { CanonicalRecord } from "./types";
import { suggestHospitalityMenuRouting } from "./hospitality-routing-suggestions";
import { buildCanonicalisationPlan, canonicalisationHash, originSite, sourceIdentities, type CatalogueSnapshot, type RoutingDoc } from "./hospitality-catalogue-canonicalisation";
import { ROUTING_CHOICE_WORKSTREAMS, type RoutingChoice, type CatalogueOfferingView, CataloguePayload, CataloguePriceView, CatalogueRoutingState, CatalogueRow, PriceMigrationView, ReviewGroupView } from "./hospitality-catalogue-types";

const text = (value: unknown) => (typeof value === "string" ? value : "");
const stringList = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
const optionalNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** UK business date (Europe/London), never a sliced UTC timestamp. */
export function ukBusinessDate(now: Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find(part => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export type ReviewDecisionDoc = { groupId: string; memberIds: string[]; decision: "merge" | "keep_separate" | "defer"; decidedAt?: string; decidedBy?: string };
export type CatalogueReadInput = CatalogueSnapshot & { prices: CanonicalRecord[]; merges?: CatalogueSnapshot["merges"]; decisions?: ReviewDecisionDoc[]; today?: string; /** Active OPLOCs: availability is the default at every one of these. */ oplocs?: Array<{ oplocId: string; active: boolean }> };

const isLivePrice = (record: CanonicalRecord) => record.entityType === "Hospitality Menu Price" && record.lifecycleStatus !== "archived" && record.record.lifecycleState === "active";
const appliesOn = (record: CanonicalRecord, date: string) => { const from = text(record.record.effectiveFrom), to = text(record.record.effectiveTo); return (!from || from <= date) && (!to || to >= date); };

function toPriceView(record: CanonicalRecord): CataloguePriceView {
  return { amount: Number(record.record.amount), vatRate: Number(record.record.vatRate), priceId: record.canonicalId, version: Number(record.record.version || 1), effectiveFrom: text(record.record.effectiveFrom) };
}
/** The Price in force on `date` for one scope; the latest effectiveFrom wins if data is (illegally) overlapping. */
export function currentPrice(prices: CanonicalRecord[], date: string) {
  return prices.filter(price => isLivePrice(price) && appliesOn(price, date)).sort((a, b) => text(b.record.effectiveFrom).localeCompare(text(a.record.effectiveFrom)))[0];
}

export function routingStateOf(doc: RoutingDoc | undefined): { state: CatalogueRoutingState; workstreams: string[]; version: number } {
  if (!doc || doc.supersededBy) return { state: "routing_required", workstreams: [], version: 0 };
  const raw = (doc as unknown as { workstreams?: unknown; views?: unknown });
  const adapted = adaptCpuProductionWorkstreams(Array.isArray(raw.workstreams) ? raw.workstreams : Array.isArray(raw.views) ? raw.views : []);
  const version = Number(doc.version || 1);
  if (adapted.unknown.length) return { state: "routing_required", workstreams: [], version }; // an unrecognised value is not a governed decision
  const set = new Set<string>(adapted.workstreams);
  if (set.has("sandwiches") && set.has("hospitality")) return { state: "routing_conflict", workstreams: [...set], version };
  if (set.has("sandwiches")) return { state: "cpu_sandwiches", workstreams: [...set], version };
  if (set.has("hospitality")) return { state: "cpu_hospitality", workstreams: [...set], version };
  if (set.has("delivered_in")) return { state: "cpu_delivered_in", workstreams: [...set], version };
  return { state: "in_house", workstreams: [], version }; // only an explicit empty decision is In house
}

export function reviewGroupId(memberIds: string[]) { return canonicalisationHash([...memberIds].sort()).slice(0, 16); }

export function analysePriceMigration(item: CanonicalRecord, offerings: CatalogueOfferingView[], hasDefaultPrice: boolean): PriceMigrationView {
  const standard = offerings.filter(offering => offering.status === "active" && offering.mode === "standard");
  const priced = standard.filter(offering => offering.price.override);
  if (hasDefaultPrice || !priced.length) return { status: "not_needed" };
  const values = standard.map(offering => ({ oplocId: offering.oplocId, offeringId: offering.offeringId, amount: offering.price.override?.amount, vatRate: offering.price.override?.vatRate, minimumQuantity: offering.minimum.override }));
  const first = values[0];
  const pricesAgree = values.every(value => value.amount === first.amount && value.vatRate === first.vatRate && value.amount !== undefined);
  const minimumsAgree = values.every(value => value.minimumQuantity === first.minimumQuantity);
  if (pricesAgree && minimumsAgree) return { status: "uniform", amount: first.amount!, vatRate: first.vatRate!, ...(first.minimumQuantity !== undefined ? { minimumQuantity: first.minimumQuantity } : {}), offeringIds: values.map(value => value.offeringId) };
  const reasons: string[] = [];
  if (!pricesAgree) reasons.push(values.some(value => value.amount === undefined) ? "some sites have no price" : "site prices differ");
  if (!minimumsAgree) reasons.push("site minimums differ");
  void item;
  return { status: "operator_required", reason: `${reasons.join(" and ")}; no governed business rule chooses between them, so an operator must confirm the company default.`, values, ...(optionalNumber(item.record.defaultMinimumQuantity) !== undefined ? { minimumQuantity: optionalNumber(item.record.defaultMinimumQuantity) } : {}) };
}

export function buildCatalogueRows(input: CatalogueReadInput): { rows: CatalogueRow[]; reviewGroups: ReviewGroupView[]; plan: ReturnType<typeof buildCanonicalisationPlan> } {
  const today = input.today || ukBusinessDate();
  const routing = new Map(input.routing.map(row => [row.menuItemId, row]));
  const pricesByOffering = new Map<string, CanonicalRecord[]>(), pricesByItem = new Map<string, CanonicalRecord[]>();
  for (const price of input.prices) {
    if (price.entityType !== "Hospitality Menu Price") continue;
    const offeringId = text(price.record.hospitalityMenuOfferingId), itemId = text(price.record.hospitalityMenuItemId);
    if (offeringId) pricesByOffering.set(offeringId, [...(pricesByOffering.get(offeringId) || []), price]);
    if (itemId) pricesByItem.set(itemId, [...(pricesByItem.get(itemId) || []), price]);
  }
  const offeringsByItem = new Map<string, CanonicalRecord[]>();
  for (const offering of input.offerings) offeringsByItem.set(text(offering.record.hospitalityMenuItemId), [...(offeringsByItem.get(text(offering.record.hospitalityMenuItemId)) || []), offering]);

  const plan = buildCanonicalisationPlan({ items: input.items, offerings: input.offerings, prices: input.prices, routing: input.routing, merges: input.merges });
  const decisions = new Map((input.decisions || []).map(decision => [decision.groupId, decision]));
  const reviewGroups: ReviewGroupView[] = plan.review.map(group => {
    const id = reviewGroupId(group.memberIds), decision = decisions.get(id);
    return { id, memberIds: group.memberIds, reasons: group.reasons, ...(decision ? { decision: decision.decision, decidedAt: decision.decidedAt, decidedBy: decision.decidedBy } : {}) };
  });
  const undecided = new Set(reviewGroups.filter(group => !group.decision || group.decision === "defer").flatMap(group => group.memberIds));

  const rows = input.items.filter(item => item.entityType === "Hospitality Menu Item").map<CatalogueRow>(item => {
    const defaultRecord = currentPrice(pricesByItem.get(item.canonicalId) || [], today);
    const defaultPrice = defaultRecord ? toPriceView(defaultRecord) : undefined;
    const defaultMinimumQuantity = optionalNumber(item.record.defaultMinimumQuantity);
    const offerings = (offeringsByItem.get(item.canonicalId) || []).map<CatalogueOfferingView>(offering => {
      const mode = offering.record.offeringMode === "quote_only" ? "quote_only" : "standard";
      const overrideRecord = currentPrice(pricesByOffering.get(offering.canonicalId) || [], today);
      const override = overrideRecord ? toPriceView(overrideRecord) : undefined;
      const configuration = (offering.record.configuration || {}) as Record<string, unknown>;
      const minimumOverride = optionalNumber(offering.record.minimumQuantity);
      const price: CatalogueOfferingView["price"] = mode === "quote_only" ? { source: "quote_only" }
        : override ? { source: defaultPrice ? "overrides" : "site_only", effective: override, override, ...(defaultPrice && defaultPrice.amount === override.amount && defaultPrice.vatRate === override.vatRate ? { redundant: true } : {}) }
        : defaultPrice ? { source: "inherits", effective: defaultPrice } : { source: "none" };
      const minimum: CatalogueOfferingView["minimum"] = minimumOverride !== undefined ? { source: defaultMinimumQuantity !== undefined ? "overrides" : "site_only", effective: minimumOverride, override: minimumOverride, ...(minimumOverride === defaultMinimumQuantity ? { redundant: true } : {}) }
        : defaultMinimumQuantity !== undefined ? { source: "inherits", effective: defaultMinimumQuantity } : { source: "none" };
      return {
        offeringId: offering.canonicalId, version: Number(offering.record.version || 1), oplocId: text(offering.record.oplocId),
        ...(offering.record.operationalAreaId ? { operationalAreaId: text(offering.record.operationalAreaId) } : {}),
        mode, status: offering.record.lifecycleState === "archived" ? "archived" : "active", available: offering.record.available !== false,
        noEffect: offering.record.lifecycleState !== "archived" && offering.record.available !== false && mode === (item.record.defaultOfferingMode === "quote_only" ? "quote_only" : "standard") && !offering.record.operationalAreaId && (offering.record.minimumGuests === undefined || offering.record.minimumGuests === item.record.defaultMinimumGuests) && (offering.record.noticeRequiredDays === undefined || offering.record.noticeRequiredDays === item.record.defaultNoticeRequiredDays) && !text(configuration.displayName) && !text(configuration.description) && (!Object.keys(configuration).length || JSON.stringify(configuration) === JSON.stringify(item.record.configuration)) && (minimumOverride === undefined || minimumOverride === defaultMinimumQuantity) && (!override || Boolean(defaultPrice && defaultPrice.amount === override.amount && defaultPrice.vatRate === override.vatRate)),
        ...(offering.record.retiredReason ? { retiredReason: offering.record.retiredReason as "item-archived" | "redundant-default" } : {}),
        ...(text(configuration.displayName) ? { displayName: text(configuration.displayName) } : {}), ...(text(configuration.description) ? { description: text(configuration.description) } : {}),
        price, minimum,
      };
    }).sort((a, b) => a.oplocId.localeCompare(b.oplocId) || (a.operationalAreaId || "").localeCompare(b.operationalAreaId || ""));
    const active = offerings.filter(offering => offering.status === "active");
    const activeSites = (input.oplocs || []).filter(oploc => oploc.active).map(oploc => oploc.oplocId);
    const restricted = Array.isArray(item.record.allowedOplocIds) ? item.record.allowedOplocIds as string[] : undefined;
    const unavailableAt = [...new Set([...activeSites.filter(id => restricted && !restricted.includes(id)), ...active.filter(offering => !offering.available && !offering.operationalAreaId).map(offering => offering.oplocId)])].sort();
    const status = item.lifecycleStatus === "archived" || item.record.lifecycleState === "archived" ? "archived" : "active";
    const route = routingStateOf(routing.get(item.canonicalId));
    const needsReview: CatalogueRow["needsReview"] = [];
    if (status === "active") {
      if (route.state === "routing_required") needsReview.push("routing_required");
      if (route.state === "routing_conflict") needsReview.push("routing_conflict");
      if (!defaultPrice && activeSites.length > 0) needsReview.push("price_missing");
      if (undecided.has(item.canonicalId)) needsReview.push("duplicate_candidate");
    }
    const site = originSite(item);
    const suggestion = route.state === "routing_required" ? suggestHospitalityMenuRouting(item.record.providerMappings) : undefined;
    const suggestedChoice = suggestion && suggestion.confidence === "medium" ? (Object.entries(ROUTING_CHOICE_WORKSTREAMS) as Array<[RoutingChoice, string[]]>).find(([, workstreams]) => workstreams.length === suggestion.workstreams.length && workstreams.every(value => (suggestion.workstreams as string[]).includes(value)))?.[0] : undefined;
    return {
      itemId: item.canonicalId, version: Number(item.record.version || 1), name: text(item.record.name), category: text(item.record.category), description: text(item.record.description), status,
      routing: route, ...(suggestion && suggestedChoice ? { routingSuggestion: { choice: suggestedChoice, reason: suggestion.reason } } : {}), ...(defaultPrice ? { defaultPrice } : {}), ...(defaultMinimumQuantity !== undefined ? { defaultMinimumQuantity } : {}),
      ...(restricted ? { permittedSites: [...new Set(restricted)].sort() } : {}), offerings, availableAt: status === "active" ? activeSites.filter(id => !unavailableAt.includes(id)).sort() : [], unavailableAt,
      overrideCount: active.filter(offering => !offering.noEffect).reduce((sum, offering) => sum + Number(!offering.available) + Number(offering.price.source === "overrides") + Number(offering.minimum.source === "overrides") + Number(Boolean(offering.displayName)) + Number(Boolean(offering.description)), 0),
      needsReview, ...(site !== "unknown" ? { siteCopyOf: site } : {}), sourceIds: sourceIdentities(item),
      providerMappings: (Array.isArray(item.record.providerMappings) ? item.record.providerMappings : []) as CatalogueRow["providerMappings"],
      dietaryInformation: stringList(item.record.dietaryInformation), allergenInformation: stringList(item.record.allergenInformation),
      priceMigration: analysePriceMigration(item, offerings, Boolean(defaultPrice)),
    };
  }).sort((a, b) => a.name.localeCompare(b.name, "en-GB") || a.itemId.localeCompare(b.itemId));
  return { rows, reviewGroups, plan };
}

export function buildCataloguePayload(input: CatalogueReadInput, oplocs: CataloguePayload["oplocs"], canManage: boolean, now: Date = new Date()): CataloguePayload {
  const { rows, reviewGroups, plan } = buildCatalogueRows({ oplocs: oplocs.map(oploc => ({ oplocId: oploc.oplocId, active: oploc.active })), ...input });
  const active = rows.filter(row => row.status === "active");
  return {
    generatedAt: now.toISOString(), canManage, rows, oplocs, reviewGroups,
    canonicalisation: { itemsAwaitingConsolidation: plan.groups.reduce((sum, group) => sum + group.memberIds.length, 0), mergeGroupsReady: plan.groups.length, reviewGroups: reviewGroups.filter(group => group.decision !== "keep_separate").length },
    counts: { active: active.length, archived: rows.length - active.length, needsReview: active.filter(row => row.needsReview.length).length, routingRequired: active.filter(row => row.routing.state === "routing_required").length },
  };
}
