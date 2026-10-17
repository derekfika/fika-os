/**
 * Governed server-side commands for the Hospitality Catalogue admin screen.
 *
 * Extends the canonical Item / Offering / Price architecture; there is no parallel model:
 *   - company default price  = a Price scoped to the Item (hospitalityMenuItemId)
 *   - site price override    = a Price scoped to the Offering (hospitalityMenuOfferingId)  (sparse; absent => inherits)
 *   - company default min    = Item.defaultMinimumQuantity;  site override = Offering.minimumQuantity (sparse)
 *   - production routing     = ONE governed record per Item; never per site
 * Every command is a single Firestore transaction (no partial multi-document writes), carries an expected version
 * (a stale editor is refused), and writes a governance audit event with actor / before / after / Item / OPLOC.
 * Nothing is ever hard-deleted: archive, supersede and end-date only, so historical bookings, quotes and audit stay valid.
 */
import crypto from "node:crypto";
import { FieldValue, type DocumentReference, type DocumentSnapshot, type Query, type Transaction } from "firebase-admin/firestore";
import type { Actor } from "./auth";
import { assertPermission } from "./authmod";
import { db } from "./firebase-admin";
import { generateCanonicalId } from "./canonical-identities";
import { stableDocumentId } from "./canonical-editor";
import { sha256 } from "./profiler";
import { parseCanonical } from "./schemas";
import type { CanonicalRecord } from "./types";
import { existingCandidatesForNewItem, normaliseName, sourceIdentities } from "./hospitality-catalogue-canonicalisation";
import { currentPrice, reviewGroupId, routingStateOf, ukBusinessDate } from "./hospitality-catalogue-read-model";
import { isActiveOplocRecord } from "./hospitality-catalogue-oploc";
import { isRedundantException, type PackageException, type PricePeriod } from "./hospitality-effective-offering";
import { ROUTING_CHOICES, ROUTING_CHOICE_LABELS, ROUTING_CHOICE_WORKSTREAMS, type RoutingChoice } from "./hospitality-catalogue-types";

const canonical = () => db.collection("integrationHubCanonical");
const revisions = () => db.collection("integrationHubCanonicalRevisions");
const audit = () => db.collection("integrationHubGovernanceAudit");
const routingCollection = () => db.collection("integrationHubHospitalityMenuProductionRouting");
const mergeCollection = () => db.collection("integrationHubHospitalityMenuItemMerges");
export const REVIEW_DECISIONS_COLLECTION = "integrationHubHospitalityCatalogueReviewDecisions";
const decisionCollection = () => db.collection(REVIEW_DECISIONS_COLLECTION);

export const DEFAULT_VAT_RATE = 0.2;
const problem = (message: string, status = 422) => Object.assign(new Error(message), { status });
const stale = (what: string) => problem(`${what} changed elsewhere. Reload the catalogue and try again.`, 409);
const text = (value: unknown) => (typeof value === "string" ? value : "");
const money = (value: unknown, label: string) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw problem(`${label} must be a price of zero or more.`);
  if (Math.round(value * 100) / 100 !== value) throw problem(`${label} can have at most two decimal places.`);
  return value;
};
const vat = (value: unknown) => {
  if (value === undefined) return DEFAULT_VAT_RATE;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) throw problem("VAT rate must be between 0 and 1.");
  return value;
};
const quantity = (value: unknown, label: string) => { if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw problem(`${label} must be a whole number of 1 or more.`); return value; };
/** Copy of a record without the named fields (sparse overrides are removed, never stored as null). */
/** An exception can only be recorded for an active, non-archived OPLOC (all active OPLOCs are Hospitality-capable). */
const isActiveOploc = isActiveOplocRecord;
const without = (record: Record<string, unknown>, ...keys: string[]) => { const copy = { ...record }; for (const key of keys) delete copy[key]; return copy; };
const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

export type PriceInput = { amount: number; vatRate?: number };
export type CatalogueCommand =
  | { action: "create-item"; requestId: string; name: string; category: string; description?: string; routing: RoutingChoice; defaultPrice?: PriceInput; defaultMinimumQuantity?: number; oplocIds: string[]; providerMappings?: Array<{ provider: string; sourceItemId: string; sourceVersion?: string }> }
  | { action: "update-item"; itemId: string; expectedVersion: number; name: string; category: string; description?: string; defaultMinimumQuantity: number | null; defaultPrice?: PriceInput }
  | { action: "set-default-price"; itemId: string; expectedVersion: number; price: PriceInput }
  | { action: "set-routing"; itemId: string; routing: RoutingChoice; expectedRoutingVersion: number }
  | { action: "set-item-status"; itemId: string; expectedVersion: number; status: "active" | "archived" }
  /** Availability is the default everywhere; this records or clears a sparse `available:false` exception for one OPLOC. */
  | { action: "set-site-availability"; itemId: string; expectedVersion: number; oplocId: string; available: boolean }
  /** Sparse site override (price / minimum / wording). The exception record is created on demand and retired again once it states nothing beyond the defaults. */
  | { action: "set-site-override"; itemId: string; expectedVersion: number; oplocId: string; price?: PriceInput | null; minimumQuantity?: number | null; displayName?: string | null; description?: string | null }
  | { action: "adopt-company-default"; itemId: string; expectedVersion: number; price: PriceInput; minimumQuantity?: number | null; confirmed: boolean }
  | { action: "merge-items"; survivorItemId: string; sourceItemIds: string[]; expectedVersions: Record<string, number>; groupId?: string }
  | { action: "record-review-decision"; memberIds: string[]; decision: "keep_separate" | "defer" };

export type CatalogueCommandResult = { itemIds: string[]; reload: boolean; message: string };

type Ctx = { tx: Transaction; actor: Actor; now: string };
const readDoc = (ctx: Ctx, ref: DocumentReference) => ctx.tx.get(ref);
const readQuery = (ctx: Ctx, query: Query) => ctx.tx.get(query);
const asRecord = (snapshot: DocumentSnapshot) => (snapshot.exists ? (snapshot.data() as CanonicalRecord) : undefined);

function base(actor: Actor, now: string) {
  return { schemaVersion: "0.1.0" as const, version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid, active: true, externalIdentities: [], provenanceIds: [], ownership: { providerOwned: {}, fikaOwned: {} } };
}

type Entity = "Hospitality Menu Item" | "Hospitality Menu Offering" | "Hospitality Menu Price";
/** Validates against the strict canonical schema, then stages the document and its revision. */
function stage(ctx: Ctx, entityType: Entity, record: Record<string, unknown>, prior: CanonicalRecord | undefined, reason: string) {
  const parsed = parseCanonical(entityType, record);
  if (!parsed.success) throw problem(`${entityType} validation failed: ${parsed.error.issues[0]?.message || "Review the values."}`);
  const canonicalId = text(record.canonicalId);
  const next: CanonicalRecord = { canonicalId, entityType, record, dataHash: sha256(JSON.stringify(record)), lifecycleStatus: prior?.lifecycleStatus || "published", publicationStatus: prior?.publicationStatus || "published", publishedAt: prior?.publishedAt || ctx.now };
  ctx.tx.set(canonical().doc(stableDocumentId(canonicalId)), next);
  ctx.tx.set(revisions().doc(stableDocumentId(`${canonicalId}:${record.version}`)), { canonicalId, entityType, version: record.version, previous: prior || null, current: next, actorId: ctx.actor.uid, recordedAt: ctx.now, reason });
  return next;
}
const bump = (ctx: Ctx, record: Record<string, unknown>) => ({ ...record, version: Number(record.version || 0) + 1, updatedAt: ctx.now, updatedBy: ctx.actor.uid });

function auditEvent(ctx: Ctx, action: string, entityReference: string, reason: string, details: Record<string, unknown>) {
  ctx.tx.set(audit().doc(crypto.randomUUID()), { action, entityReference, actorId: ctx.actor.uid, actorName: ctx.actor.name, timestamp: ctx.now, reason, details: JSON.parse(JSON.stringify(details)) });
}

function expectVersion(record: CanonicalRecord | undefined, expected: number, what: string) {
  if (!record) throw problem(`${what} was not found.`, 404);
  if (Number(record.record.version) !== Number(expected)) throw stale(what);
}
function requireItem(snapshot: DocumentSnapshot): CanonicalRecord {
  const item = asRecord(snapshot);
  if (!item || item.entityType !== "Hospitality Menu Item") throw problem("Choose a Hospitality Catalogue item.", 404);
  return item;
}
const isArchived = (record: CanonicalRecord) => record.lifecycleStatus === "archived" || record.record.lifecycleState === "archived";

