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
/** Server-side twin of the picker rule (see isHospitalitySite): an Offering may only be created at an active location carrying the governed hospitalityEnabled marker. */
const isHospitalityOploc = (oploc: CanonicalRecord) => oploc.record.lifecycleState === "active" && oploc.lifecycleStatus !== "archived" && oploc.record.hospitalityEnabled === true;
const without = (record: Record<string, unknown>, ...keys: string[]) => { const copy = { ...record }; for (const key of keys) delete copy[key]; return copy; };
const dayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

export type PriceInput = { amount: number; vatRate?: number };
export type CatalogueCommand =
  | { action: "create-item"; requestId: string; name: string; category: string; description?: string; routing: RoutingChoice; defaultPrice?: PriceInput; defaultMinimumQuantity?: number; oplocIds: string[]; providerMappings?: Array<{ provider: string; sourceItemId: string; sourceVersion?: string }> }
  | { action: "update-item"; itemId: string; expectedVersion: number; name: string; category: string; description?: string; defaultMinimumQuantity: number | null; defaultPrice?: PriceInput }
  | { action: "set-default-price"; itemId: string; expectedVersion: number; price: PriceInput }
  | { action: "set-routing"; itemId: string; routing: RoutingChoice; expectedRoutingVersion: number }
  | { action: "set-item-status"; itemId: string; expectedVersion: number; status: "active" | "archived" }
  | { action: "add-offering"; itemId: string; expectedVersion: number; oplocId: string; operationalAreaId?: string; mode?: "standard" | "quote_only" }
  | { action: "set-offering-status"; offeringId: string; expectedVersion: number; status: "active" | "archived" }
  | { action: "set-offering-override"; offeringId: string; expectedVersion: number; price?: PriceInput | null; minimumQuantity?: number | null; displayName?: string | null; description?: string | null }
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
  const [itemSnapshot, items, ...oplocSnapshots] = await Promise.all([readDoc(ctx, itemRef), allItems(ctx), ...oplocIds.map(id => readDoc(ctx, canonical().doc(stableDocumentId(id))))]);
  if (itemSnapshot.exists) return { itemIds: [itemId], reload: false, message: "This item was already created." }; // replay-safe retry
  const sameName = existingCandidatesForNewItem(items, { name });
  if (sameName.length) throw problem(`An item called “${name}” already exists in the catalogue. Open it and make it available at the site instead of creating a duplicate.`, 409);
  if (items.some(item => isArchived(item) && normaliseName(item.record.name) === normaliseName(name))) throw problem(`An archived item called “${name}” exists. Restore it instead of creating a duplicate.`, 409);
  for (const mapping of command.providerMappings || []) {
    const clash = items.find(item => !isArchived(item) && sourceIdentities(item).includes(mapping.sourceItemId));
    if (clash) throw problem(`Provider reference “${mapping.sourceItemId}” is already mapped to “${text(clash.record.name)}”.`, 409);
  }
  oplocSnapshots.forEach((snapshot, index) => { const oploc = asRecord(snapshot); if (!oploc || oploc.entityType !== "OPLOC" || !isHospitalityOploc(oploc)) throw problem(`Site ${index + 1} is not an active Hospitality-enabled location.`); });
  const record = { ...base(ctx.actor, ctx.now), entityType: "Hospitality Menu Item" as const, canonicalId: itemId, name, category, ...(command.description?.trim() ? { description: command.description.trim() } : {}), lifecycleState: "active" as const, ...(minimum !== undefined ? { defaultMinimumQuantity: minimum } : {}), dietaryInformation: [] as string[], allergenInformation: [] as string[], providerMappings: command.providerMappings || [] };
  stage(ctx, "Hospitality Menu Item", record, undefined, "Hospitality Catalogue item created.");
  if (price) stage(ctx, "Hospitality Menu Price", { ...base(ctx.actor, ctx.now), entityType: "Hospitality Menu Price", canonicalId: generateCanonicalId("Hospitality Menu Price"), hospitalityMenuItemId: itemId, amount: price.amount, currency: "GBP" as const, vatRate: price.vatRate, effectiveFrom: ukBusinessDate(), lifecycleState: "active" as const }, undefined, "Company default price set at creation.");
  for (const oplocId of oplocIds) stage(ctx, "Hospitality Menu Offering", { ...base(ctx.actor, ctx.now), entityType: "Hospitality Menu Offering", canonicalId: generateCanonicalId("Hospitality Menu Offering"), hospitalityMenuItemId: itemId, oplocId, offeringMode: "standard" as const, lifecycleState: "active" as const }, undefined, "Offering created with the item.");
  ctx.tx.create(routingCollection().doc(stableDocumentId(itemId)), { menuItemId: itemId, workstreams: ROUTING_CHOICE_WORKSTREAMS[command.routing], version: 1, createdAt: ctx.now, updatedAt: ctx.now, updatedBy: ctx.actor.uid });
  auditEvent(ctx, "Hospitality Catalogue item created", itemId, `Created “${name}” (${labelOf(command.routing)}) at ${oplocIds.length} site${oplocIds.length === 1 ? "" : "s"}.`, { itemId, after: { name, category, routing: command.routing, defaultPrice: price, defaultMinimumQuantity: minimum, oplocIds } });
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
  const [snapshot, items] = await Promise.all([readDoc(ctx, itemRef), command.status === "active" ? allItems(ctx) : Promise.resolve([] as CanonicalRecord[])]);
  const item = requireItem(snapshot); expectVersion(item, command.expectedVersion, "This item");
  const archived = item.record.lifecycleState === "archived";
  if (command.status === "archived" && archived) throw problem("This item is already archived.");
  if (command.status === "active" && !archived) throw problem("This item is already active.");
  if (command.status === "active" && items.some(other => other.canonicalId !== item.canonicalId && !isArchived(other) && normaliseName(other.record.name) === normaliseName(item.record.name))) throw problem(`Another active item is already called “${text(item.record.name)}”; restoring this one would create a duplicate.`, 409);
  stage(ctx, "Hospitality Menu Item", { ...bump(ctx, item.record), lifecycleState: command.status }, item, command.status === "archived" ? "Hospitality Catalogue item archived." : "Hospitality Catalogue item restored.");
  auditEvent(ctx, command.status === "archived" ? "Hospitality Catalogue item archived" : "Hospitality Catalogue item restored", item.canonicalId, `${command.status === "archived" ? "Archived" : "Restored"} “${text(item.record.name)}”. Offerings, prices, routing and history are retained.`, { itemId: item.canonicalId, before: { lifecycleState: item.record.lifecycleState }, after: { lifecycleState: command.status } });
  return { itemIds: [item.canonicalId], reload: false, message: command.status === "archived" ? "Item archived. It no longer appears on booking menus; history is kept." : "Item restored." };
}

