/**
 * One canonical Hospitality Menu Item catalogue.
 *
 * Identity, allergens, dietary data, provider mappings, category and CPU production routing belong to ONE canonical
 * Hospitality Menu Item. Site-specific differences (availability, price, service placement, local presentation, lead
 * time) live on that site's Offering/Price, which point at the shared item.
 *
 * This module is pure: it inspects a snapshot, proposes merge groups from decisive evidence, flags everything else for
 * human review, and expresses an approved merge as declarative operations. It performs no I/O, so the same code drives
 * the read-only inventory, the dry-run verification and the (separately approved) migration.
 */
import { createHash } from "node:crypto";
import type { CanonicalRecord } from "./types";

export type RoutingDoc = { menuItemId: string; workstreams: string[]; version?: number; supersededBy?: string };
export type CatalogueSnapshot = { items: CanonicalRecord[]; offerings: CanonicalRecord[]; prices?: CanonicalRecord[]; routing: RoutingDoc[]; merges?: Array<{ sourceMenuItemId: string; survivorMenuItemId: string }> };

const text = (value: unknown) => (typeof value === "string" ? value : "");
const strings = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);
export const normaliseName = (value: unknown) => text(value).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim();
const normaliseSet = (value: unknown) => strings(value).map(normaliseName).filter(Boolean).sort().join("|");
const tokens = (value: unknown) => new Set(normaliseName(value).split(" ").filter(Boolean));
const jaccard = (a: Set<string>, b: Set<string>) => { const shared = [...a].filter(token => b.has(token)).length; const union = new Set([...a, ...b]).size; return union ? shared / union : 0; };
const stable = (value: unknown): string => JSON.stringify(value, (_key, inner) => inner && typeof inner === "object" && !Array.isArray(inner) ? Object.fromEntries(Object.entries(inner as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : inner);
const hash = (value: unknown) => createHash("sha256").update(stable(value)).digest("hex");

export const isActiveItem = (item: CanonicalRecord) => item.entityType === "Hospitality Menu Item" && item.lifecycleStatus !== "archived" && item.record.lifecycleState !== "archived";

/** Site an item was first created for. Only a hint about origin: it is never identity. */
export function originSite(item: CanonicalRecord) {
  const match = /^hospitality-menu-item:([a-z][a-z0-9-]*):(.+)$/.exec(item.canonicalId);
  return match ? match[1] : "unknown";
}

/** Exact source identifiers retained on the item (provider mappings, provider-owned legacy ids, and the id suffix of site-prefixed items). */
export function sourceIdentities(item: CanonicalRecord) {
  const ids = new Set<string>();
  for (const mapping of Array.isArray(item.record.providerMappings) ? item.record.providerMappings : []) {
    const id = text((mapping as Record<string, unknown>)?.sourceItemId); if (id) ids.add(id);
  }
  const owned = ((item.record.ownership as { providerOwned?: Record<string, unknown> } | undefined)?.providerOwned) || {};
  for (const key of ["sourceItemId", "legacySourceId"]) { const id = text(owned[key]); if (id) ids.add(id); }
  const suffix = /^hospitality-menu-item:[a-z][a-z0-9-]*:(.+)$/.exec(item.canonicalId)?.[1]; if (suffix) ids.add(suffix);
  return [...ids];
}

export type InventoryRow = { itemId: string; site: string; name: string; category: string; sourceIds: string[]; offerings: number; sites: string[]; routed: boolean; workstreams: string[] };
export function inventory(snapshot: CatalogueSnapshot): InventoryRow[] {
  const routing = new Map(snapshot.routing.map(row => [row.menuItemId, row]));
  return snapshot.items.filter(isActiveItem).map(item => {
    const offers = snapshot.offerings.filter(offering => offering.record.hospitalityMenuItemId === item.canonicalId && offering.record.lifecycleState !== "archived");
    return { itemId: item.canonicalId, site: originSite(item), name: text(item.record.name), category: text(item.record.category), sourceIds: sourceIdentities(item), offerings: offers.length, sites: [...new Set(offers.map(offering => text(offering.record.oplocId)))], routed: routing.has(item.canonicalId), workstreams: routing.get(item.canonicalId)?.workstreams ?? [] };
  }).sort((a, b) => a.name.localeCompare(b.name, "en-GB") || a.itemId.localeCompare(b.itemId));
}

/** Differences that make two items unsafe to merge automatically. */
function blockingDifferences(a: CanonicalRecord, b: CanonicalRecord) {
  const problems: string[] = [];
  if (normaliseName(a.record.name) !== normaliseName(b.record.name)) problems.push(`name differs (“${text(a.record.name)}” / “${text(b.record.name)}”)`);
  if (normaliseName(a.record.category) !== normaliseName(b.record.category)) problems.push(`category differs (“${text(a.record.category)}” / “${text(b.record.category)}”)`);
  if (normaliseSet(a.record.allergenInformation) !== normaliseSet(b.record.allergenInformation)) problems.push("allergen information differs");
  if (normaliseSet(a.record.dietaryInformation) !== normaliseSet(b.record.dietaryInformation)) problems.push("dietary information differs");
  return problems;
}
/** Differences that are preserved on the site Offering rather than blocking the merge. */
function presentationDifferences(a: CanonicalRecord, b: CanonicalRecord) {
  const notes: string[] = [];
  if (text(a.record.name) !== text(b.record.name)) notes.push("display name casing/punctuation differs");
  if (text(a.record.description).trim() !== text(b.record.description).trim()) notes.push("description differs");
  return notes;
}

export type ReviewGroup = { memberIds: string[]; reasons: string[] };
export type OperationKind = "repoint-offering" | "update-survivor" | "copy-routing" | "supersede-routing" | "archive-item" | "record-merge";
export type MergeOperation =
  | { op: "repoint-offering"; offeringId: string; fromItemId: string; toItemId: string; configurationPatch?: { displayName?: string; description?: string } }
  | { op: "update-survivor"; itemId: string; providerMappings: Array<Record<string, unknown>> }
  | { op: "copy-routing"; fromItemId: string; toItemId: string; workstreams: string[] }
  | { op: "supersede-routing"; itemId: string; supersededBy: string }
  | { op: "archive-item"; itemId: string; mergedInto: string }
  | { op: "record-merge"; sourceItemId: string; survivorItemId: string };
export type MergeGroup = {
  id: string; memberIds: string[]; survivorId: string; sourceIds: string[]; name: string; category: string;
  evidence: { sharedSourceIds: string[] }; notes: string[];
  offeringsRepointed: number; routing: { state: "none" | "inherit" | "agree"; workstreams: string[]; from?: string };
  operations: MergeOperation[];
};
export type CanonicalisationPlan = {
  groups: MergeGroup[]; review: ReviewGroup[]; unmatched: string[];
  summary: { activeItems: number; mergeGroups: number; itemsToArchive: number; offeringsRepointed: number; routingRecordsInherited: number; routingRecordsSuperseded: number; reviewGroups: number; unmatchedItems: number; itemsAfter: number };
  planHash: string;
};

class DisjointSet { private parent = new Map<string, string>(); find(x: string): string { if (!this.parent.has(x)) this.parent.set(x, x); const p = this.parent.get(x)!; if (p === x) return x; const root = this.find(p); this.parent.set(x, root); return root; } union(a: string, b: string) { this.parent.set(this.find(a), this.find(b)); } components(ids: string[]) { const out = new Map<string, string[]>(); for (const id of ids) { const root = this.find(id); out.set(root, [...(out.get(root) || []), id]); } return [...out.values()]; } }

const offeringKey = (offering: CanonicalRecord) => `${text(offering.record.oplocId)}|${text(offering.record.operationalAreaId)}|${text(offering.record.offeringMode)}`;

export function buildCanonicalisationPlan(snapshot: CatalogueSnapshot): CanonicalisationPlan {
  const items = snapshot.items.filter(isActiveItem).sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));
  const byId = new Map(items.map(item => [item.canonicalId, item]));
  const routing = new Map(snapshot.routing.filter(row => !row.supersededBy).map(row => [row.menuItemId, row]));
  const offeringsOf = (itemId: string) => snapshot.offerings.filter(offering => offering.record.hospitalityMenuItemId === itemId && offering.record.lifecycleState !== "archived");

  const decisive = new DisjointSet(); const reviewPairs: Array<[string, string, string]> = []; const inDecisive = new Set<string>();
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j]; const siteA = originSite(a), siteB = originSite(b);
    const shared = sourceIdentities(a).filter(id => sourceIdentities(b).includes(id));
    const crossSite = siteA !== siteB && siteA !== "unknown" && siteB !== "unknown";
    const sameName = normaliseName(a.record.name) === normaliseName(b.record.name);
    if (shared.length && crossSite) {
      const problems = blockingDifferences(a, b);
      if (!problems.length) { decisive.union(a.canonicalId, b.canonicalId); inDecisive.add(a.canonicalId); inDecisive.add(b.canonicalId); }
      else reviewPairs.push([a.canonicalId, b.canonicalId, `shared source id “${shared[0]}” but ${problems.join("; ")}`]);
    } else if (!crossSite && (sameName || shared.length)) {
      reviewPairs.push([a.canonicalId, b.canonicalId, `possible duplicate within ${siteA === siteB ? `site “${siteA}”` : "the catalogue"}: ${shared.length ? `shared source id “${shared[0]}”` : "same name"}`]);
    } else if (crossSite && sameName) {
      reviewPairs.push([a.canonicalId, b.canonicalId, "same name on different sites but no shared source id"]);
    } else if (crossSite && normaliseName(a.record.category) === normaliseName(b.record.category) && jaccard(tokens(a.record.name), tokens(b.record.name)) >= 0.5) {
      reviewPairs.push([a.canonicalId, b.canonicalId, `similar names in “${text(a.record.category)}” with no shared source id (“${text(a.record.name)}” / “${text(b.record.name)}”)`]);
    }
  }

  const groups: MergeGroup[] = []; const reviewSet = new DisjointSet(); const reviewReasons = new Map<string, Set<string>>();
  const sendToReview = (ids: string[], reason: string) => { for (let k = 1; k < ids.length; k++) reviewSet.union(ids[0], ids[k]); for (const id of ids) reviewReasons.set(id, new Set([...(reviewReasons.get(id) || []), reason])); };
  const merged = new Set<string>();

  for (const memberIds of decisive.components([...inDecisive]).filter(component => component.length > 1)) {
    const members = memberIds.map(id => byId.get(id)!);
    const sites = members.map(originSite);
    if (new Set(sites).size !== sites.length) { sendToReview(memberIds, "several items from the same site share evidence with another site"); continue; }
    // Survivor: the item that already carries a routing decision, then the one with the most offerings, then a stable order.
    const survivor = [...members].sort((a, b) => Number(routing.has(b.canonicalId)) - Number(routing.has(a.canonicalId)) || offeringsOf(b.canonicalId).length - offeringsOf(a.canonicalId).length || a.canonicalId.localeCompare(b.canonicalId))[0];
    const sources = members.filter(member => member.canonicalId !== survivor.canonicalId);
    const blockers: string[] = [];

    const keys = new Set(offeringsOf(survivor.canonicalId).map(offeringKey));
    const operations: MergeOperation[] = []; let repointed = 0; const notes = new Set<string>();
    for (const source of sources) {
      const presentation = presentationDifferences(survivor, source); presentation.forEach(note => notes.add(`${source.canonicalId}: ${note}`));
      for (const offering of offeringsOf(source.canonicalId)) {
        const key = offeringKey(offering);
        if (keys.has(key)) { blockers.push(`both items already have a ${key.replace(/\|/g, " / ")} offering`); continue; }
        keys.add(key); repointed++;
        const patch: { displayName?: string; description?: string } = {};
        if (text(source.record.name) !== text(survivor.record.name)) patch.displayName = text(source.record.name);
        if (text(source.record.description).trim() !== text(survivor.record.description).trim() && text(source.record.description).trim()) patch.description = text(source.record.description).trim();
        operations.push({ op: "repoint-offering", offeringId: offering.canonicalId, fromItemId: source.canonicalId, toItemId: survivor.canonicalId, ...(Object.keys(patch).length ? { configurationPatch: patch } : {}) });
      }
    }
    // Routing: decisions are stored once, on the survivor. Disagreement is never resolved automatically.
    const decisions = members.filter(member => routing.has(member.canonicalId)).map(member => ({ id: member.canonicalId, key: [...routing.get(member.canonicalId)!.workstreams].sort().join(",") }));
    const distinct = new Set(decisions.map(decision => decision.key));
    let routingState: MergeGroup["routing"] = { state: "none", workstreams: [] };
    if (distinct.size > 1) blockers.push(`routing decisions disagree (${decisions.map(decision => `${decision.id}: ${decision.key || "none"}`).join("; ")})`);
    else if (decisions.length) {
      const from = decisions[0].id; const workstreams = routing.get(from)!.workstreams;
      if (!routing.has(survivor.canonicalId)) { routingState = { state: "inherit", workstreams, from }; operations.push({ op: "copy-routing", fromItemId: from, toItemId: survivor.canonicalId, workstreams }); }
      else routingState = { state: "agree", workstreams, from: survivor.canonicalId };
      for (const decision of decisions) if (decision.id !== survivor.canonicalId) operations.push({ op: "supersede-routing", itemId: decision.id, supersededBy: survivor.canonicalId });
    }
    if (blockers.length) { sendToReview(memberIds, `merge blocked: ${blockers.join("; ")}`); continue; }

    const mappings = new Map<string, Record<string, unknown>>();
    for (const member of [survivor, ...sources]) for (const mapping of Array.isArray(member.record.providerMappings) ? member.record.providerMappings as Record<string, unknown>[] : []) mappings.set(`${text(mapping.provider)}|${text(mapping.sourceItemId)}`, mapping);
    operations.unshift({ op: "update-survivor", itemId: survivor.canonicalId, providerMappings: [...mappings.values()] });
    for (const source of sources) { operations.push({ op: "archive-item", itemId: source.canonicalId, mergedInto: survivor.canonicalId }, { op: "record-merge", sourceItemId: source.canonicalId, survivorItemId: survivor.canonicalId }); merged.add(source.canonicalId); }
    merged.add(survivor.canonicalId);
    const shared = sourceIdentities(survivor).filter(id => sources.every(source => sourceIdentities(source).includes(id)));
    groups.push({ id: hash(memberIds.slice().sort()).slice(0, 16), memberIds: memberIds.slice().sort(), survivorId: survivor.canonicalId, sourceIds: sources.map(source => source.canonicalId).sort(), name: text(survivor.record.name), category: text(survivor.record.category), evidence: { sharedSourceIds: shared }, notes: [...notes], offeringsRepointed: repointed, routing: routingState, operations });
  }

  // An item that already has an identity-matched twin is a known, distinct product: never suggest it as a duplicate of something else.
  for (const [a, b, reason] of reviewPairs) { if (merged.has(a) || merged.has(b)) continue; sendToReview([a, b], reason); }
  const review: ReviewGroup[] = reviewSet.components([...reviewReasons.keys()]).filter(component => component.length > 1).map(component => ({ memberIds: component.sort(), reasons: [...new Set(component.flatMap(id => [...(reviewReasons.get(id) || [])]))].sort() }))
    .sort((a, b) => a.memberIds[0].localeCompare(b.memberIds[0]));
  const touched = new Set([...groups.flatMap(group => group.memberIds), ...review.flatMap(group => group.memberIds)]);
  const unmatched = items.map(item => item.canonicalId).filter(id => !touched.has(id));
  const operations = groups.flatMap(group => group.operations);
  const summary = {
    activeItems: items.length, mergeGroups: groups.length, itemsToArchive: groups.reduce((sum, group) => sum + group.sourceIds.length, 0),
    offeringsRepointed: groups.reduce((sum, group) => sum + group.offeringsRepointed, 0),
    routingRecordsInherited: operations.filter(operation => operation.op === "copy-routing").length, routingRecordsSuperseded: operations.filter(operation => operation.op === "supersede-routing").length,
    reviewGroups: review.length, unmatchedItems: unmatched.length, itemsAfter: items.length - groups.reduce((sum, group) => sum + group.sourceIds.length, 0),
  };
  return { groups, review, unmatched, summary, planHash: hash({ groups: groups.map(group => ({ id: group.id, operations: group.operations })) }) };
}

