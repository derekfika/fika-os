import crypto from "node:crypto";
import type { Actor } from "./auth";
import { generateCanonicalId } from "./canonical-identities";
import { stableDocumentId } from "./canonical-editor";
import { db } from "./firebase-admin";
import { sha256 } from "./profiler";
import { parseCanonical } from "./schemas";
import type { CanonicalRecord } from "./types";
import { listCanonicalRecordsByTypes } from "./canonical-oplocs";
import { existingCandidatesForNewItem } from "./hospitality-catalogue-canonicalisation";
import { buildCataloguePackage } from "./hospitality-catalogue-package";
import { resolveSiteCatalogue } from "./hospitality-effective-offering";

export const HOSPITALITY_PORTAL_READ_CONTRACT_VERSION = "fika.hospitality-menu-read.v3";
type MenuEntity = "Hospitality Menu Item" | "Hospitality Menu Offering" | "Hospitality Menu Price" | "Hospitality Brochure Import" | "Hospitality Brochure Candidate";
type OfferingMode = "standard" | "quote_only";
const canonical = () => db.collection("integrationHubCanonical");
const audit = () => db.collection("integrationHubGovernanceAudit");
const problem = (message: string) => Object.assign(new Error(message), { status: 422 });

function base(actor: Actor, entityType: MenuEntity, canonicalId: string, now: string) {
  return { schemaVersion: "0.1.0", version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid, active: true, externalIdentities: [], provenanceIds: [], ownership: { providerOwned: {}, fikaOwned: {} }, entityType, canonicalId };
}

function asCanonical(entityType: MenuEntity, record: Record<string, unknown>, state: "draft" | "published" = "draft"): CanonicalRecord {
  return { canonicalId: String(record.canonicalId), entityType, record, dataHash: sha256(JSON.stringify(record)), lifecycleStatus: state, ...(state === "published" ? { publicationStatus: "published", publishedAt: String(record.updatedAt) } : {}) };
}

function validate(entityType: MenuEntity, record: Record<string, unknown>) {
  const parsed = parseCanonical(entityType, record);
  if (!parsed.success) throw problem(`${entityType} validation failed: ${parsed.error.issues[0]?.message || "Review the values."}`);
}

function overlap(a: CanonicalRecord, b: Record<string, unknown>) {
  const aFrom = String(a.record.effectiveFrom), aTo = String(a.record.effectiveTo || "9999-12-31");
  const bFrom = String(b.effectiveFrom), bTo = String(b.effectiveTo || "9999-12-31");
  return aFrom <= bTo && bFrom <= aTo;
}

export type BrochureCandidateInput = { candidateId: string; proposedName?: string; proposedCategory?: string; proposedItemId?: string; oplocId?: string; operationalAreaId?: string; offeringMode?: OfferingMode; priceAmount?: number; vatRate?: number; effectiveFrom?: string; action: "save" | "ignore" | "publish"; ignoreReason?: string; /** Reviewer confirms this is a genuinely different product from every existing catalogue item with the same name. */ confirmDistinctItem?: boolean };