async function addOffering(ctx: Ctx, command: Extract<CatalogueCommand, { action: "add-offering" }>): Promise<CatalogueCommandResult> {
  const itemRef = canonical().doc(stableDocumentId(command.itemId));
  const [itemSnapshot, oplocSnapshot] = await Promise.all([readDoc(ctx, itemRef), readDoc(ctx, canonical().doc(stableDocumentId(command.oplocId)))]);
  const item = requireItem(itemSnapshot); expectVersion(item, command.expectedVersion, "This item");
  if (isArchived(item)) throw problem("Restore the item before making it available at a site.");
  const oploc = asRecord(oplocSnapshot);
  if (!oploc || oploc.entityType !== "OPLOC" || !isHospitalityOploc(oploc)) throw problem("Choose an active Hospitality-enabled location.");
  const mode = command.mode || "standard"; const key = `${command.oplocId}|${command.operationalAreaId || ""}|${mode}`;
  const { offerings } = await itemChildren(ctx, item.canonicalId);
  const existing = offerings.find(offering => `${offering.record.oplocId}|${offering.record.operationalAreaId || ""}|${offering.record.offeringMode}` === key);
  if (existing && existing.record.lifecycleState !== "archived") throw problem("This item is already available at that site.", 409);
  if (existing) stage(ctx, "Hospitality Menu Offering", { ...bump(ctx, existing.record), lifecycleState: "active" }, existing, "Offering re-enabled.");
  else stage(ctx, "Hospitality Menu Offering", { ...base(ctx.actor, ctx.now), entityType: "Hospitality Menu Offering", canonicalId: generateCanonicalId("Hospitality Menu Offering"), hospitalityMenuItemId: item.canonicalId, oplocId: command.oplocId, ...(command.operationalAreaId ? { operationalAreaId: command.operationalAreaId } : {}), offeringMode: mode, lifecycleState: "active" as const }, undefined, "Offering created.");
  stage(ctx, "Hospitality Menu Item", bump(ctx, item.record), item, "Offering added (item version touched).");
  auditEvent(ctx, "Hospitality Catalogue offering enabled", item.canonicalId, `“${text(item.record.name)}” made available at a site.`, { itemId: item.canonicalId, oplocId: command.oplocId, operationalAreaId: command.operationalAreaId, reEnabled: Boolean(existing) });
  return { itemIds: [item.canonicalId], reload: false, message: "Available at the site. It inherits the company default price and minimum." };
}