/** Applies the declarative operations to an in-memory snapshot (dry-run and tests). Never mutates its input. */
export function applyOperations(snapshot: CatalogueSnapshot, operations: MergeOperation[], now = "1970-01-01T00:00:00.000Z"): CatalogueSnapshot {
  const next: CatalogueSnapshot = structuredClone(snapshot); next.merges = [...(next.merges || [])];
  for (const operation of operations) {
    if (operation.op === "update-survivor") { const item = next.items.find(candidate => candidate.canonicalId === operation.itemId)!; item.record = { ...item.record, providerMappings: operation.providerMappings, version: Number(item.record.version || 0) + 1, updatedAt: now }; }
    else if (operation.op === "repoint-offering") {
      const offering = next.offerings.find(candidate => candidate.canonicalId === operation.offeringId)!;
      const configuration = { ...(offering.record.configuration as Record<string, unknown> | undefined), ...(operation.configurationPatch || {}) };
      offering.record = { ...offering.record, hospitalityMenuItemId: operation.toItemId, ...(Object.keys(configuration).length ? { configuration } : {}), version: Number(offering.record.version || 0) + 1, updatedAt: now };
    }
    else if (operation.op === "copy-routing") next.routing.push({ menuItemId: operation.toItemId, workstreams: [...operation.workstreams], version: 1 });
    else if (operation.op === "supersede-routing") { const row = next.routing.find(candidate => candidate.menuItemId === operation.itemId); if (row) row.supersededBy = operation.supersededBy; }
    else if (operation.op === "archive-item") { const item = next.items.find(candidate => candidate.canonicalId === operation.itemId)!; item.record = { ...item.record, lifecycleState: "archived", version: Number(item.record.version || 0) + 1, updatedAt: now }; }
    else if (operation.op === "record-merge") next.merges!.push({ sourceMenuItemId: operation.sourceItemId, survivorMenuItemId: operation.survivorItemId });
  }
  return next;
}

