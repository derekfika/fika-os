import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { CANONICAL_ALLERGEN_KEYS } from "../../shared/allergen-contract";
import {
  matchesStudioDishRelease, matchesStudioDishSignatureEvent, sameStudioDishReviewSubject,
  studioDishReleaseVersion, studioDishReviewKey, studioDishReviewRecords, studioDishReviewRequests, studioDishReviewSubject, studioDishSafetyFences,
  studioDishSignatureRoles, validStudioDishSafetyFence, type StudioDishReleaseHeader, type StudioDishReleaseSignature,
  type StudioDishReviewRequest, type StudioDishReviewSubject, type StudioDishSafetyFence,
} from "../../shared/hospitality-menu-studio-safety";
import { explicitReviewMatches, PENDING_DECLARATION } from "../app/lib/allergen-explicit";
import { stampAllergenReviews } from "../app/lib/allergen-review-stamp";
import { BLOCKED_ROW_MESSAGES, confirmAllergenReviewMap } from "../app/lib/allergen-review-state";
import type { PlannedMenuItem } from "../app/lib/production-plan";
import { allergenReviewProblems, isProductionPlanMatrixComplete } from "../app/lib/production-plan-state";
import { allergenMatrixContentHash } from "./cpu-allergen-release";

const roles = studioDishSignatureRoles;
export const studioDishId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/);
export const studioDishRevision = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const version = { expectedVersion: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1), commandId: z.uuid(), sourceHash: digest };
const png = z.string().max(250_000).regex(/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]+={0,2}$/);
export const studioDishReviewCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check-row"), ...version, rowId: studioDishId,
    allergens: z.partialRecord(z.enum(CANONICAL_ALLERGEN_KEYS).exclude(["no_key_allergens"]), z.enum(["contains", "may_contain"])),
    noKeyAllergens: z.boolean(), mayContainNotes: z.string().trim().max(2000), allergenDetailNotes: z.string().trim().max(2000),
  }).strict(),
  z.object({ action: z.literal("sign"), ...version, matrixHash: digest, role: z.enum(roles),
    printedName: z.string().trim().min(2).max(120), signatureDataUrl: png, attested: z.literal(true),
  }).strict(),
  z.object({ action: z.literal("reopen"), ...version, reason: z.string().trim().min(3).max(1000) }).strict(),
]);

export type StudioDishReviewCommand = z.infer<typeof studioDishReviewCommand>;
export type StudioDishReviewRole = (typeof roles)[number];
type Signature = StudioDishReleaseSignature;
type ReviewState = { version: number; menuItems: PlannedMenuItem[]; signatures: Signature[]; lastReleaseVersion: number };
type AuditEvent = { commandHash: string; actorId: string; at: string; version: number; action: string };

export const studioDishReviewSubjectSchema = z.strictObject({ dishId: studioDishId, revision: studioDishRevision, sourceHash: digest });
export const studioDishReviewRequestSchema = z.object({
  contract: z.literal("hospitality-menu-studio.dish-review-request.v1"),
  subject: studioDishReviewSubjectSchema,
  dish: z.object({
    id: studioDishId, version: studioDishRevision, name: z.string().trim().min(1).max(200), category: z.string().min(1),
    temperature: z.enum(["hot", "cold"]).nullable(), customerDescription: z.string().max(4000), kitchenDescription: z.string().trim().min(1).max(12000),
    assortment: z.object({ expectedTotal: z.number().int().positive(), unit: z.string().trim().min(1).max(48), components: z.array(z.object({
      id: studioDishId, name: z.string().trim().min(1).max(200), quantity: z.number().int().positive(),
    })).min(1) }).nullable(),
  }), requestedAt: z.iso.datetime(), requestedBy: z.string().min(1),
});

export class StudioDishReviewStore {
  constructor(private readonly db: Firestore, private readonly now = () => new Date()) {}

  async register(request: StudioDishReviewRequest) {
    const { dishId, revision } = request.subject;
    const incoming = reviewSource(request, dishId, revision);
    const refs = this.refs(dishId, revision);
    return this.db.runTransaction(async transaction => {
      const existing = await transaction.get(refs.source);
      if (!existing.exists) transaction.create(refs.source, incoming);
      else if (!sameStudioDishReviewSubject(reviewSource(existing.data(), dishId, revision).subject, incoming.subject)) {
        throw reviewProblem(409, "CPU_STUDIO_SOURCE_CONFLICT", "A different source is already registered for this dish revision.");
      }
      return { subject: incoming.subject };
    });
  }