async function setOfferingStatus(ctx: Ctx, command: Extract<CatalogueCommand, { action: "set-offering-status" }>): Promise<CatalogueCommandResult> {
  const snapshot = await readDoc(ctx, canonical().doc(stableDocumentId(command.offeringId)));
  const offering = asRecord(snapshot);
  if (!offering || offering.entityType !== "Hospitality Menu Offering") throw problem("Offering was not found.", 404);
  expectVersion(offering, command.expectedVersion, "This site offering");
  if (offering.record.lifecycleState === command.status) throw problem(`This site offering is already ${command.status === "active" ? "enabled" : "disabled"}.`);
  stage(ctx, "Hospitality Menu Offering", { ...bump(ctx, offering.record), lifecycleState: command.status }, offering, command.status === "active" ? "Offering enabled." : "Offering disabled (retained for history).");
  const itemId = text(offering.record.hospitalityMenuItemId);
  auditEvent(ctx, command.status === "active" ? "Hospitality Catalogue offering enabled" : "Hospitality Catalogue offering disabled", itemId, `Site availability ${command.status === "active" ? "enabled" : "disabled"}. Overrides are retained.`, { itemId, offeringId: offering.canonicalId, oplocId: offering.record.oplocId, before: { lifecycleState: offering.record.lifecycleState }, after: { lifecycleState: command.status } });
  return { itemIds: [itemId], reload: false, message: command.status === "active" ? "Enabled at the site." : "Disabled at the site. Its overrides and history are kept." };
}