/** Ends the live Prices of one scope (end-dated or archived, never edited in place) and stages the replacement. Returns the new record. */
function replaceScopedPrice(ctx: Ctx, scope: { itemId?: string; offeringId?: string }, existing: CanonicalRecord[], input: { amount: number; vatRate: number }, today: string, reason: string) {
  const live = existing.filter(price => price.entityType === "Hospitality Menu Price" && price.record.lifecycleState === "active" && price.lifecycleStatus !== "archived");
  const current = currentPrice(live, today);
  if (current && current.record.amount === input.amount && current.record.vatRate === input.vatRate) throw problem("That price is already in force.");
  for (const price of live) {
    const from = text(price.record.effectiveFrom), to = text(price.record.effectiveTo);
    if (from >= today) stage(ctx, "Hospitality Menu Price", { ...bump(ctx, price.record), lifecycleState: "archived" }, price, `${reason} (replaced before taking effect)`);
    else if (!to || to >= today) stage(ctx, "Hospitality Menu Price", { ...bump(ctx, price.record), effectiveTo: dayBefore(today) }, price, `${reason} (ended)`);
  }
  const canonicalId = generateCanonicalId("Hospitality Menu Price");
  return stage(ctx, "Hospitality Menu Price", { ...base(ctx.actor, ctx.now), entityType: "Hospitality Menu Price", canonicalId, ...(scope.itemId ? { hospitalityMenuItemId: scope.itemId } : { hospitalityMenuOfferingId: scope.offeringId }), amount: input.amount, currency: "GBP" as const, vatRate: input.vatRate, effectiveFrom: today, lifecycleState: "active" }, undefined, reason);
}
function archiveScopedPrices(ctx: Ctx, existing: CanonicalRecord[], reason: string) {
  const live = existing.filter(price => price.entityType === "Hospitality Menu Price" && price.record.lifecycleState === "active" && price.lifecycleStatus !== "archived");
  for (const price of live) stage(ctx, "Hospitality Menu Price", { ...bump(ctx, price.record), lifecycleState: "archived" }, price, reason);
  return live;
}

/** Item-scoped Prices and Offerings share `record.hospitalityMenuItemId`; one bounded query returns both for an Item. */
async function itemChildren(ctx: Ctx, itemId: string) {
  const records = (await readQuery(ctx, canonical().where("record.hospitalityMenuItemId", "==", itemId))).docs.map(doc => doc.data() as CanonicalRecord);
  return { offerings: records.filter(record => record.entityType === "Hospitality Menu Offering"), itemPrices: records.filter(record => record.entityType === "Hospitality Menu Price") };
}
async function offeringPrices(ctx: Ctx, offeringIds: string[]) {
  const out: CanonicalRecord[] = [];
  for (let index = 0; index < offeringIds.length; index += 30) {
    const chunk = offeringIds.slice(index, index + 30);
    out.push(...(await readQuery(ctx, canonical().where("record.hospitalityMenuOfferingId", "in", chunk))).docs.map(doc => doc.data() as CanonicalRecord));
  }
  return out;
}
async function allItems(ctx: Ctx) {
  return (await readQuery(ctx, canonical().where("entityType", "==", "Hospitality Menu Item"))).docs.map(doc => doc.data() as CanonicalRecord);
}
const labelOf = (choice: RoutingChoice) => ROUTING_CHOICE_LABELS[choice];

// ---------------------------------------------------------------------------------------------------------------------
// ---- sparse site exceptions --------------------------------------------------------------------------------------
/** Deterministic id of the site-wide exception for one Item at one OPLOC: a concurrent duplicate create collides instead of forking. */
const exceptionIdFor = (itemId: string, oplocId: string) => `hospitality-menu-offering:site-${crypto.createHash("sha256").update(`${itemId}|${oplocId}`).digest("hex").slice(0, 32)}`;
const pricePeriod = (price: CanonicalRecord): PricePeriod => ({ amount: Number(price.record.amount), vatRate: Number(price.record.vatRate), from: text(price.record.effectiveFrom), ...(text(price.record.effectiveTo) ? { to: text(price.record.effectiveTo) } : {}) });
const livePeriods = (prices: CanonicalRecord[]) => prices.filter(price => price.record.lifecycleState === "active" && price.lifecycleStatus !== "archived").map(pricePeriod);
async function activeOplocIds(ctx: Ctx) { return (await readQuery(ctx, canonical().where("entityType", "==", "OPLOC"))).docs.map(doc => doc.data() as CanonicalRecord).filter(isActiveOploc).map(record => record.canonicalId).sort(); }
type ItemChildren = { offerings: CanonicalRecord[]; itemPrices: CanonicalRecord[] };
const siteWide = (children: ItemChildren, oplocId: string) => children.offerings.filter(offering => offering.record.oplocId === oplocId && !offering.record.operationalAreaId);

/** True when a stored record states nothing beyond the company defaults (it has no effect and should not exist). */
function noEffect(record: Record<string, unknown>, ownPrices: CanonicalRecord[], item: CanonicalRecord, itemPrices: CanonicalRecord[], today: string) {
  const configuration = (record.configuration || {}) as Record<string, unknown>;
  const exception: PackageException = { id: text(record.canonicalId), itemId: text(record.hospitalityMenuItemId), oplocId: text(record.oplocId), ...(text(record.operationalAreaId) ? { operationalAreaId: text(record.operationalAreaId) } : {}), mode: record.offeringMode === "quote_only" ? "quote_only" : "standard", available: record.available !== false, prices: livePeriods(ownPrices.filter(price => price.record.hospitalityMenuOfferingId === record.canonicalId)), ...(typeof record.minimumQuantity === "number" ? { minimumQuantity: record.minimumQuantity } : {}), ...(typeof record.minimumGuests === "number" ? { minimumGuests: record.minimumGuests } : {}), ...(typeof record.noticeRequiredDays === "number" ? { noticeRequiredDays: record.noticeRequiredDays } : {}), ...(text(configuration.displayName) ? { displayName: text(configuration.displayName) } : {}), ...(text(configuration.description) ? { description: text(configuration.description) } : {}), ...(Object.keys(without(configuration, "displayName", "description")).length ? { configuration: without(configuration, "displayName", "description") } : {}) };
  const sameConfiguration = exception.configuration && JSON.stringify(exception.configuration) === JSON.stringify(item.record.configuration);
  return isRedundantException(sameConfiguration ? { ...exception, configuration: undefined } : exception, { defaultPrices: livePeriods(itemPrices), defaultMinimumQuantity: typeof item.record.defaultMinimumQuantity === "number" ? item.record.defaultMinimumQuantity : undefined, defaultNoticeRequiredDays: typeof item.record.defaultNoticeRequiredDays === "number" ? item.record.defaultNoticeRequiredDays : undefined, defaultMinimumGuests: typeof item.record.defaultMinimumGuests === "number" ? item.record.defaultMinimumGuests : undefined, ...(item.record.defaultOfferingMode === "quote_only" ? { defaultMode: "quote_only" as const } : {}) }, today);
}
const retire = (ctx: Ctx, offering: CanonicalRecord, reason: "item-archived" | "redundant-default", note: string, record: Record<string, unknown> = offering.record) => stage(ctx, "Hospitality Menu Offering", { ...bump(ctx, record), lifecycleState: "archived", retiredReason: reason }, offering, note);

/** Applies availability edits as SPARSE exceptions. Returns "+oploc" (made available / exception cleared) and "-oploc" (exception recorded). */
function applySiteEdits(ctx: Ctx, item: CanonicalRecord, children: ItemChildren, ownPrices: CanonicalRecord[], edits: Array<{ oplocId: string; available: boolean }>, today: string) {
  const touched: string[] = [];
  for (const edit of edits) {
    const records = siteWide(children, edit.oplocId); const active = records.find(offering => offering.record.lifecycleState !== "archived"); const retired = records.find(offering => offering.record.lifecycleState === "archived");
    if (!edit.available) {
      if (active) { if (active.record.available === false) continue; stage(ctx, "Hospitality Menu Offering", { ...bump(ctx, active.record), available: false }, active, "Site availability exception recorded."); }
      else if (retired) stage(ctx, "Hospitality Menu Offering", { ...without(bump(ctx, retired.record), "retiredReason"), lifecycleState: "active", available: false }, retired, "Site availability exception recorded (earlier record revived).");
      else stage(ctx, "Hospitality Menu Offering", { ...base(ctx.actor, ctx.now), entityType: "Hospitality Menu Offering", canonicalId: exceptionIdFor(item.canonicalId, edit.oplocId), hospitalityMenuItemId: item.canonicalId, oplocId: edit.oplocId, offeringMode: "standard" as const, lifecycleState: "active" as const, available: false }, undefined, "Site availability exception recorded.");
      touched.push(`-${edit.oplocId}`);
    } else {
      if (!active || active.record.available !== false) continue; // already available: inheritance needs no record
      const cleared = without(bump(ctx, active.record), "available");
      if (noEffect(cleared, ownPrices, item, children.itemPrices, today)) retire(ctx, active, "redundant-default", "Availability exception cleared; the record stated nothing else, so it is retired.");
      else stage(ctx, "Hospitality Menu Offering", cleared, active, "Availability exception cleared.");
      touched.push(`+${edit.oplocId}`);
    }
  }
  return touched;
}