  async readiness(subject: StudioDishReviewSubject) {
    const refs = this.refs(subject.dishId, subject.revision);
    return this.db.runTransaction(async transaction => {
      const [source, current] = await transaction.getAll(refs.source, refs.fence);
      if (!source.exists) {
        if (current.exists) throw integrityProblem();
        return { subject, status: "unverified" as const };
      }
      const request = reviewSource(source.data(), subject.dishId, subject.revision);
      if (!sameStudioDishReviewSubject(request.subject, subject)) throw integrityProblem();
      const fence = decodeFence(current.data(), request);
      if (!fence) return { subject, status: "in_review" as const };
      const { contract, status, releaseId, matrixHash, changedAt } = fence;
      const publicFence: StudioDishSafetyFence = { contract, subject, status, releaseId, matrixHash, changedAt };
      if (status === "revoked") return { subject, status: "revoked" as const, fence: publicFence };
      const releaseRef = refs.head.collection("releases").doc(studioDishReleaseVersion(fence));
      const [savedRelease] = await transaction.getAll(releaseRef, {
        fieldMask: ["contract", "subject", "status", "releaseId", "matrixHash", "changedAt", "signatures"],
      });
      const release = savedRelease.data() as StudioDishReleaseHeader | undefined;
      if (!release || !matchesStudioDishRelease(release, fence)) throw integrityProblem();
      const events = await transaction.getAll(...release.signatures.map(signature => refs.head.collection("events").doc(signature.eventId)), {
        fieldMask: ["action", "source", "role", "actorId", "eventId", "signedAt", "matrixHash", "sourceHash", "signatureHash", "signatureDataUrl"],
      });
      if (!release.signatures.every((signature, index) => {
        const event = events[index].data() as (NonNullable<Parameters<typeof matchesStudioDishSignatureEvent>[0]> & { signatureDataUrl?: string }) | undefined;
        const image = png.safeParse(event?.signatureDataUrl);
        return matchesStudioDishSignatureEvent(event, signature) && image.success && sha256(image.data) === signature.signatureHash;
      })) throw integrityProblem();
      return { subject, status: "verified" as const, fence: publicFence };
    }, { readOnly: true });
  }

  async read(dishId: string, revision: number) {
    const refs = this.refs(dishId, revision);
    return this.db.runTransaction(async transaction => {
      const [source, head, fence] = await transaction.getAll(refs.source, refs.head, refs.fence);
      const request = reviewSource(source.data(), dishId, revision);
      return reviewView(request, decodeState(head.data(), request), decodeFence(fence.data(), request));
    }, { readOnly: true });
  }