/** Invariants that must hold after any canonical merge. A non-empty result blocks the migration. */
export function verifyMergeInvariants(before: CatalogueSnapshot, after: CatalogueSnapshot): string[] {
  const problems: string[] = [];
  if (after.offerings.length !== before.offerings.length) problems.push("offering count changed");
  if ((after.prices?.length ?? 0) !== (before.prices?.length ?? 0)) problems.push("price count changed");
  const activeItems = new Map(after.items.filter(isActiveItem).map(item => [item.canonicalId, item]));
  const keys = new Set<string>();
  for (const offering of after.offerings.filter(candidate => candidate.record.lifecycleState !== "archived")) {
    const itemId = text(offering.record.hospitalityMenuItemId);
    if (!activeItems.has(itemId)) problems.push(`offering ${offering.canonicalId} points at an archived or missing item (${itemId})`);
    const key = `${itemId}|${offeringKey(offering)}`; if (keys.has(key)) problems.push(`duplicate offering for ${key}`); keys.add(key);
    const prior = before.offerings.find(candidate => candidate.canonicalId === offering.canonicalId);
    if (prior && (prior.record.oplocId !== offering.record.oplocId || stable((prior.record.configuration as Record<string, unknown> | undefined) && { ...(prior.record.configuration as object), displayName: undefined, description: undefined }) !== stable((offering.record.configuration as Record<string, unknown> | undefined) && { ...(offering.record.configuration as object), displayName: undefined, description: undefined }))) problems.push(`site-specific offering data changed for ${offering.canonicalId}`);
  }
  const routingNow = new Map(after.routing.filter(row => !row.supersededBy).map(row => [row.menuItemId, row]));
  for (const row of before.routing.filter(candidate => !candidate.supersededBy)) {
    const resolved = after.merges?.find(merge => merge.sourceMenuItemId === row.menuItemId)?.survivorMenuItemId ?? row.menuItemId;
    const got = routingNow.get(resolved);
    if (!got || [...got.workstreams].sort().join(",") !== [...row.workstreams].sort().join(",")) problems.push(`routing decision for ${row.menuItemId} was lost or altered`);
  }
  for (const item of before.items.filter(isActiveItem)) { const merge = after.merges?.find(candidate => candidate.sourceMenuItemId === item.canonicalId); if (!merge && !activeItems.has(item.canonicalId)) problems.push(`item ${item.canonicalId} disappeared without a merge record`); }
  return problems;
}