async function createItem(ctx: Ctx, command: Extract<CatalogueCommand, { action: "create-item" }>): Promise<CatalogueCommandResult> {
  const name = command.name.trim(), category = command.category.trim();
  if (!name) throw problem("Give the item a name."); if (!category) throw problem("Choose a category.");
  if (!ROUTING_CHOICES.includes(command.routing)) throw problem("Choose a production route before creating the item.");
  const oplocIds = [...new Set(command.oplocIds)];
  if (!oplocIds.length) throw problem("Make the item available at at least one site.");
  const price = command.defaultPrice ? { amount: money(command.defaultPrice.amount, "Default price"), vatRate: vat(command.defaultPrice.vatRate) } : undefined;
  const minimum = command.defaultMinimumQuantity === undefined ? undefined : quantity(command.defaultMinimumQuantity, "Default minimum");
  const itemId = `hospitality-menu-item:${crypto.createHash("sha256").update(`catalogue-create:${command.requestId}`).digest("hex").slice(0, 32)}`;
  const itemRef = canonical().doc(stableDocumentId(itemId));
  const [itemSnapshot, items, activeIds] = await Promise.all([readDoc(ctx, itemRef), allItems(ctx), activeOplocIds(ctx)]);
  if (itemSnapshot.exists) return { itemIds: [itemId], reload: false, message: "This item was already created." }; // replay-safe retry
  const sameName = existingCandidatesForNewItem(items, { name });
  if (sameName.length) throw problem(`An item called “${name}” already exists in the catalogue. Open it and make it available at the site instead of creating a duplicate.`, 409);
  if (items.some(item => isArchived(item) && normaliseName(item.record.name) === normaliseName(name))) throw problem(`An archived item called “${name}” exists. Restore it instead of creating a duplicate.`, 409);
  for (const mapping of command.providerMappings || []) {
    const clash = items.find(item => !isArchived(item) && sourceIdentities(item).includes(mapping.sourceItemId));
    if (clash) throw problem(`Provider reference “${mapping.sourceItemId}” is already mapped to “${text(clash.record.name)}”.`, 409);
  }
  oplocIds.forEach((id, index) => { if (!activeIds.includes(id)) throw problem(`Site ${index + 1} is not an active location.`); });
  const excluded = activeIds.filter(id => !oplocIds.includes(id));
  const record = { ...base(ctx.actor, ctx.now), entityType: "Hospitality Menu Item" as const, canonicalId: itemId, name, category, ...(command.description?.trim() ? { description: command.description.trim() } : {}), lifecycleState: "active" as const, ...(minimum !== undefined ? { defaultMinimumQuantity: minimum } : {}), dietaryInformation: [] as string[], allergenInformation: [] as string[], providerMappings: command.providerMappings || [] };
  stage(ctx, "Hospitality Menu Item", record, undefined, "Hospitality Catalogue item created.");
  if (price) stage(ctx, "Hospitality Menu Price", { ...base(ctx.actor, ctx.now), entityType: "Hospitality Menu Price", canonicalId: generateCanonicalId("Hospitality Menu Price"), hospitalityMenuItemId: itemId, amount: price.amount, currency: "GBP" as const, vatRate: price.vatRate, effectiveFrom: ukBusinessDate(), lifecycleState: "active" as const }, undefined, "Company default price set at creation.");
  // Availability is the default at every active OPLOC: only the sites the operator EXCLUDED get a (sparse) exception record.
  for (const oplocId of excluded) stage(ctx, "Hospitality Menu Offering", { ...base(ctx.actor, ctx.now), entityType: "Hospitality Menu Offering", canonicalId: exceptionIdFor(itemId, oplocId), hospitalityMenuItemId: itemId, oplocId, offeringMode: "standard" as const, lifecycleState: "active" as const, available: false }, undefined, "Site exception recorded at creation.");
  ctx.tx.create(routingCollection().doc(stableDocumentId(itemId)), { menuItemId: itemId, workstreams: ROUTING_CHOICE_WORKSTREAMS[command.routing], version: 1, createdAt: ctx.now, updatedAt: ctx.now, updatedBy: ctx.actor.uid });
  auditEvent(ctx, "Hospitality Catalogue item created", itemId, `Created “${name}” (${labelOf(command.routing)}), available at ${oplocIds.length} of ${activeIds.length} sites${excluded.length ? ` (${excluded.length} exception${excluded.length === 1 ? "" : "s"})` : ""}.`, { itemId, after: { name, category, routing: command.routing, defaultPrice: price, defaultMinimumQuantity: minimum, availableAt: oplocIds.length, unavailableOplocIds: excluded } });
  return { itemIds: [itemId], reload: false, message: `“${name}” created.` };
}

async function updateItem(ctx: Ctx, command: Extract<CatalogueCommand, { action: "update-item" }>): Promise<CatalogueCommandResult> {
  const itemRef = canonical().doc(stableDocumentId(command.itemId));
  const [snapshot, items, children] = await Promise.all([readDoc(ctx, itemRef), allItems(ctx), itemChildren(ctx, command.itemId)]);
  const item = requireItem(snapshot); expectVersion(item, command.expectedVersion, "This item");
  const name = command.name.trim(), category = command.category.trim();
  if (!name || !category) throw problem("Name and category are required.");
  if (items.some(other => other.canonicalId !== item.canonicalId && !isArchived(other) && normaliseName(other.record.name) === normaliseName(name))) throw problem(`Another active item is already called “${name}”.`, 409);
  const minimum = command.defaultMinimumQuantity === null ? undefined : quantity(command.defaultMinimumQuantity, "Default minimum");
  const rest = without(item.record, "defaultMinimumQuantity", "description");
  const record = { ...bump(ctx, rest), name, category, ...(command.description?.trim() ? { description: command.description.trim() } : {}), ...(minimum !== undefined ? { defaultMinimumQuantity: minimum } : {}) };
  stage(ctx, "Hospitality Menu Item", record, item, "Hospitality Catalogue item edited.");
  // The default price changes in the SAME transaction as the item edit: one Save never half-applies.
  const today = ukBusinessDate(); const previousPrice = currentPrice(children.itemPrices, today); let nextPrice: { amount: number; vatRate: number } | undefined;
  if (command.defaultPrice) {
    nextPrice = { amount: money(command.defaultPrice.amount, "Default price"), vatRate: vat(command.defaultPrice.vatRate ?? previousPrice?.record.vatRate as number | undefined) };
    if (!previousPrice || previousPrice.record.amount !== nextPrice.amount || previousPrice.record.vatRate !== nextPrice.vatRate) replaceScopedPrice(ctx, { itemId: item.canonicalId }, children.itemPrices, nextPrice, today, "Company default price changed.");
    else nextPrice = undefined;
  }
  if (nextPrice) auditEvent(ctx, "Hospitality Catalogue default price changed", item.canonicalId, `Default price for “${name}” changed. Sites without an override inherit it.`, { itemId: item.canonicalId, before: previousPrice ? { amount: previousPrice.record.amount, vatRate: previousPrice.record.vatRate } : null, after: nextPrice });
  const before = { name: text(item.record.name), category: text(item.record.category), description: text(item.record.description), defaultMinimumQuantity: item.record.defaultMinimumQuantity ?? null };
  const after = { name, category, description: command.description?.trim() || "", defaultMinimumQuantity: minimum ?? null };
  auditEvent(ctx, before.defaultMinimumQuantity !== after.defaultMinimumQuantity ? "Hospitality Catalogue default minimum changed" : "Hospitality Catalogue item edited", item.canonicalId, `Edited “${name}”.`, { itemId: item.canonicalId, before, after });
  return { itemIds: [item.canonicalId], reload: false, message: "Item saved." };
}

async function setDefaultPrice(ctx: Ctx, command: Extract<CatalogueCommand, { action: "set-default-price" }>): Promise<CatalogueCommandResult> {
  const itemRef = canonical().doc(stableDocumentId(command.itemId));
  const snapshot = await readDoc(ctx, itemRef); const item = requireItem(snapshot); expectVersion(item, command.expectedVersion, "This item");
  if (isArchived(item)) throw problem("Restore the item before changing its price.");
  const { itemPrices } = await itemChildren(ctx, item.canonicalId);
  const today = ukBusinessDate(); const input = { amount: money(command.price.amount, "Default price"), vatRate: vat(command.price.vatRate ?? (currentPrice(itemPrices, today)?.record.vatRate as number | undefined)) };
  const previous = currentPrice(itemPrices, today);
  replaceScopedPrice(ctx, { itemId: item.canonicalId }, itemPrices, input, today, "Company default price changed.");
  stage(ctx, "Hospitality Menu Item", bump(ctx, item.record), item, "Company default price changed (item version touched to refuse stale editors).");
  auditEvent(ctx, "Hospitality Catalogue default price changed", item.canonicalId, `Default price for “${text(item.record.name)}” changed. Sites without an override inherit it.`, { itemId: item.canonicalId, before: previous ? { amount: previous.record.amount, vatRate: previous.record.vatRate } : null, after: input });
  return { itemIds: [item.canonicalId], reload: false, message: "Company default price saved. Sites without an override inherit it." };
}