/** Applies only explicit reviewer choices; it never infers a mapping from brochure wording. */
export async function reviewBrochureCandidate(actor: Actor, input: BrochureCandidateInput) {
  const candidateRef = canonical().doc(stableDocumentId(input.candidateId));
  return db.runTransaction(async transaction => {
    const candidateSnap = await transaction.get(candidateRef);
    if (!candidateSnap.exists) throw problem("Brochure candidate was not found.");
    const candidate = candidateSnap.data() as CanonicalRecord;
    if (candidate.entityType !== "Hospitality Brochure Candidate") throw problem("This record is not a Hospitality Brochure Candidate.");
    const now = new Date().toISOString();
    const source = candidate.record;
    if (input.action === "ignore") {
      if (!input.ignoreReason?.trim()) throw problem("Give a short reason before ignoring source evidence.");
      const record = { ...source, version: Number(source.version) + 1, updatedAt: now, updatedBy: actor.uid, reviewState: "ignored", ignoreReason: input.ignoreReason.trim(), reviewedBy: actor.uid, reviewedAt: now };
      validate("Hospitality Brochure Candidate", record); const next = { ...candidate, record, dataHash: sha256(JSON.stringify(record)) };
      transaction.set(candidateRef, next); transaction.set(audit().doc(crypto.randomUUID()), { action: "Hospitality brochure candidate ignored", entityReference: candidate.canonicalId, actorId: actor.uid, actorName: actor.name, timestamp: now, reason: input.ignoreReason.trim() });
      return { candidate: next, records: [] as CanonicalRecord[] };
    }
    let itemId = input.proposedItemId || (source.proposedItemId ? String(source.proposedItemId) : "");
    const records: CanonicalRecord[] = [];
    if (!itemId) {
      if (!input.proposedName?.trim() || !input.proposedCategory?.trim()) throw problem("Choose an existing Menu Item, or provide the proposed item name and category.");
      // One canonical catalogue: a site brochure selects an existing item first. A new item is created only when nothing matches.
      const activeItems = (await transaction.get(canonical().where("entityType", "==", "Hospitality Menu Item"))).docs.map(document => document.data() as CanonicalRecord);
      const existing = existingCandidatesForNewItem(activeItems, { name: input.proposedName });
      if (existing.length && !input.confirmDistinctItem) throw problem(`A canonical Menu Item with this name already exists (${existing.join(", ")}). Select it as the existing item so this site offers it, rather than creating a duplicate.`);
      itemId = generateCanonicalId("Hospitality Menu Item");
      const itemRecord = { ...base(actor, "Hospitality Menu Item", itemId, now), name: input.proposedName.trim(), category: input.proposedCategory.trim(), lifecycleState: "active", dietaryInformation: [], allergenInformation: [], providerMappings: [{ provider: "hospitality-brochure", sourceItemId: candidate.canonicalId, sourceVersion: String(source.brochureImportId) }] };
      validate("Hospitality Menu Item", itemRecord); const item = asCanonical("Hospitality Menu Item", itemRecord, "draft"); transaction.create(canonical().doc(stableDocumentId(itemId)), item); records.push(item);
    } else {
      const item = await transaction.get(canonical().doc(stableDocumentId(itemId)));
      if (!item.exists || item.data()?.entityType !== "Hospitality Menu Item") throw problem("Select a valid existing Hospitality Menu Item.");
    }
    if (!input.oplocId || !input.offeringMode) {
      const record = { ...source, version: Number(source.version) + 1, updatedAt: now, updatedBy: actor.uid, proposedItemId: itemId, ...(input.proposedName ? { proposedName: input.proposedName.trim() } : {}), ...(input.proposedCategory ? { proposedCategory: input.proposedCategory.trim() } : {}), reviewState: "draft" };
      validate("Hospitality Brochure Candidate", record); const next = { ...candidate, record, dataHash: sha256(JSON.stringify(record)) }; transaction.set(candidateRef, next);
      return { candidate: next, records };
    }
    const offeringId = source.proposedOfferingId ? String(source.proposedOfferingId) : generateCanonicalId("Hospitality Menu Offering");
    const offeringRecord = { ...base(actor, "Hospitality Menu Offering", offeringId, now), hospitalityMenuItemId: itemId, oplocId: input.oplocId, ...(input.operationalAreaId ? { operationalAreaId: input.operationalAreaId } : {}), offeringMode: input.offeringMode, lifecycleState: "active" };
    validate("Hospitality Menu Offering", offeringRecord); const offering = asCanonical("Hospitality Menu Offering", offeringRecord, "draft");
    if (!source.proposedOfferingId) { transaction.create(canonical().doc(stableDocumentId(offeringId)), offering); records.push(offering); }
    if (input.offeringMode === "quote_only" && input.priceAmount !== undefined) throw problem("Quote-only Offerings cannot have a Hospitality Menu Price. Agree the price in the Booking or Quote snapshot.");
    if (input.offeringMode === "standard" && input.priceAmount !== undefined) {
      const priceId = generateCanonicalId("Hospitality Menu Price"); const priceRecord = { ...base(actor, "Hospitality Menu Price", priceId, now), hospitalityMenuOfferingId: offeringId, amount: input.priceAmount, currency: "GBP" as const, vatRate: input.vatRate ?? 0.2, effectiveFrom: input.effectiveFrom || now.slice(0, 10), lifecycleState: "active" };
      const existingPrices = (await transaction.get(canonical())).docs.map(document => document.data() as CanonicalRecord);
      assertNoOverlappingStandardPrice(existingPrices, asCanonical("Hospitality Menu Price", priceRecord));
      validate("Hospitality Menu Price", priceRecord); const price = asCanonical("Hospitality Menu Price", priceRecord, "draft"); transaction.create(canonical().doc(stableDocumentId(priceId)), price); records.push(price);
    }
    const candidateRecord = { ...source, version: Number(source.version) + 1, updatedAt: now, updatedBy: actor.uid, proposedItemId: itemId, proposedOfferingId: offeringId, oplocId: input.oplocId, ...(input.operationalAreaId ? { operationalAreaId: input.operationalAreaId } : {}), offeringMode: input.offeringMode, ...(input.priceAmount !== undefined ? { priceSignal: `£${input.priceAmount}` } : {}), reviewState: "reviewed", reviewedBy: actor.uid, reviewedAt: now, publishedRecordIds: [] as string[] };
    validate("Hospitality Brochure Candidate", candidateRecord); const nextCandidate = { ...candidate, record: candidateRecord, dataHash: sha256(JSON.stringify(candidateRecord)) };
    transaction.set(candidateRef, nextCandidate); transaction.set(audit().doc(crypto.randomUUID()), { action: "Hospitality brochure candidate reviewed", entityReference: candidate.canonicalId, actorId: actor.uid, actorName: actor.name, timestamp: now, reason: `Explicit item and offering decision: ${input.offeringMode}.` });
    return { candidate: nextCandidate, records };
  });
}