  async apply(dishId: string, revision: number, actorId: string, command: StudioDishReviewCommand) {
    const refs = this.refs(dishId, revision);
    const eventRef = refs.head.collection("events").doc(command.commandId);
    const commandHash = sha256(command);
    return this.db.runTransaction(async transaction => {
      const [source, head, fenceDoc, priorEvent] = await transaction.getAll(refs.source, refs.head, refs.fence, eventRef);
      const request = reviewSource(source.data(), dishId, revision);
      const state = decodeState(head.data(), request);
      let fence = decodeFence(fenceDoc.data(), request);
      if (priorEvent.exists) {
        const event = priorEvent.data() as AuditEvent;
        if (event.commandHash !== commandHash || event.actorId !== actorId) throw reviewProblem(409, "CPU_STUDIO_REVIEW_REPLAY_CONFLICT", "This request ID was already used.");
        return reviewView(request, state, fence);
      }
      if (command.expectedVersion !== state.version || command.sourceHash !== request.subject.sourceHash) {
        throw reviewProblem(409, "CPU_STUDIO_REVIEW_CONFLICT", "The allergen review changed. Reload the current record before continuing.");
      }
      const at = this.now().toISOString();
      const event = { commandHash, actorId, at, subject: request.subject, version: state.version + 1, action: command.action, source: "cpu-production" };
      const next = { ...state, version: event.version };

      if (command.action === "check-row") {
        if (state.signatures.length || fence?.status === "current") throw reviewProblem(409, "CPU_STUDIO_REVIEW_LOCKED", "Reopen the signed review before changing allergen evidence.");
        next.menuItems = checkRow(state, command, actorId, at);
        transaction.create(eventRef, { ...event, rowId: command.rowId, matrixHash: allergenMatrixContentHash(next.menuItems) });
      } else if (command.action === "sign") {
        const matrixHash = allergenMatrixContentHash(state.menuItems);
        if (command.matrixHash !== matrixHash) throw reviewProblem(409, "CPU_STUDIO_MATRIX_CONFLICT", "The reviewed matrix changed. Reload it before signing.");
        if (!checked(state.menuItems)) throw reviewProblem(422, "CPU_STUDIO_REVIEW_INCOMPLETE", "Check every row in the allergen matrix before signing.");
        if (state.signatures.some(signature => signature.role === command.role || signature.actorId === actorId)) {
          throw reviewProblem(409, "CPU_STUDIO_SIGNATURE_CONFLICT", "Each signature role requires a different authorised person.");
        }
        const signature: Signature = { role: command.role, actorId, eventId: command.commandId, signedAt: at, matrixHash,
          sourceHash: request.subject.sourceHash, signatureHash: sha256(command.signatureDataUrl) };
        next.signatures = [...state.signatures, signature];
        transaction.create(eventRef, { ...event, ...signature, printedName: command.printedName, signatureDataUrl: command.signatureDataUrl,
          attestation: "I confirm this matrix is accurate." });
        if (next.signatures.length === roles.length) {
          next.lastReleaseVersion++;
          const releaseId = `cpu-studio-dish-release:${refs.head.id}:v${next.lastReleaseVersion}`;
          fence = { contract: "cpu-production.studio-dish-safety.v1", subject: request.subject, status: "current", releaseId, matrixHash, changedAt: at };
          transaction.create(refs.head.collection("releases").doc(String(next.lastReleaseVersion)), {
            ...fence, matrix: next.menuItems, signatures: next.signatures, publishedBy: actorId, source: "cpu-production",
          });
          transaction.set(refs.fence, fence);
        }
      } else {
        if (!state.signatures.length) throw reviewProblem(409, "CPU_STUDIO_REVIEW_NOT_SIGNED", "This review has no signatures to reopen.");
        if (fence?.status === "current") {
          fence = { ...fence, status: "revoked", changedAt: at };
          transaction.set(refs.fence, fence);
        }
        next.signatures = [];
        next.menuItems = initialItems(request);
        transaction.create(eventRef, { ...event, reason: command.reason, invalidatedSignatureEvents: state.signatures.map(signature => signature.eventId),
          ...(fence ? { releaseId: fence.releaseId } : {}) });
      }
      if (Buffer.byteLength(JSON.stringify(next)) > 600_000) throw reviewProblem(413, "CPU_STUDIO_MATRIX_TOO_LARGE", "This allergen matrix exceeds the storage limit.");
      transaction.set(refs.head, { ...next, subject: request.subject });
      return reviewView(request, next, fence);
    });
  }

  private refs(dishId: string, revision: number) {
    const key = studioDishReviewKey(dishId, revision);
    return { source: this.db.collection(studioDishReviewRequests).doc(key), head: this.db.collection(studioDishReviewRecords).doc(key),
      fence: this.db.collection(studioDishSafetyFences).doc(key) };
  }
}

export type StudioDishReviewView = ReturnType<typeof reviewView>;

function reviewSource(value: unknown, dishId: string, revision: number): StudioDishReviewRequest {
  if (!value) throw reviewProblem(404, "CPU_STUDIO_REVIEW_MISSING", "This Studio dish revision has not been sent to the allergen checker.");
  const parsed = studioDishReviewRequestSchema.safeParse(value);
  if (!parsed.success || !sameStudioDishReviewSubject(parsed.data.subject, studioDishReviewSubject(parsed.data.dish))
    || parsed.data.subject.dishId !== dishId || parsed.data.subject.revision !== revision) throw integrityProblem();
  const assortment = parsed.data.dish.assortment;
  if (assortment && (new Set(assortment.components.map(row => row.id)).size !== assortment.components.length
    || assortment.components.reduce((sum, row) => sum + row.quantity, 0) !== assortment.expectedTotal)) throw integrityProblem();
  return parsed.data;
}

function initialItems({ dish }: StudioDishReviewRequest): PlannedMenuItem[] {
  const rows = dish.assortment?.components ?? [{ id: dish.id, name: dish.name, quantity: null }];
  return [{ id: dish.id, name: dish.name, note: "", subItems: rows.map(row => ({ ...row, allergens: {}, note: "", evidenceStatus: "not_completed" })) }];
}