async function setRouting(ctx: Ctx, command: Extract<CatalogueCommand, { action: "set-routing" }>): Promise<CatalogueCommandResult> {
  if (!ROUTING_CHOICES.includes(command.routing)) throw problem("Choose one of the four production routes.");
  const itemRef = canonical().doc(stableDocumentId(command.itemId)); const routeRef = routingCollection().doc(stableDocumentId(command.itemId));
  const [itemSnapshot, routeSnapshot] = await Promise.all([readDoc(ctx, itemRef), readDoc(ctx, routeRef)]);
  const item = requireItem(itemSnapshot);
  if (isArchived(item)) throw problem("Choose an active catalogue item.");
  const current = routeSnapshot.exists ? (routeSnapshot.data() as { workstreams?: string[]; version?: number; supersededBy?: string }) : undefined;
  const currentVersion = current ? Number(current.version || 1) : 0;
  if (currentVersion !== Number(command.expectedRoutingVersion)) throw stale("This item’s production routing");
  const before = routingStateOf(current ? { menuItemId: item.canonicalId, workstreams: current.workstreams || [], version: current.version, supersededBy: current.supersededBy } : undefined);
  ctx.tx.set(routeRef, { menuItemId: item.canonicalId, workstreams: ROUTING_CHOICE_WORKSTREAMS[command.routing], version: currentVersion + 1, createdAt: (routeSnapshot.data() as { createdAt?: string } | undefined)?.createdAt || ctx.now, updatedAt: ctx.now, updatedBy: ctx.actor.uid, supersededBy: FieldValue.delete(), supersededAt: FieldValue.delete() }, { merge: true });
  auditEvent(ctx, "Hospitality Catalogue routing changed", item.canonicalId, `“${text(item.record.name)}” routed to ${labelOf(command.routing)}.`, { itemId: item.canonicalId, before: { state: before.state, version: currentVersion }, after: { state: command.routing, version: currentVersion + 1 } });
  return { itemIds: [item.canonicalId], reload: false, message: `Routing saved: ${labelOf(command.routing)}.` };
}

async function setItemStatus(ctx: Ctx, command: Extract<CatalogueCommand, { action: "set-item-status" }>): Promise<CatalogueCommandResult> {
  const itemRef = canonical().doc(stableDocumentId(command.itemId));
  const [snapshot, items, children] = await Promise.all([readDoc(ctx, itemRef), command.status === "active" ? allItems(ctx) : Promise.resolve([] as CanonicalRecord[]), itemChildren(ctx, command.itemId)]);
  const item = requireItem(snapshot); expectVersion(item, command.expectedVersion, "This item");
  const archived = item.record.lifecycleState === "archived";
  if (command.status === "archived" && archived) throw problem("This item is already archived.");
  if (command.status === "active" && !archived) throw problem("This item is already active.");
  if (command.status === "active" && items.some(other => other.canonicalId !== item.canonicalId && !isArchived(other) && normaliseName(other.record.name) === normaliseName(item.record.name))) throw problem(`Another active item is already called “${text(item.record.name)}”; restoring this one would create a duplicate.`, 409);
  stage(ctx, "Hospitality Menu Item", { ...bump(ctx, item.record), lifecycleState: command.status }, item, command.status === "archived" ? "Hospitality Catalogue item archived." : "Hospitality Catalogue item restored.");
  // An archived Item must have NO active effective site availability: its exception records are retired with it (kept for history) and revived on restore.
  let touched = 0;
  if (command.status === "archived") { for (const offering of children.offerings.filter(candidate => candidate.record.lifecycleState !== "archived")) { retire(ctx, offering, "item-archived", "Retired with the archived Item."); touched++; } }
  else for (const offering of children.offerings.filter(candidate => candidate.record.lifecycleState === "archived" && candidate.record.retiredReason === "item-archived")) { stage(ctx, "Hospitality Menu Offering", { ...without(bump(ctx, offering.record), "retiredReason"), lifecycleState: "active" }, offering, "Revived with the restored Item."); touched++; }
  auditEvent(ctx, command.status === "archived" ? "Hospitality Catalogue item archived" : "Hospitality Catalogue item restored", item.canonicalId, `${command.status === "archived" ? "Archived" : "Restored"} “${text(item.record.name)}”. Prices, routing and history are retained; ${touched} site exception record${touched === 1 ? "" : "s"} ${command.status === "archived" ? "retired" : "revived"}.`, { itemId: item.canonicalId, before: { lifecycleState: item.record.lifecycleState }, after: { lifecycleState: command.status }, exceptionRecordsChanged: touched });
  return { itemIds: [item.canonicalId], reload: false, message: command.status === "archived" ? "Item archived. It no longer appears on booking menus; history is kept." : "Item restored." };
}

async function setSiteAvailability(ctx: Ctx, command: Extract<CatalogueCommand, { action: "set-site-availability" }>): Promise<CatalogueCommandResult> {
  const itemRef = canonical().doc(stableDocumentId(command.itemId));
  const [itemSnapshot, children, activeIds] = await Promise.all([readDoc(ctx, itemRef), itemChildren(ctx, command.itemId), activeOplocIds(ctx)]);
  const item = requireItem(itemSnapshot); expectVersion(item, command.expectedVersion, "This item");
  if (isArchived(item)) throw problem("Restore the item before changing where it is available.");
  if (!activeIds.includes(command.oplocId)) throw problem("Choose an active location.");
  const ownPrices = await offeringPrices(ctx, children.offerings.map(offering => offering.canonicalId));
  const touched = applySiteEdits(ctx, item, children, ownPrices, [{ oplocId: command.oplocId, available: command.available }], ukBusinessDate());
  if (!touched.length) throw problem(command.available ? "This item is already available at that site." : "This item is already unavailable at that site.", 409);
  stage(ctx, "Hospitality Menu Item", bump(ctx, item.record), item, "Site availability changed (item version touched).");
  auditEvent(ctx, command.available ? "Hospitality Catalogue offering enabled" : "Hospitality Catalogue offering disabled", item.canonicalId, `“${text(item.record.name)}” ${command.available ? "made available again" : "made unavailable"} at a site.`, { itemId: item.canonicalId, oplocId: command.oplocId, before: { available: !command.available }, after: { available: command.available } });
  return { itemIds: [item.canonicalId], reload: false, message: command.available ? "Available at the site again. It inherits the company price and minimum." : "Marked unavailable at the site. History and overrides are kept." };
}

async function setSiteOverride(ctx: Ctx, command: Extract<CatalogueCommand, { action: "set-site-override" }>): Promise<CatalogueCommandResult> {
  const itemRef = canonical().doc(stableDocumentId(command.itemId));
  const [itemSnapshot, children, activeIds] = await Promise.all([readDoc(ctx, itemRef), itemChildren(ctx, command.itemId), activeOplocIds(ctx)]);
  const item = requireItem(itemSnapshot); expectVersion(item, command.expectedVersion, "This item");
  if (isArchived(item)) throw problem("Restore the item before editing site overrides.");
  if (!activeIds.includes(command.oplocId)) throw problem("Choose an active location.");
  if (command.price === undefined && command.minimumQuantity === undefined && command.displayName === undefined && command.description === undefined) throw problem("Nothing to change.");
  const ownPrices = await offeringPrices(ctx, children.offerings.map(offering => offering.canonicalId));
  const today = ukBusinessDate(); const defaultPrice = currentPrice(children.itemPrices, today);
  const records = siteWide(children, command.oplocId); const existing = records.find(offering => offering.record.lifecycleState !== "archived"); const retired = records.find(offering => offering.record.lifecycleState === "archived");
  const offeringId = existing?.canonicalId ?? retired?.canonicalId ?? exceptionIdFor(item.canonicalId, command.oplocId);
  const own = ownPrices.filter(price => price.record.hospitalityMenuOfferingId === offeringId);
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
  let record: Record<string, unknown> = existing ? bump(ctx, existing.record) : retired ? { ...without(bump(ctx, retired.record), "retiredReason"), lifecycleState: "active" } : { ...base(ctx.actor, ctx.now), entityType: "Hospitality Menu Offering", canonicalId: offeringId, hospitalityMenuItemId: item.canonicalId, oplocId: command.oplocId, offeringMode: "standard" as const, lifecycleState: "active" as const };
  const prior = existing ?? retired;
  if (record.offeringMode === "quote_only" && command.price) throw problem("Quote-only offerings cannot have a price.");
  // The exception record must exist before a Price can be scoped to it.
  if (command.price !== undefined) {
    const current = currentPrice(own, today); before.price = current ? { amount: current.record.amount, vatRate: current.record.vatRate } : null;
    if (command.price === null) { if (!archiveScopedPrices(ctx, own, "Site price override reset to company default.").length) throw problem("This site has no price override to reset."); after.price = null; }
    else {
      const input = { amount: money(command.price.amount, "Site price"), vatRate: vat(command.price.vatRate ?? defaultPrice?.record.vatRate as number | undefined) };
      if (defaultPrice && defaultPrice.record.amount === input.amount && defaultPrice.record.vatRate === input.vatRate) throw problem("That equals the company default. Use “Reset to company default” instead of storing a duplicate.");
      replaceScopedPrice(ctx, { offeringId }, own, input, today, "Site price override set."); after.price = input;
    }
  }
  if (command.minimumQuantity !== undefined) {
    before.minimumQuantity = record.minimumQuantity ?? null;
    if (command.minimumQuantity === null) { record = without(record, "minimumQuantity"); after.minimumQuantity = null; }
    else { const minimum = quantity(command.minimumQuantity, "Site minimum"); if (minimum === item.record.defaultMinimumQuantity) throw problem("That equals the company default minimum. Use “Reset to company default” instead."); record = { ...record, minimumQuantity: minimum }; after.minimumQuantity = minimum; }
  }
  if (command.displayName !== undefined || command.description !== undefined) {
    const configuration = { ...((record.configuration || {}) as Record<string, unknown>) };
    if (command.displayName !== undefined) { before.displayName = configuration.displayName ?? null; if (command.displayName === null || !command.displayName.trim()) delete configuration.displayName; else configuration.displayName = command.displayName.trim(); after.displayName = configuration.displayName ?? null; }
    if (command.description !== undefined) { before.description = configuration.description ?? null; if (command.description === null || !command.description.trim()) delete configuration.description; else configuration.description = command.description.trim(); after.description = configuration.description ?? null; }
    record = Object.keys(configuration).length ? { ...record, configuration } : without(record, "configuration");
  }
  // After the patch the record is retired again if it states nothing beyond the company defaults ("no exception merely to say: available with defaults").
  const priceAfter = command.price === null ? undefined : command.price !== undefined ? { amount: command.price.amount, vatRate: vat(command.price.vatRate ?? defaultPrice?.record.vatRate as number | undefined) } : currentPrice(own, today) ? { amount: Number(currentPrice(own, today)!.record.amount), vatRate: Number(currentPrice(own, today)!.record.vatRate) } : undefined;
  const syntheticOwn = priceAfter ? [{ canonicalId: "x", entityType: "Hospitality Menu Price", record: { hospitalityMenuOfferingId: offeringId, amount: priceAfter.amount, vatRate: priceAfter.vatRate, effectiveFrom: today, lifecycleState: "active" }, lifecycleStatus: "published" } as unknown as CanonicalRecord] : [];
  const redundant = noEffect(record, syntheticOwn, item, children.itemPrices, today);
  if (redundant && !prior) throw problem("Nothing to store: that matches the company defaults.");
  if (redundant) stage(ctx, "Hospitality Menu Offering", { ...record, lifecycleState: "archived", retiredReason: "redundant-default" }, prior, "Site exception retired: it now matches the company defaults.");
  else stage(ctx, "Hospitality Menu Offering", record, prior, "Site override changed.");
  stage(ctx, "Hospitality Menu Item", bump(ctx, item.record), item, "Site override changed (item version touched).");
  const removing = command.price === null || command.minimumQuantity === null;
  auditEvent(ctx, removing ? "Hospitality Catalogue override removed" : "Hospitality Catalogue override set", item.canonicalId, `Site override changed for “${text(item.record.name)}”.`, { itemId: item.canonicalId, oplocId: command.oplocId, before, after });
  return { itemIds: [item.canonicalId], reload: false, message: removing ? "Reset to company default." : "Override saved." };
}