async function setOfferingOverride(ctx: Ctx, command: Extract<CatalogueCommand, { action: "set-offering-override" }>): Promise<CatalogueCommandResult> {
  const offeringRef = canonical().doc(stableDocumentId(command.offeringId));
  const offeringSnapshot = await readDoc(ctx, offeringRef); const offering = asRecord(offeringSnapshot);
  if (!offering || offering.entityType !== "Hospitality Menu Offering") throw problem("Offering was not found.", 404);
  expectVersion(offering, command.expectedVersion, "This site offering");
  const itemId = text(offering.record.hospitalityMenuItemId);
  const [itemSnapshot, ownPrices, children] = await Promise.all([readDoc(ctx, canonical().doc(stableDocumentId(itemId))), offeringPrices(ctx, [offering.canonicalId]), itemChildren(ctx, itemId)]);
  const item = requireItem(itemSnapshot);
  if (isArchived(item)) throw problem("Restore the item before editing site overrides.");
  if (offering.record.lifecycleState === "archived") throw problem("Enable the site offering before editing its overrides.");
  if (command.price === undefined && command.minimumQuantity === undefined && command.displayName === undefined && command.description === undefined) throw problem("Nothing to change.");
  const today = ukBusinessDate(); const defaultPrice = currentPrice(children.itemPrices, today);
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {}; let record: Record<string, unknown> = bump(ctx, offering.record);
  if (command.price !== undefined) {
    const current = currentPrice(ownPrices, today); before.price = current ? { amount: current.record.amount, vatRate: current.record.vatRate } : null;
    if (command.price === null) { if (!archiveScopedPrices(ctx, ownPrices, "Site price override reset to company default.").length) throw problem("This site has no price override to reset."); after.price = null; }
    else {
      if (offering.record.offeringMode === "quote_only") throw problem("Quote-only offerings cannot have a price.");
      const input = { amount: money(command.price.amount, "Site price"), vatRate: vat(command.price.vatRate ?? defaultPrice?.record.vatRate as number | undefined) };
      if (defaultPrice && defaultPrice.record.amount === input.amount && defaultPrice.record.vatRate === input.vatRate) throw problem("That equals the company default. Use “Reset to company default” instead of storing a duplicate.");
      replaceScopedPrice(ctx, { offeringId: offering.canonicalId }, ownPrices, input, today, "Site price override set."); after.price = input;
    }
  }
  if (command.minimumQuantity !== undefined) {
    before.minimumQuantity = offering.record.minimumQuantity ?? null;
    if (command.minimumQuantity === null) { record = without(record, "minimumQuantity"); after.minimumQuantity = null; }
    else {
      const minimum = quantity(command.minimumQuantity, "Site minimum");
      if (minimum === item.record.defaultMinimumQuantity) throw problem("That equals the company default minimum. Use “Reset to company default” instead.");
      record = { ...record, minimumQuantity: minimum }; after.minimumQuantity = minimum;
    }
  }
  if (command.displayName !== undefined || command.description !== undefined) {
    const configuration = { ...((offering.record.configuration || {}) as Record<string, unknown>) };
    if (command.displayName !== undefined) { before.displayName = configuration.displayName ?? null; if (command.displayName === null || !command.displayName.trim()) delete configuration.displayName; else configuration.displayName = command.displayName.trim(); after.displayName = configuration.displayName ?? null; }
    if (command.description !== undefined) { before.description = configuration.description ?? null; if (command.description === null || !command.description.trim()) delete configuration.description; else configuration.description = command.description.trim(); after.description = configuration.description ?? null; }
    if (Object.keys(configuration).length) record = { ...record, configuration }; else record = without(record, "configuration");
  }
  stage(ctx, "Hospitality Menu Offering", record, offering, "Site override changed.");
  const action = command.price === null || command.minimumQuantity === null ? "Hospitality Catalogue override removed" : "Hospitality Catalogue override set";
  auditEvent(ctx, action, itemId, `Site override changed for “${text(item.record.name)}”.`, { itemId, offeringId: offering.canonicalId, oplocId: offering.record.oplocId, before, after });
  return { itemIds: [itemId], reload: false, message: command.price === null || command.minimumQuantity === null ? "Reset to company default." : "Override saved." };
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
    if (changed) stage(ctx, "Hospitality Menu Offering", bump(ctx, record), offering, "Site minimum equalled the adopted company default; override removed.");
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
      case "add-offering": return addOffering(ctx, command);
      case "set-offering-status": return setOfferingStatus(ctx, command);
      case "set-offering-override": return setOfferingOverride(ctx, command);
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

async function bulkOne(ctx: Ctx, itemId: string, spec: BulkSpec): Promise<BulkItemResult> {
  const receiptRef = audit().doc(`bulk-${spec.operationId}-${crypto.createHash("sha256").update(itemId).digest("hex").slice(0, 24)}`);
  const itemRef = canonical().doc(stableDocumentId(itemId)); const routeRef = routingCollection().doc(stableDocumentId(itemId));
  const siteIds = spec.sites ? [...new Set(spec.sites.oplocIds)] : [];
  const [receipt, itemSnapshot, routeSnapshot, children, ...oplocSnapshots] = await Promise.all([
    readDoc(ctx, receiptRef), readDoc(ctx, itemRef), spec.production ? readDoc(ctx, routeRef) : Promise.resolve(undefined),
    spec.price || spec.sites ? itemChildren(ctx, itemId) : Promise.resolve({ offerings: [] as CanonicalRecord[], itemPrices: [] as CanonicalRecord[] }),
    ...(spec.sites && spec.sites.mode !== "remove" ? siteIds.map(id => readDoc(ctx, canonical().doc(stableDocumentId(id)))) : []),
  ]);
  if (receipt.exists) return { itemId, status: "already_applied", message: "Already applied by an earlier attempt of this operation." };
  const item = requireItem(itemSnapshot); const name = text(item.record.name);
  expectVersion(item, spec.expectedVersions[itemId], `“${name}”`);
  const archived = item.record.lifecycleState === "archived";
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {}; const touchedSites: string[] = []; let changed = false;
  if (spec.archive) {
    if (archived) return { itemId, status: "failed", message: `“${name}” is already archived.` };
    stage(ctx, "Hospitality Menu Item", { ...bump(ctx, item.record), lifecycleState: "archived" }, item, "Archived by bulk operation.");
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
      if (spec.sites.mode !== "remove") oplocSnapshots.forEach((snapshot, index) => { const oploc = asRecord(snapshot); if (!oploc || oploc.entityType !== "OPLOC" || !isHospitalityOploc(oploc)) throw problem(`Site ${index + 1} is not an active Hospitality-enabled location.`); });
      const wanted = new Set(siteIds);
      const enable = spec.sites.mode === "remove" ? new Set<string>() : wanted;
      const disable = spec.sites.mode === "add" ? new Set<string>() : spec.sites.mode === "remove" ? wanted : new Set(children.offerings.filter(o => o.record.lifecycleState !== "archived" && !wanted.has(text(o.record.oplocId))).map(o => text(o.record.oplocId)));
      for (const oplocId of enable) {
        const existing = children.offerings.find(o => o.record.oplocId === oplocId && !o.record.operationalAreaId && o.record.offeringMode === "standard");
        if (children.offerings.some(o => o.record.oplocId === oplocId && o.record.lifecycleState !== "archived")) continue;
        if (existing) stage(ctx, "Hospitality Menu Offering", { ...bump(ctx, existing.record), lifecycleState: "active" }, existing, "Offering re-enabled by bulk operation.");
        else stage(ctx, "Hospitality Menu Offering", { ...base(ctx.actor, ctx.now), entityType: "Hospitality Menu Offering", canonicalId: generateCanonicalId("Hospitality Menu Offering"), hospitalityMenuItemId: itemId, oplocId, offeringMode: "standard" as const, lifecycleState: "active" as const }, undefined, "Offering created by bulk operation (inherits company defaults).");
        touchedSites.push(`+${oplocId}`); changed = true;
      }
      for (const oplocId of disable) for (const offering of children.offerings.filter(o => o.record.oplocId === oplocId && o.record.lifecycleState !== "archived")) {
        stage(ctx, "Hospitality Menu Offering", { ...bump(ctx, offering.record), lifecycleState: "archived" }, offering, "Offering disabled by bulk operation (overrides and history retained).");
        touchedSites.push(`-${oplocId}`); changed = true;
      }
      if (touchedSites.length) { before.sites = "see removed"; after.sites = touchedSites; }
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
  for (const itemId of ids) {
    try { results.push(await db.runTransaction(tx => bulkOne({ tx, actor, now: new Date().toISOString() }, itemId, spec))); }
    catch (error) { results.push({ itemId, status: "failed", message: (error as Error).message }); }
  }
  const succeeded = results.filter(result => result.status !== "failed").length, failed = results.length - succeeded;
  const kinds = [spec.production && "production", spec.price && "default price", spec.minimum && "default minimum", spec.sites && `sites:${spec.sites.mode}`, spec.archive && "archive"].filter(Boolean);
  await audit().doc(`bulk-${spec.operationId}`).set({ action: "Hospitality Catalogue bulk operation", entityReference: spec.operationId, actorId: actor.uid, actorName: actor.name, timestamp: new Date().toISOString(), reason: `${kinds.join(", ")} on ${ids.length} item${ids.length === 1 ? "" : "s"}: ${succeeded} succeeded, ${failed} failed.`, details: JSON.parse(JSON.stringify({ bulkOperationId: spec.operationId, operations: kinds, itemIds: ids, oplocIds: spec.sites?.oplocIds ?? [], succeeded, failed, results })) }, { merge: true });
  return { operationId: spec.operationId, results, succeeded, failed, message: failed ? `${succeeded} of ${results.length} items updated; ${failed} could not be changed.` : `${succeeded} item${succeeded === 1 ? "" : "s"} updated.` };
}