function decodeState(raw: unknown, request: StudioDishReviewRequest): ReviewState {
  if (!raw) return { version: 0, signatures: [], lastReleaseVersion: 0, menuItems: initialItems(request) };
  const state = raw as ReviewState & { subject: StudioDishReviewRequest["subject"] };
  if (!sameStudioDishReviewSubject(state.subject, request.subject) || !Number.isSafeInteger(state.version) || state.version < 1
    || !Number.isSafeInteger(state.lastReleaseVersion) || state.lastReleaseVersion < 0 || !Array.isArray(state.menuItems) || !Array.isArray(state.signatures)) throw integrityProblem();
  const [item] = state.menuItems;
  const [original] = initialItems(request);
  if (state.menuItems.length !== 1 || item?.id !== original.id || item.name !== original.name || !Array.isArray(item.subItems)
    || item.subItems.length !== original.subItems.length || item.subItems.some((row, index) => {
      const expected = original.subItems[index];
      return row.id !== expected.id || row.name !== expected.name || row.quantity !== expected.quantity;
    })) throw integrityProblem();
  const matrixHash = allergenMatrixContentHash(state.menuItems);
  if (state.signatures.length > roles.length || new Set(state.signatures.map(row => row.role)).size !== state.signatures.length
    || new Set(state.signatures.map(row => row.actorId)).size !== state.signatures.length || state.signatures.some(signature =>
      !roles.includes(signature.role) || !signature.actorId || signature.matrixHash !== matrixHash || signature.sourceHash !== request.subject.sourceHash)) throw integrityProblem();
  return state;
}

function decodeFence(raw: unknown, request: StudioDishReviewRequest) {
  if (!raw) return undefined;
  const fence = raw as StudioDishSafetyFence;
  if (!validStudioDishSafetyFence(fence, request.subject)) throw integrityProblem();
  return fence;
}

function checkRow(state: ReviewState, command: Extract<StudioDishReviewCommand, { action: "check-row" }>, actor: string, at: string) {
  const [item] = state.menuItems;
  if (!item.subItems.some(row => row.id === command.rowId)) throw reviewProblem(422, "CPU_STUDIO_ROW_MISSING", "This row does not belong to the saved Studio revision.");
  const allergens = command.noKeyAllergens ? { ...command.allergens, no_key_allergens: "contains" as const } : command.allergens;
  const confirmation = confirmAllergenReviewMap(allergens, command.noKeyAllergens ? { declaration: PENDING_DECLARATION } : {});
  if (!confirmation.complete) throw reviewProblem(422, "CPU_STUDIO_ALLERGENS_UNRECORDED", confirmation.blocked ? BLOCKED_ROW_MESSAGES[confirmation.blocked] : "Finish checking the allergens before saving.");
  const candidate = { ...item, subItems: item.subItems.filter(row => row.id === command.rowId).map(row => ({
    id: row.id, name: row.name, quantity: row.quantity, note: "", evidenceStatus: "completed" as const, allergens: confirmation.states,
    mayContainNotes: command.mayContainNotes, allergenDetailNotes: command.allergenDetailNotes,
    ...(command.noKeyAllergens ? { noKeyDeclaration: { declared: true as const } } : {}),
  })) };
  const [stamped] = stampAllergenReviews(state.menuItems, [candidate], actor, at);
  return [{ ...item, subItems: item.subItems.map(row => row.id === command.rowId ? stamped.subItems[0] : row) }];
}

function checked(items: PlannedMenuItem[]) {
  return isProductionPlanMatrixComplete(items) && allergenReviewProblems(items).length === 0
    && items.every(item => item.subItems.every(row => explicitReviewMatches({ ...row, identity: row.name })));
}

function reviewView(request: StudioDishReviewRequest, state: ReviewState, fence?: StudioDishSafetyFence) {
  const matrixHash = allergenMatrixContentHash(state.menuItems);
  if ((fence?.status === "current") !== (state.signatures.length === roles.length)
    || (fence?.status === "current" && (fence.matrixHash !== matrixHash || !checked(state.menuItems)))) throw integrityProblem();
  if (fence?.releaseId && !fence.releaseId.endsWith(`:v${state.lastReleaseVersion}`)) throw integrityProblem();
  const { id, version, name, kitchenDescription, assortment } = request.dish;
  return { subject: request.subject, dish: { id, version, name, kitchenDescription, assortment }, version: state.version,
    menuItems: state.menuItems, signatures: state.signatures.map(({ role, signedAt }) => ({ role, signedAt })),
    matrixHash, checked: checked(state.menuItems), status: fence?.status ?? "in_review" };
}

function sha256(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function integrityProblem() { return reviewProblem(503, "CPU_STUDIO_REVIEW_INTEGRITY", "The saved allergen review could not be verified."); }
function reviewProblem(status: number, code: string, message: string) { return Object.assign(new Error(message), { status, code }); }