/** One row per active canonical item, as shown in the Hub routing review. */
export function routingReviewRows(snapshot: CatalogueSnapshot) {
  const routing = new Map(snapshot.routing.filter(row => !row.supersededBy).map(row => [row.menuItemId, row]));
  return snapshot.items.filter(isActiveItem).map(item => ({
    itemId: item.canonicalId, name: text(item.record.name), routed: routing.has(item.canonicalId), workstreams: routing.get(item.canonicalId)?.workstreams ?? [],
    offeredAt: [...new Set(snapshot.offerings.filter(offering => offering.record.hospitalityMenuItemId === item.canonicalId && offering.record.lifecycleState !== "archived").map(offering => text(offering.record.oplocId)))].sort(),
  })).sort((a, b) => a.name.localeCompare(b.name, "en-GB"));
}

/**
 * A brochure may only create a NEW canonical item when nothing already in the catalogue is a plausible match.
 * Returns the existing candidates that must be considered (and chosen) first; empty means creation is allowed.
 */
export function existingCandidatesForNewItem(items: CanonicalRecord[], proposed: { name: string; category?: string; sourceItemId?: string }) {
  const name = normaliseName(proposed.name);
  return items.filter(isActiveItem).filter(item => (proposed.sourceItemId && sourceIdentities(item).includes(proposed.sourceItemId)) || normaliseName(item.record.name) === name).map(item => item.canonicalId);
}

/**
 * Finds the canonical item a site's source catalogue entry already maps to: identical exact source id from another
 * site, same normalised name and category, and identical allergen/dietary data. Anything weaker returns undefined so
 * the caller must make an explicit choice.
 */
export function resolveCanonicalItemForSource(existing: CanonicalRecord[], source: { siteKey: string; sourceItemId: string; name: string; category: string; dietaryInformation?: string[]; allergenInformation?: string[] }) {
  const probe = { canonicalId: `hospitality-menu-item:${source.siteKey}:${source.sourceItemId}`, entityType: "Hospitality Menu Item", record: { name: source.name, category: source.category, dietaryInformation: source.dietaryInformation ?? [], allergenInformation: source.allergenInformation ?? [] } } as unknown as CanonicalRecord;
  return existing.filter(isActiveItem).find(candidate => (candidate.canonicalId === probe.canonicalId) || (originSite(candidate) !== source.siteKey && sourceIdentities(candidate).includes(source.sourceItemId) && blockingDifferences(candidate, probe).length === 0));
}

export { hash as canonicalisationHash };