async function adoptCompanyDefault(ctx: Ctx, command: Extract<CatalogueCommand, { action: "adopt-company-default" }>): Promise<CatalogueCommandResult> {
  if (!command.confirmed) throw problem("Confirm the company default before it replaces site values.");
  const itemRef = canonical().doc(stableDocumentId(command.itemId));
  const snapshot = await readDoc(ctx, itemRef); const item = requireItem(snapshot); expectVersion(item, command.expectedVersion, "This item");
  if (isArchived(item)) throw problem("Restore the item first.");
  const { offerings, itemPrices } = await itemChildren(ctx, item.canonicalId);
  const ownPrices = await offeringPrices(ctx, offerings.map(offering => offering.canonicalId));
  const today = ukBusinessDate(); const input = { amount: money(command.price.amount, "Default price"), vatRate: vat(command.price.vatRate) };
  const minimum = command.minimumQuantity === null || command.minimumQuantity === undefined ? undefined : quantity(command.minimumQuantity, "Default minimum");
  if (currentPrice(itemPrices, today)) throw problem("This item already has a company default price. Use Edit to change it.");
  replaceScopedPrice(ctx, { itemId: item.canonicalId }, itemPrices, input, today, "Company default adopted from site values.");
  let redundantPrices = 0, redundantMinimums = 0;
  for (const offering of offerings.filter(candidate => candidate.record.lifecycleState !== "archived")) {
    let record = offering.record; let changed = false;
    const own = ownPrices.filter(price => price.record.hospitalityMenuOfferingId === offering.canonicalId);
    const current = currentPrice(own, today);
    if (current && current.record.amount === input.amount && current.record.vatRate === input.vatRate) { archiveScopedPrices(ctx, own, "Site price equalled the adopted company default; override removed."); redundantPrices++; }
    if (minimum !== undefined && record.minimumQuantity === minimum) { record = without(record, "minimumQuantity"); redundantMinimums++; changed = true; }
    // A site record that now states nothing beyond the new company defaults is retired (history kept); otherwise only the redundant minimum is dropped.
    const remainingPrice = current && !(current.record.amount === input.amount && current.record.vatRate === input.vatRate) ? [current] : [];
    const nowRedundant = noEffect(record, remainingPrice, { ...item, record: { ...item.record, ...(minimum !== undefined ? { defaultMinimumQuantity: minimum } : {}) } } as CanonicalRecord, [{ canonicalId: "x", entityType: "Hospitality Menu Price", record: { hospitalityMenuItemId: item.canonicalId, amount: input.amount, vatRate: input.vatRate, effectiveFrom: "1970-01-01", lifecycleState: "active" }, lifecycleStatus: "published" } as unknown as CanonicalRecord], today);
    if (nowRedundant) retire(ctx, offering, "redundant-default", "Site record states nothing beyond the adopted company defaults; retired.", record);
    else if (changed) stage(ctx, "Hospitality Menu Offering", bump(ctx, record), offering, "Site minimum equalled the adopted company default; override removed.");
  }
  stage(ctx, "Hospitality Menu Item", { ...bump(ctx, without(item.record, "defaultMinimumQuantity")), ...(minimum !== undefined ? { defaultMinimumQuantity: minimum } : {}) }, item, "Company default adopted.");
  auditEvent(ctx, "Hospitality Catalogue default price changed", item.canonicalId, `Operator confirmed a company default for “${text(item.record.name)}”; equal site values became inherited. Different site values stay as overrides.`, { itemId: item.canonicalId, before: null, after: { ...input, defaultMinimumQuantity: minimum ?? null }, redundantPricesRemoved: redundantPrices, redundantMinimumsRemoved: redundantMinimums });
  return { itemIds: [item.canonicalId], reload: false, message: `Company default saved. ${redundantPrices} site price${redundantPrices === 1 ? "" : "s"} now inherit it.` };
}