export async function publishBrochureCandidate(actor: Actor, candidateId: string) {
  const candidateRef = canonical().doc(stableDocumentId(candidateId));
  return db.runTransaction(async transaction => {
    const candidateSnap = await transaction.get(candidateRef); if (!candidateSnap.exists) throw problem("Brochure candidate was not found."); const candidate = candidateSnap.data() as CanonicalRecord; const candidateRecord = candidate.record;
    if (candidateRecord.reviewState !== "reviewed") throw problem("Review the candidate explicitly before publishing governed records.");
    const itemId = String(candidateRecord.proposedItemId || ""), offeringId = String(candidateRecord.proposedOfferingId || ""); if (!itemId || !offeringId) throw problem("A reviewed candidate needs both a Menu Item and scoped Offering before publication.");
    const [itemSnap, offeringSnap, allSnap] = await Promise.all([transaction.get(canonical().doc(stableDocumentId(itemId))), transaction.get(canonical().doc(stableDocumentId(offeringId))), transaction.get(canonical())]);
    if (!itemSnap.exists || !offeringSnap.exists) throw problem("The reviewed Menu Item or Offering is unavailable."); const item = itemSnap.data() as CanonicalRecord, offering = offeringSnap.data() as CanonicalRecord; const mode = String(offering.record.offeringMode) as OfferingMode;
    const prices = allSnap.docs.map(doc => doc.data() as CanonicalRecord).filter(record => record.entityType === "Hospitality Menu Price" && String(record.record.hospitalityMenuOfferingId) === offeringId && record.record.lifecycleState === "active");
    if (mode === "standard" && !prices.length) throw problem("A standard Offering requires an active effective-dated Menu Price before it can be published.");
    if (mode === "quote_only" && prices.length) throw problem("Quote-only Offerings cannot be published while a Menu Price exists. Archive the price or use a standard Offering.");
    const now = new Date().toISOString(); const next = [item, offering, ...prices].map(record => ({ ...record, lifecycleStatus: "published" as const, publicationStatus: "published" as const, publishedAt: now }));
    for (const record of next) transaction.set(canonical().doc(stableDocumentId(record.canonicalId)), record);
    const updatedCandidateRecord = { ...candidateRecord, version: Number(candidateRecord.version) + 1, updatedAt: now, updatedBy: actor.uid, publishedRecordIds: next.map(record => record.canonicalId) };
    validate("Hospitality Brochure Candidate", updatedCandidateRecord); const updatedCandidate = { ...candidate, record: updatedCandidateRecord, dataHash: sha256(JSON.stringify(updatedCandidateRecord)) }; transaction.set(candidateRef, updatedCandidate);
    transaction.set(audit().doc(crypto.randomUUID()), { action: "Hospitality catalogue records published", entityReference: candidateId, actorId: actor.uid, actorName: actor.name, timestamp: now, reason: `Published explicit ${mode} offering records only; source evidence remains unchanged.` });
    return { candidate: updatedCandidate, records: next };
  });
}