async function mergeItems(ctx: Ctx, command: Extract<CatalogueCommand, { action: "merge-items" }>): Promise<CatalogueCommandResult> {
  const sourceIds = [...new Set(command.sourceItemIds)].filter(id => id !== command.survivorItemId);
  if (!sourceIds.length) throw problem("Choose at least one other item to merge into the surviving item.");
  const ids = [command.survivorItemId, ...sourceIds];
  const snapshots = await Promise.all(ids.map(id => readDoc(ctx, canonical().doc(stableDocumentId(id)))));
  const items = snapshots.map(requireItem);
  items.forEach(item => { expectVersion(item, command.expectedVersions[item.canonicalId], `“${text(item.record.name)}”`); if (isArchived(item)) throw problem(`“${text(item.record.name)}” is archived and cannot be merged.`); });
  const routeSnapshots = await Promise.all(ids.map(id => readDoc(ctx, routingCollection().doc(stableDocumentId(id)))));
  const children = await Promise.all(ids.map(id => itemChildren(ctx, id)));
  const [survivor, ...sources] = items;
  const problems: string[] = [];
  const setKey = (item: CanonicalRecord, key: string) => [...(Array.isArray(item.record[key]) ? item.record[key] as unknown[] : [])].map(value => normaliseName(value)).sort().join("|");
  for (const source of sources) {
    if (setKey(source, "allergenInformation") !== setKey(survivor, "allergenInformation")) problems.push(`allergen information differs between “${text(survivor.record.name)}” and “${text(source.record.name)}”`);
    if (setKey(source, "dietaryInformation") !== setKey(survivor, "dietaryInformation")) problems.push(`dietary information differs between “${text(survivor.record.name)}” and “${text(source.record.name)}”`);
  }
  const keys = new Set(children[0].offerings.filter(o => o.record.lifecycleState !== "archived").map(o => `${o.record.oplocId}|${o.record.operationalAreaId || ""}|${o.record.offeringMode}`));
  for (const child of children.slice(1)) for (const offering of child.offerings.filter(o => o.record.lifecycleState !== "archived")) {
    const key = `${offering.record.oplocId}|${offering.record.operationalAreaId || ""}|${offering.record.offeringMode}`;
    if (keys.has(key)) problems.push("both items already have an offering at the same site"); keys.add(key);
  }
  const today = ukBusinessDate();
  const defaults = children.map(child => currentPrice(child.itemPrices, today));
  const survivorDefault = defaults[0]; const sourceDefaults = defaults.slice(1).filter((value): value is CanonicalRecord => Boolean(value));
  const priceKey = (price: CanonicalRecord) => `${price.record.amount}|${price.record.vatRate}`;
  const defaultKeys = new Set([survivorDefault, ...sourceDefaults].filter((value): value is CanonicalRecord => Boolean(value)).map(priceKey));
  if (defaultKeys.size > 1) problems.push("the items have different company default prices");
  const minimums = new Set(items.map(item => item.record.defaultMinimumQuantity).filter(value => value !== undefined));
  if (minimums.size > 1) problems.push("the items have different default minimums");
  const routes = routeSnapshots.map((snapshot, index) => ({ id: ids[index], doc: snapshot.exists ? snapshot.data() as { workstreams?: string[]; version?: number; supersededBy?: string } : undefined })).filter(route => route.doc && !route.doc.supersededBy);
  const routeKeys = new Set(routes.map(route => [...(route.doc!.workstreams || [])].sort().join(",")));
  if (routeKeys.size > 1) problems.push("production routing decisions disagree");
  if (problems.length) throw problem(`These items cannot be merged yet: ${[...new Set(problems)].join("; ")}. Resolve that first; nothing was changed.`, 409);

  const mappings = new Map<string, Record<string, unknown>>();
  for (const item of items) for (const mapping of (Array.isArray(item.record.providerMappings) ? item.record.providerMappings : []) as Record<string, unknown>[]) mappings.set(`${mapping.provider}|${mapping.sourceItemId}`, mapping);
  const minimum = [...minimums][0] as number | undefined;
  stage(ctx, "Hospitality Menu Item", { ...bump(ctx, survivor.record), providerMappings: [...mappings.values()], ...(minimum !== undefined ? { defaultMinimumQuantity: minimum } : {}) }, survivor, "Merged site/catalogue duplicates into this item.");
  let repointed = 0;
  sources.forEach((source, index) => {
    const child = children[index + 1];
    for (const offering of child.offerings) {
      const configuration = { ...((offering.record.configuration || {}) as Record<string, unknown>) };
      if (text(source.record.name) !== text(survivor.record.name) && !configuration.displayName) configuration.displayName = text(source.record.name);
      if (text(source.record.description).trim() && text(source.record.description).trim() !== text(survivor.record.description).trim() && !configuration.description) configuration.description = text(source.record.description).trim();
      stage(ctx, "Hospitality Menu Offering", { ...bump(ctx, offering.record), hospitalityMenuItemId: survivor.canonicalId, ...(Object.keys(configuration).length ? { configuration } : {}) }, offering, `Offering repointed from merged item ${source.canonicalId}.`); repointed++;
    }
    for (const price of child.itemPrices.filter(candidate => candidate.record.lifecycleState === "active")) {
      if (survivorDefault) stage(ctx, "Hospitality Menu Price", { ...bump(ctx, price.record), lifecycleState: "archived" }, price, "Duplicate company default retired by merge.");
      else stage(ctx, "Hospitality Menu Price", { ...bump(ctx, price.record), hospitalityMenuItemId: survivor.canonicalId }, price, "Company default carried over by merge.");
    }
    stage(ctx, "Hospitality Menu Item", { ...bump(ctx, source.record), lifecycleState: "archived" }, source, `Merged into ${survivor.canonicalId}.`);
    ctx.tx.set(mergeCollection().doc(stableDocumentId(source.canonicalId)), { sourceMenuItemId: source.canonicalId, survivorMenuItemId: survivor.canonicalId, mergedAt: ctx.now, mergedBy: ctx.actor.uid }, { merge: true });
    const route = routes.find(candidate => candidate.id === source.canonicalId);
    if (route) ctx.tx.set(routingCollection().doc(stableDocumentId(source.canonicalId)), { supersededBy: survivor.canonicalId, supersededAt: ctx.now }, { merge: true });
    auditEvent(ctx, "Hospitality Catalogue items merged", survivor.canonicalId, `“${text(source.record.name)}” merged into “${text(survivor.record.name)}” by explicit operator decision.`, { survivorItemId: survivor.canonicalId, sourceItemId: source.canonicalId, groupId: command.groupId, offeringsRepointed: child.offerings.length });
  });
  const survivorRoute = routes.find(route => route.id === survivor.canonicalId); const inherited = routes.find(route => route.id !== survivor.canonicalId);
  if (!survivorRoute && inherited) ctx.tx.set(routingCollection().doc(stableDocumentId(survivor.canonicalId)), { menuItemId: survivor.canonicalId, workstreams: inherited.doc!.workstreams || [], version: 1, createdAt: ctx.now, updatedAt: ctx.now, updatedBy: ctx.actor.uid, inheritedFrom: inherited.id });
  const groupId = command.groupId || reviewGroupId(ids);
  ctx.tx.set(decisionCollection().doc(groupId), { groupId, memberIds: [...ids].sort(), decision: "merge", survivorItemId: survivor.canonicalId, decidedAt: ctx.now, decidedBy: ctx.actor.uid });
  void repointed;
  return { itemIds: ids, reload: true, message: `Merged ${sources.length} item${sources.length === 1 ? "" : "s"} into “${text(survivor.record.name)}”. All site offerings, prices and routing were kept.` };
}

async function recordReviewDecision(ctx: Ctx, command: Extract<CatalogueCommand, { action: "record-review-decision" }>): Promise<CatalogueCommandResult> {
  const memberIds = [...new Set(command.memberIds)].sort();
  if (memberIds.length < 2) throw problem("A review group needs at least two items.");
  const id = reviewGroupId(memberIds); const ref = decisionCollection().doc(id);
  const existing = (await readDoc(ctx, ref)).data() as { decision?: string; version?: number } | undefined;
  if (existing?.decision === "merge") throw problem("This group was already merged.", 409);
  ctx.tx.set(ref, { groupId: id, memberIds, decision: command.decision, decidedAt: ctx.now, decidedBy: ctx.actor.uid, version: Number(existing?.version || 0) + 1 });
  auditEvent(ctx, command.decision === "keep_separate" ? "Hospitality Catalogue items kept separate" : "Hospitality Catalogue review deferred", memberIds[0], command.decision === "keep_separate" ? "Operator confirmed these are different products." : "Operator deferred the decision.", { groupId: id, memberIds, before: existing?.decision ?? null, after: command.decision });
  return { itemIds: memberIds, reload: true, message: command.decision === "keep_separate" ? "Kept separate." : "Deferred." };
}

export async function runCatalogueCommand(actor: Actor, command: CatalogueCommand): Promise<CatalogueCommandResult> {
  assertPermission(actor, "hospitality.catalogue.manage");
  return db.runTransaction(async tx => {
    const ctx: Ctx = { tx, actor, now: new Date().toISOString() };
    switch (command.action) {
      case "create-item": return createItem(ctx, command);
      case "update-item": return updateItem(ctx, command);
      case "set-default-price": return setDefaultPrice(ctx, command);
      case "set-routing": return setRouting(ctx, command);
      case "set-item-status": return setItemStatus(ctx, command);
      case "set-site-availability": return setSiteAvailability(ctx, command);
      case "set-site-override": return setSiteOverride(ctx, command);
      case "adopt-company-default": return adoptCompanyDefault(ctx, command);
      case "merge-items": return mergeItems(ctx, command);
      case "record-review-decision": return recordReviewDecision(ctx, command);
    }
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// BULK UPDATE. One independent transaction per Item (Firestore transaction limits make one giant atomic write impractical), bounded to
// MAX_BULK_ITEMS, processed in a deterministic order, replay-safe through a per-Item receipt, and reported per Item: there is no silent
// partial success. Every field is opt-in ("leave unchanged" = absent). Company defaults never touch site overrides.
// ---------------------------------------------------------------------------------------------------------------------
export const MAX_BULK_ITEMS = 50;
export type BulkSpec = {
  operationId: string; itemIds: string[]; expectedVersions: Record<string, number>; expectedRoutingVersions?: Record<string, number>;
  production?: RoutingChoice; price?: PriceInput; minimum?: { mode: "set"; value: number } | { mode: "clear" };
  sites?: { mode: "add" | "remove" | "replace"; oplocIds: string[] }; archive?: boolean;
};
export type BulkItemResult = { itemId: string; status: "applied" | "unchanged" | "already_applied" | "failed"; message: string };
export type BulkResult = { operationId: string; results: BulkItemResult[]; succeeded: number; failed: number; message: string };

export function validateBulkSpec(spec: BulkSpec) {
  const ids = [...new Set(spec.itemIds)];
  if (!spec.operationId || spec.operationId.length < 8) throw problem("A bulk operation needs an operation id.");
  if (!ids.length) throw problem("Select at least one item.");
  if (ids.length > MAX_BULK_ITEMS) throw problem(`Bulk changes are limited to ${MAX_BULK_ITEMS} items at a time. Narrow the selection.`);
  const changes = [spec.production, spec.price, spec.minimum, spec.sites, spec.archive].filter(value => value !== undefined && value !== false);
  if (!changes.length) throw problem("Choose at least one change; every field is left unchanged by default.");
  if (spec.archive && changes.length > 1) throw problem("Archive is a separate action: it cannot be combined with other changes.");
  if (spec.production && !ROUTING_CHOICES.includes(spec.production)) throw problem("Choose one of the four production routes.");
  if (spec.price) money(spec.price.amount, "Default price");
  if (spec.minimum?.mode === "set") quantity(spec.minimum.value, "Default minimum");
  if (spec.sites && ![...new Set(spec.sites.oplocIds)].length) throw problem("Choose at least one site. To remove an item from every site, use Remove sites with all sites selected.");
  return ids.sort();
}

async function bulkOne(ctx: Ctx, itemId: string, spec: BulkSpec, activeIds: string[]): Promise<BulkItemResult> {
  const receiptRef = audit().doc(`bulk-${spec.operationId}-${crypto.createHash("sha256").update(itemId).digest("hex").slice(0, 24)}`);
  const itemRef = canonical().doc(stableDocumentId(itemId)); const routeRef = routingCollection().doc(stableDocumentId(itemId));
  const siteIds = spec.sites ? [...new Set(spec.sites.oplocIds)] : [];
  const [receipt, itemSnapshot, routeSnapshot, children] = await Promise.all([
    readDoc(ctx, receiptRef), readDoc(ctx, itemRef), spec.production ? readDoc(ctx, routeRef) : Promise.resolve(undefined),
    spec.price || spec.sites || spec.archive ? itemChildren(ctx, itemId) : Promise.resolve({ offerings: [] as CanonicalRecord[], itemPrices: [] as CanonicalRecord[] }),
  ]);
  const ownPrices = spec.sites ? await offeringPrices(ctx, children.offerings.map(offering => offering.canonicalId)) : [];
  if (receipt.exists) return { itemId, status: "already_applied", message: "Already applied by an earlier attempt of this operation." };
  const item = requireItem(itemSnapshot); const name = text(item.record.name);
  expectVersion(item, spec.expectedVersions[itemId], `“${name}”`);
  const archived = item.record.lifecycleState === "archived";
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {}; const touchedSites: string[] = []; let changed = false;
  if (spec.archive) {
    if (archived) return { itemId, status: "failed", message: `“${name}” is already archived.` };
    stage(ctx, "Hospitality Menu Item", { ...bump(ctx, item.record), lifecycleState: "archived" }, item, "Archived by bulk operation.");
    for (const offering of children.offerings.filter(candidate => candidate.record.lifecycleState !== "archived")) retire(ctx, offering, "item-archived", "Retired with the archived Item (bulk operation).");
    before.lifecycleState = "active"; after.lifecycleState = "archived"; changed = true;
  } else {
    if (archived) return { itemId, status: "failed", message: `“${name}” is archived. Restore it before editing.` };
    let record: Record<string, unknown> = item.record; const today = ukBusinessDate();
    if (spec.production) {
      const current = routeSnapshot!.exists ? routeSnapshot!.data() as { workstreams?: string[]; version?: number; supersededBy?: string } : undefined;
      const currentVersion = current ? Number(current.version || 1) : 0;
      if (currentVersion !== Number(spec.expectedRoutingVersions?.[itemId] ?? -1)) throw stale(`“${name}” production routing`);
      const state = routingStateOf(current ? { menuItemId: itemId, workstreams: current.workstreams || [], version: current.version, supersededBy: current.supersededBy } : undefined).state;
      if (state !== spec.production) {
        ctx.tx.set(routeRef, { menuItemId: itemId, workstreams: ROUTING_CHOICE_WORKSTREAMS[spec.production], version: currentVersion + 1, createdAt: (routeSnapshot!.data() as { createdAt?: string } | undefined)?.createdAt || ctx.now, updatedAt: ctx.now, updatedBy: ctx.actor.uid, supersededBy: FieldValue.delete(), supersededAt: FieldValue.delete() }, { merge: true });
        before.production = state; after.production = spec.production; changed = true;
      }
    }
    if (spec.price) {
      const previous = currentPrice(children.itemPrices, today);
      const input = { amount: money(spec.price.amount, "Default price"), vatRate: vat(spec.price.vatRate ?? previous?.record.vatRate as number | undefined) };
      if (!previous || previous.record.amount !== input.amount || previous.record.vatRate !== input.vatRate) {
        replaceScopedPrice(ctx, { itemId }, children.itemPrices, input, today, "Company default price changed by bulk operation.");
        before.defaultPrice = previous ? { amount: previous.record.amount, vatRate: previous.record.vatRate } : null; after.defaultPrice = input; changed = true;
      }
    }
    if (spec.minimum) {
      const next = spec.minimum.mode === "set" ? quantity(spec.minimum.value, "Default minimum") : undefined;
      if (item.record.defaultMinimumQuantity !== next) { before.defaultMinimumQuantity = item.record.defaultMinimumQuantity ?? null; after.defaultMinimumQuantity = next ?? null; record = next === undefined ? without(record, "defaultMinimumQuantity") : { ...record, defaultMinimumQuantity: next }; changed = true; }
    }
    if (spec.sites) {
      // Availability is the default at every active OPLOC. Only EXCLUSIONS are stored: add clears an exception, remove records one, replace
      // excludes every active site that is not selected. Selecting all sites therefore stores nothing.
      const unknown = siteIds.filter(id => !activeIds.includes(id)); if (unknown.length) throw problem(`${unknown.length} selected site${unknown.length === 1 ? " is" : "s are"} not active locations.`);
      const wanted = new Set(siteIds);
      const edits = spec.sites.mode === "add" ? siteIds.map(oplocId => ({ oplocId, available: true })) : spec.sites.mode === "remove" ? siteIds.map(oplocId => ({ oplocId, available: false })) : activeIds.map(oplocId => ({ oplocId, available: wanted.has(oplocId) }));
      touchedSites.push(...applySiteEdits(ctx, item, children, ownPrices, edits, today));
      if (touchedSites.length) { before.sites = "see sites"; after.sites = touchedSites; changed = true; }
    }
    if (changed) stage(ctx, "Hospitality Menu Item", bump(ctx, record), item, "Hospitality Catalogue bulk update (item version touched).");
  }
  if (!changed) return { itemId, status: "unchanged", message: "Already matches; nothing to change." };
  ctx.tx.create(receiptRef, { action: "Hospitality Catalogue bulk update", entityReference: itemId, actorId: ctx.actor.uid, actorName: ctx.actor.name, timestamp: ctx.now, reason: `Bulk operation ${spec.operationId}: “${name}”.`, details: JSON.parse(JSON.stringify({ bulkOperationId: spec.operationId, itemId, before, after, oplocIds: [...new Set(touchedSites.map(entry => entry.slice(1)))] })) });
  return { itemId, status: "applied", message: "Applied." };
}

export async function runBulkCatalogueUpdate(actor: Actor, spec: BulkSpec): Promise<BulkResult> {
  assertPermission(actor, "hospitality.catalogue.manage");
  const ids = validateBulkSpec(spec);
  const results: BulkItemResult[] = [];
  // Active OPLOCs are read ONCE for the whole operation (not per Item): bounded, ~24 documents.
  const activeIds = spec.sites ? (await db.collection("integrationHubCanonical").where("entityType", "==", "OPLOC").get()).docs.map(doc => doc.data() as CanonicalRecord).filter(isActiveOploc).map(record => record.canonicalId).sort() : [];
  for (const itemId of ids) {
    try { results.push(await db.runTransaction(tx => bulkOne({ tx, actor, now: new Date().toISOString() }, itemId, spec, activeIds))); }
    catch (error) { results.push({ itemId, status: "failed", message: (error as Error).message }); }
  }
  const succeeded = results.filter(result => result.status !== "failed").length, failed = results.length - succeeded;
  const kinds = [spec.production && "production", spec.price && "default price", spec.minimum && "default minimum", spec.sites && `sites:${spec.sites.mode}`, spec.archive && "archive"].filter(Boolean);
  await audit().doc(`bulk-${spec.operationId}`).set({ action: "Hospitality Catalogue bulk operation", entityReference: spec.operationId, actorId: actor.uid, actorName: actor.name, timestamp: new Date().toISOString(), reason: `${kinds.join(", ")} on ${ids.length} item${ids.length === 1 ? "" : "s"}: ${succeeded} succeeded, ${failed} failed.`, details: JSON.parse(JSON.stringify({ bulkOperationId: spec.operationId, operations: kinds, itemIds: ids, oplocIds: spec.sites?.oplocIds ?? [], succeeded, failed, results })) }, { merge: true });
  return { operationId: spec.operationId, results, succeeded, failed, message: failed ? `${succeeded} of ${results.length} items updated; ${failed} could not be changed.` : `${succeeded} item${succeeded === 1 ? "" : "s"} updated.` };
}

// ---------------------------------------------------------------------------------------------------------------------
// GOVERNED RETIREMENT of Offering records that must not exist in the sparse model (redundant default availability, or records still active
// on an archived Item). Retired = archived with a reason: nothing is deleted, history and ids stay valid, effective availability is unchanged
// for redundant records and removed for records on archived Items. One transaction per record, version-guarded, replay-safe receipts.
// ---------------------------------------------------------------------------------------------------------------------
export type RetireTarget = { offeringId: string; expectedVersion: number };
export type RetireResult = { offeringId: string; status: "retired" | "already_retired" | "failed"; message: string };
export async function retireOfferingRecords(actor: Actor, spec: { operationId: string; reason: "redundant-default" | "item-archived"; targets: RetireTarget[]; /** When set, a record is only retired if it was created by this actor and is still at version 1 (never edited). */ requireCreatedBy?: string }): Promise<RetireResult[]> {
  assertPermission(actor, "hospitality.catalogue.manage");
  if (!spec.operationId || spec.operationId.length < 8) throw problem("A retirement needs an operation id.");
  const results: RetireResult[] = [];
  for (const target of [...spec.targets].sort((a, b) => a.offeringId.localeCompare(b.offeringId))) {
    try {
      results.push(await db.runTransaction(async tx => {
        const ctx: Ctx = { tx, actor, now: new Date().toISOString() };
        const ref = canonical().doc(stableDocumentId(target.offeringId));
        const receiptRef = audit().doc(`retire-${spec.operationId}-${crypto.createHash("sha256").update(target.offeringId).digest("hex").slice(0, 24)}`);
        const [snapshot, receipt] = await Promise.all([readDoc(ctx, ref), readDoc(ctx, receiptRef)]);
        const offering = asRecord(snapshot);
        if (receipt.exists) return { offeringId: target.offeringId, status: "already_retired" as const, message: "Already retired by an earlier attempt of this operation." };
        if (!offering || offering.entityType !== "Hospitality Menu Offering") throw problem("Offering record was not found.", 404);
        if (offering.record.lifecycleState === "archived") return { offeringId: target.offeringId, status: "already_retired" as const, message: "Already archived." };
        expectVersion(offering, target.expectedVersion, "This offering record");
        if (spec.requireCreatedBy && (offering.record.createdBy !== spec.requireCreatedBy || Number(offering.record.version) !== 1)) throw problem("This record was not created by the expected operation or has been edited since; it is left untouched.", 409);
        if (spec.reason === "redundant-default" && (offering.record.available === false || offering.record.minimumQuantity !== undefined || offering.record.configuration !== undefined)) throw problem("This record carries a site difference and is not redundant; it is left untouched.", 409);
        retire(ctx, offering, spec.reason, spec.reason === "item-archived" ? "Retired: the Item is archived." : "Retired: redundant default availability (the sparse model stores exceptions only).");
        const itemId = text(offering.record.hospitalityMenuItemId);
        tx.create(receiptRef, { action: "Hospitality Catalogue site record retired", entityReference: itemId, actorId: actor.uid, actorName: actor.name, timestamp: ctx.now, reason: spec.reason === "item-archived" ? "Site record retired because its Item is archived." : "Site record retired: it stated nothing beyond the company defaults.", details: { retireOperationId: spec.operationId, offeringId: target.offeringId, itemId, oplocId: offering.record.oplocId, reason: spec.reason, before: { lifecycleState: "active", version: offering.record.version }, after: { lifecycleState: "archived", retiredReason: spec.reason } } });
        return { offeringId: target.offeringId, status: "retired" as const, message: "Retired." };
      }));
    } catch (error) { results.push({ offeringId: target.offeringId, status: "failed", message: (error as Error).message }); }
  }
  return results;
}

// ---------------------------------------------------------------------------------------------------------------------
// GOVERNED PROMOTION of product-level booking settings from legacy site Offerings onto the canonical Item (one transaction per Item,
// version-guarded, receipt-backed). Never overwrites a different existing Item default. Source records are stripped of what was promoted and
// then retired if they state nothing else (their original content stays in the revision history); records that still carry a genuine
// difference (site price, minimum, wording) are kept with their ids.
// ---------------------------------------------------------------------------------------------------------------------
export type PromotionTarget = { itemId: string; expectedVersion: number; configuration?: Record<string, unknown>; noticeRequiredDays?: number; minimumGuests?: number; minimumQuantity?: number; mode?: "quote_only"; sourceOfferingIds: string[] };
export type PromotionResult = { itemId: string; status: "promoted" | "already_applied" | "failed"; message: string; retired: number; kept: number };
export async function promoteProductSettings(actor: Actor, spec: { operationId: string; targets: PromotionTarget[] }): Promise<PromotionResult[]> {
  assertPermission(actor, "hospitality.catalogue.manage");
  if (!spec.operationId || spec.operationId.length < 8) throw problem("A promotion needs an operation id.");
  const results: PromotionResult[] = [];
  for (const target of [...spec.targets].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
    try {
      results.push(await db.runTransaction(async tx => {
        const ctx: Ctx = { tx, actor, now: new Date().toISOString() };
        const receiptRef = audit().doc(`promote-${spec.operationId}-${crypto.createHash("sha256").update(target.itemId).digest("hex").slice(0, 24)}`);
        const [receipt, itemSnapshot, children] = await Promise.all([readDoc(ctx, receiptRef), readDoc(ctx, canonical().doc(stableDocumentId(target.itemId))), itemChildren(ctx, target.itemId)]);
        if (receipt.exists) return { itemId: target.itemId, status: "already_applied" as const, message: "Already applied by an earlier attempt of this operation.", retired: 0, kept: 0 };
        const item = requireItem(itemSnapshot); expectVersion(item, target.expectedVersion, "This item");
        if (isArchived(item)) throw problem("The item is archived.");
        const ownPrices = await offeringPrices(ctx, children.offerings.map(offering => offering.canonicalId));
        const existing = item.record;
        const clash = (field: string, next: unknown) => existing[field] !== undefined && JSON.stringify(existing[field]) !== JSON.stringify(next);
        if ((target.configuration && clash("configuration", target.configuration)) || (target.noticeRequiredDays !== undefined && clash("defaultNoticeRequiredDays", target.noticeRequiredDays)) || (target.minimumGuests !== undefined && clash("defaultMinimumGuests", target.minimumGuests)) || (target.minimumQuantity !== undefined && clash("defaultMinimumQuantity", target.minimumQuantity)) || (target.mode && clash("defaultOfferingMode", target.mode))) throw problem("The item already has a different company default for one of these settings; nothing was changed.", 409);
        const promoted: Record<string, unknown> = { ...(target.configuration ? { configuration: target.configuration } : {}), ...(target.noticeRequiredDays !== undefined ? { defaultNoticeRequiredDays: target.noticeRequiredDays } : {}), ...(target.minimumGuests !== undefined ? { defaultMinimumGuests: target.minimumGuests } : {}), ...(target.minimumQuantity !== undefined ? { defaultMinimumQuantity: target.minimumQuantity } : {}), ...(target.mode ? { defaultOfferingMode: target.mode } : {}) };
        const nextItem: CanonicalRecord = { ...item, record: { ...item.record, ...promoted } };
        const sources = children.offerings.filter(offering => target.sourceOfferingIds.includes(offering.canonicalId) && offering.record.lifecycleState !== "archived");
        let retired = 0, kept = 0; const today = ukBusinessDate();
        for (const offering of sources) {
          let record: Record<string, unknown> = { ...offering.record };
          if (target.noticeRequiredDays !== undefined) record = without(record, "noticeRequiredDays");
          if (target.minimumGuests !== undefined) record = without(record, "minimumGuests");
          if (target.minimumQuantity !== undefined) record = without(record, "minimumQuantity");
          if (target.configuration) { const configuration = { ...((record.configuration || {}) as Record<string, unknown>) }; for (const key of Object.keys(target.configuration)) delete configuration[key]; record = Object.keys(configuration).length ? { ...record, configuration } : without(record, "configuration"); }
          if (noEffect(record, ownPrices, nextItem, children.itemPrices, today)) { retire(ctx, offering, "redundant-default", "Product settings promoted to the Item; this site record now states nothing else."); retired++; }
          else { stage(ctx, "Hospitality Menu Offering", bump(ctx, record), offering, "Product settings promoted to the Item; remaining site differences kept."); kept++; }
        }
        stage(ctx, "Hospitality Menu Item", { ...bump(ctx, item.record), ...promoted }, item, "Product-level booking settings promoted from site records.");
        tx.create(receiptRef, { action: "Hospitality Catalogue product settings promoted", entityReference: target.itemId, actorId: actor.uid, actorName: actor.name, timestamp: ctx.now, reason: `Promoted product-level booking settings of “${text(item.record.name)}” to the company item.`, details: JSON.parse(JSON.stringify({ promotionOperationId: spec.operationId, itemId: target.itemId, before: Object.fromEntries(Object.keys(promoted).map(key => [key, existing[key] ?? null])), after: promoted, sourceOfferingIds: target.sourceOfferingIds, retired, kept })) });
        return { itemId: target.itemId, status: "promoted" as const, message: "Promoted.", retired, kept };
      }));
    } catch (error) { results.push({ itemId: target.itemId, status: "failed", message: (error as Error).message, retired: 0, kept: 0 }); }
  }
  return results;
}