/** Publishes an explicitly selected reviewed import. Source evidence is never published. */
export async function publishReviewedBrochureImport(actor: Actor, brochureImportId: string) {
  const snapshot = await canonical().get();
  const candidates = snapshot.docs
    .map(document => document.data() as CanonicalRecord)
    .filter(record => record.entityType === "Hospitality Brochure Candidate" && record.record.brochureImportId === brochureImportId && record.record.reviewState === "reviewed" && !(Array.isArray(record.record.publishedRecordIds) && record.record.publishedRecordIds.length));
  if (!candidates.length) throw problem("This import has no reviewed records awaiting publication.");
  const records: CanonicalRecord[] = [];
  for (const candidate of candidates) records.push(...(await publishBrochureCandidate(actor, candidate.canonicalId)).records);
  return { brochureImportId, candidateCount: candidates.length, records };
}

export type HospitalityPortalReadRequest = { oplocId: string; operationalAreaId?: string; serviceDate: string; serviceContext?: string };
/**
 * Portal read = canonical records -> compact package -> the ONE effective-offering resolver. Every active Item is available at every
 * active OPLOC unless a sparse exception says otherwise. OPLOC liveness is enforced whenever OPLOC records are supplied (both
 * authoritative loaders supply them); a caller that supplies none (unit fixtures) is treated as asking about an active OPLOC.
 */
export function hospitalityPortalReadFromRecords(records: CanonicalRecord[], request: HospitalityPortalReadRequest) {
  const of = (type: string) => records.filter(record => record.entityType === type);
  const pkg = buildCataloguePackage({ items: of("Hospitality Menu Item"), offerings: of("Hospitality Menu Offering"), prices: of("Hospitality Menu Price"), oplocs: of("OPLOC"), routing: [] }, request.serviceDate);
  const catalogue = of("OPLOC").length ? pkg : { ...pkg, oplocs: [{ id: request.oplocId, label: request.oplocId }] };
  const offerings = resolveSiteCatalogue(catalogue, request.oplocId, { serviceDate: request.serviceDate, operationalAreaId: request.operationalAreaId }).map(offering => { const { source, ...rest } = offering; void source; return rest; });
  return { contractVersion: HOSPITALITY_PORTAL_READ_CONTRACT_VERSION, source: "canonical" as const, request: { ...request }, offerings };
}

export async function hospitalityPortalReadContract(request: HospitalityPortalReadRequest) {
  const records = await listCanonicalRecordsByTypes(["Hospitality Menu Item", "Hospitality Menu Offering", "Hospitality Menu Price", "OPLOC"]); return hospitalityPortalReadFromRecords(records as CanonicalRecord[], request);
}

export function assertNoPriceForQuoteOnly(offering: CanonicalRecord, price: CanonicalRecord) {
  if (offering.record.offeringMode === "quote_only" && price.record.hospitalityMenuOfferingId === offering.canonicalId) throw problem("Quote-only Offerings reject Menu Price records.");
}

export function assertNoOverlappingStandardPrice(existing: CanonicalRecord[], proposed: CanonicalRecord) {
  for (const record of existing) if (record.entityType === "Hospitality Menu Price" && record.record.hospitalityMenuOfferingId === proposed.record.hospitalityMenuOfferingId && record.record.lifecycleState === "active" && overlap(record, proposed.record)) throw problem("This standard Offering already has an overlapping active price. End/archive the earlier price through a controlled replacement first.");
}
