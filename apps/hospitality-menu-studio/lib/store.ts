import { getApps, initializeApp } from "firebase-admin/app";
import { FieldPath, getFirestore, type DocumentReference, type Firestore, type Transaction } from "firebase-admin/firestore";
import { isDeepStrictEqual } from "node:util";
import type { CatalogueLoadResult } from "@fika/server-shared/hospitality-catalogue-client";
import {
  matchesStudioDishRelease, matchesStudioDishSignatureEvent, sameStudioDishReviewSubject, studioDishReleaseVersion, studioDishReviewKey, studioDishReviewRecords,
  studioDishReviewRequests, studioDishReviewSubject, studioDishSafetyFences, validStudioDishSafetyFence,
  type StudioDishReleaseHeader, type StudioDishReviewRequest, type StudioDishSafetyFence, type StudioDishSafetyStatus,
} from "../../shared/hospitality-menu-studio-safety";
import { londonDate, type Dish, type DraftVersion, type Menu, type Publication, type Review, type Section, type StudioActor } from "./contract";
import { StudioProblem } from "./problem";
import { canonicalJson, decodeLocalPublicationPackage, publicationHash, publicationImpactScope, reviewPublication, sameReviewToken,
  type DishSafety, type PublicationImpactTarget, type PublicationRequest, type SeasonWindow } from "./publication";
import { studioRuntime } from "./runtime";
import { dishSchema, menuSchema } from "./schema";
import { assortmentIsComplete, menuDishIds } from "./review";

const root = "fikaHospitalityMenuStudioV1";
const pageSize = 50;
type Draft = Menu | Dish;
type DraftData<T extends Draft> = {
  item: T;
  actorId: string;
  baseVersion: number;
  source: "hospitality-menu-studio";
  restoredFromVersion?: number;
};
type StoredSection = Omit<Section, "weeks"> & { weeks: { dishIds: string[] }[] };
type StoredMenu = Omit<Menu, "sections"> & { sections: StoredSection[] };
type StoredDraft = Omit<DraftData<Draft>, "item"> & { item: StoredMenu | Dish };
type DraftCollection = "menus" | "dishes";
export type Page<T> = { items: T[]; nextCursor: string | null };
type ReviewInputs = { actor: StudioActor; catalogue?: CatalogueLoadResult; impact: Review["impact"]; impactTarget?: PublicationImpactTarget };
type PublishCommand = PublicationRequest & { reviewToken: string; confirmed: true };

export class StudioStore {
  constructor(private db: Firestore, private now = () => new Date()) {}

  async list<T extends Draft>(kind: DraftCollection, cursor?: string): Promise<Page<T>> {
    const snapshot = await this.page(this.db.collection(`${root}_${kind}`), cursor);
    return {
      items: snapshot.docs.slice(0, pageSize).map(document => decodeDraft<T>(document.data() as StoredDraft).item),
      nextCursor: snapshot.docs.length > pageSize ? snapshot.docs[pageSize - 1].id : null,
    };
  }

  async listHistory(menuId: string, cursor?: string): Promise<Page<Publication>> {
    const history = this.db.collection(`${root}_menus`).doc(menuId).collection("publications");
    let query = history.orderBy("revision", "desc").limit(pageSize + 1);
    if (cursor) {
      const last = await history.doc(cursor).get();
      if (!last.exists) throw new StudioProblem(422, "INVALID_CURSOR", "This history page is unavailable.");
      query = query.startAfter(last);
    }
    const snapshot = await query.get();
    return {
      items: snapshot.docs.slice(0, pageSize).map(document => document.data() as Publication),
      nextCursor: snapshot.docs.length > pageSize ? snapshot.docs[pageSize - 1].id : null,
    };
  }

  async reviewPublication(request: PublicationRequest, inputs: ReviewInputs) {
    return this.db.runTransaction(async transaction => (await this.publicationCandidate(transaction, request, inputs)).review, { readOnly: true });
  }

  async publicationImpactTarget(request: PublicationRequest) {
    const head = this.draftHead("menus", request.menuId);
    return this.db.runTransaction(async transaction => {
      const [draft, latest] = await transaction.getAll(head, head.collection("publicationState").doc("head"));
      const stored = draft.data() as StoredDraft | undefined;
      if (!stored || stored.item.version !== request.version) throw conflict();
      const menu = archivedMenu(stored, request.menuId, request.version);
      const previous = latest.data() as Publication | undefined;
      const previousPackage = previous ? await this.readPublicationPackage(transaction, head, previous) : undefined;
      return publicationImpactScope(request, menu, previousPackage);
    }, { readOnly: true });
  }

  async publishedReceipt(request: PublishCommand, actorId: string): Promise<Publication | undefined> {
    return this.db.runTransaction(transaction => this.readPublicationReceipt(transaction, request, actorId), { readOnly: true });
  }

  async publishReviewed(request: PublishCommand, inputs: ReviewInputs): Promise<Publication> {
    if (!inputs.actor.canPublish || request.confirmed !== true) throw new StudioProblem(403, "STUDIO_WRITE_DENIED", "Publication requires explicit authorisation and confirmation.");
    const receipt = this.receipt(request, inputs.actor.id);
    return this.db.runTransaction(async transaction => {
      const existing = await this.readPublicationReceipt(transaction, request, inputs.actor.id);
      if (existing) return existing;
      const candidate = await this.publicationCandidate(transaction, request, inputs);
      if (!candidate.package || !sameReviewToken(request.reviewToken, candidate.review.reviewToken)) {
        throw new StudioProblem(409, "PUBLICATION_REVIEW_CHANGED", "The draft or its publication evidence changed. Review the publication again.");
      }
      const { payload, body, contentHash } = candidate.package;
      const publication: Publication = { id: payload.publicationId, menuId: payload.menu.id, menuName: payload.menu.name,
        revision: payload.publicationRevision, effectiveDate: payload.effectiveDate, publishedAt: this.now().toISOString(),
        publishedBy: inputs.actor.id, scope: {}, sourceDraftVersion: payload.sourceDraftVersion, contentHash };
      const menuHead = this.draftHead("menus", request.menuId);
      transaction.create(menuHead.collection("publications").doc(publication.id), publication);
      transaction.create(menuHead.collection("publicationPackages").doc(publication.id), { body, contentHash, contract: payload.contract });
      transaction.set(menuHead.collection("publicationState").doc("head"), publication);
      if (payload.menu.kind === "seasonal" && !candidate.seasons.some(season => season.menuId === payload.menu.id)) {
        transaction.set(this.seasonSchedule(), { seasons: [...candidate.seasons, { menuId: payload.menu.id, startDate: payload.menu.startDate, endDate: payload.menu.endDate }] });
      }
      const { impact } = candidate.review;
      transaction.create(menuHead.collection("publicationOutbox").doc(publication.id), {
        action: "studio-content-published", source: "hospitality-menu-studio", actorId: inputs.actor.id, at: publication.publishedAt,
        publicationId: publication.id, menuId: publication.menuId, revision: publication.revision, effectiveDate: publication.effectiveDate,
        sourceDraftVersion: payload.sourceDraftVersion, previousPublicationId: payload.previousPublicationId, contentHash,
        status: "pending", delivery: "hub-activation", commandId: receipt.id, reviewToken: request.reviewToken,
        impact: { status: impact.status, hash: publicationHash(canonicalJson(impact)), ...(impact.status === "available" ? { bookingCount: impact.bookings.length } : {}) },
      });
      transaction.create(receipt, { actorId: inputs.actor.id, publication });
      return publication;
    });
  }

  private seasonSchedule() { return this.db.collection(`${root}_schedules`).doc("company"); }

  private receipt(request: PublishCommand, actorId: string) {
    const { menuId, version, effectiveDate, scope, reviewToken, confirmed } = request;
    const id = publicationHash(canonicalJson([actorId, menuId, version, effectiveDate, scope, reviewToken, confirmed]));
    return this.draftHead("menus", menuId).collection("publicationReceipts").doc(id);
  }

  private async readPublicationReceipt(transaction: Transaction, request: PublishCommand, actorId: string) {
    const existing = (await transaction.get(this.receipt(request, actorId))).data();
    if (!existing) return undefined;
    const publication = existing.publication as Publication;
    if (existing.actorId !== actorId || publication?.menuId !== request.menuId || publication.sourceDraftVersion !== request.version
      || publication.effectiveDate !== request.effectiveDate || publication.publishedBy !== actorId) throw publicationIntegrity();
    await this.readPublicationPackage(transaction, this.draftHead("menus", request.menuId), publication);
    return publication;
  }

  private async publicationCandidate(transaction: Transaction, request: PublicationRequest, inputs: ReviewInputs) {
    const head = this.draftHead("menus", request.menuId);
    const [current, archived, latest, schedule] = await transaction.getAll(head, head.collection("revisions").doc(String(request.version)),
      head.collection("publicationState").doc("head"), this.seasonSchedule());
    const stored = current.data() as StoredDraft | undefined;
    if (!stored || stored.item.version !== request.version) throw conflict();
    const menu = archivedMenu(archived.data() as StoredDraft | undefined, request.menuId, request.version);
    if (!isDeepStrictEqual(menu, menuSchema.parse(decodeDraft<Menu>(stored).item))) throw publicationIntegrity();
    const previous = latest.data() as Publication | undefined;
    const previousPackage = previous ? await this.readPublicationPackage(transaction, head, previous) : undefined;
    const target = publicationImpactScope(request, menu, previousPackage);
    const impact: Review["impact"] = isDeepStrictEqual(target, inputs.impactTarget) ? inputs.impact : { status: "unavailable" };
    const seasons = schedule.data()?.seasons as SeasonWindow[] | undefined ?? [];
    if (!Array.isArray(seasons) || seasons.some(season => !season.menuId || !season.startDate || !season.endDate || season.startDate > season.endDate)) {
      throw publicationIntegrity();
    }
    const dishes = await this.readPublicationDishes(transaction, menuDishIds(menu));
    const safety = new Map<string, DishSafety>();
    for (let start = 0; start < dishes.length; start += 50) {
      for (const [id, status] of await this.readDishSafetyBatch(transaction, dishes.slice(start, start + 50))) safety.set(id, status);
    }
    return { ...reviewPublication({ request, menu, dishes, today: londonDate(this.now()), actorId: inputs.actor.id, canPublish: inputs.actor.canPublish,
      catalogue: inputs.catalogue, impact, safety, previous, previousPackage, seasons }), seasons };
  }

  private async readPublicationDishes(transaction: Transaction, ids: string[]) {
    const dishes: Dish[] = [];
    for (let start = 0; start < ids.length; start += 50) {
      const records = await transaction.getAll(...ids.slice(start, start + 50).map(id => this.draftHead("dishes", id)));
      const drafts = records.filter(record => record.exists).map(record => {
        const dish = dishSchema.safeParse(record.data()!.item);
        if (!dish.success || dish.data.id !== record.id || dish.data.version < 1) throw publicationIntegrity();
        return { dish: dish.data, revision: record.ref.collection("revisions").doc(String(dish.data.version)) };
      });
      if (!drafts.length) continue;
      const revisions = await transaction.getAll(...drafts.map(draft => draft.revision));
      for (const [index, { dish }] of drafts.entries()) {
        const archived = dishSchema.safeParse(revisions[index].data()?.item);
        if (!archived.success || !isDeepStrictEqual(archived.data, dish)) throw publicationIntegrity();
        dishes.push(archived.data);
      }
    }
    return dishes;
  }

  private async readPublicationPackage(transaction: Transaction, head: DocumentReference, publication: Publication) {
    const snapshot = await transaction.get(head.collection("publicationPackages").doc(publication.id));
    const data = snapshot.data();
    if (!data || data.contract !== "hospitality-menu-studio.publication.v1" || typeof data.body !== "string"
      || data.contentHash !== publication.contentHash || publication.menuId !== head.id) {
      throw publicationIntegrity();
    }
    const payload = decodeLocalPublicationPackage(data.body, publication);
    if (!payload) throw publicationIntegrity();
    return payload;
  }

  async listVersions(kind: DraftCollection, id: string, cursor?: number): Promise<Page<DraftVersion>> {
    const versions = this.draftHead(kind, id).collection("revisions");
    let query = versions.orderBy("item.version", "desc").limit(pageSize + 1);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    const items = snapshot.docs.slice(0, pageSize).map(document => {
      const { item, actorId, restoredFromVersion } = document.data() as StoredDraft;
      return {
        version: item.version, savedAt: item.updatedAt, actorId,
        ...(restoredFromVersion === undefined ? {} : { restoredFromVersion }),
      };
    });
    return { items, nextCursor: snapshot.docs.length > pageSize ? String(items.at(-1)?.version) : null };
  }

  async readMenuRevision(menuId: string, version: number): Promise<Menu> {
    const document = await this.draftHead("menus", menuId).collection("revisions").doc(String(version)).get();
    return archivedMenu(document.data() as StoredDraft | undefined, menuId, version);
  }

  async read<T extends Draft>(kind: DraftCollection, id: string): Promise<T> {
    const document = await this.draftHead(kind, id).get();
    if (!document.exists) throw new StudioProblem(404, "DRAFT_NOT_FOUND", "This draft could not be found.");
    return decodeDraft<T>(document.data() as StoredDraft).item;
  }

  async dishes(ids: string[]): Promise<Dish[]> {
    const dishes: Dish[] = [];
    const collection = this.db.collection(`${root}_dishes`);
    for (let offset = 0; offset < ids.length; offset += 100) {
      const documents = await this.db.getAll(...ids.slice(offset, offset + 100).map(id => collection.doc(id)));
      for (const document of documents) if (document.exists) dishes.push(decodeDraft<Dish>(document.data() as StoredDraft).item);
    }
    return dishes;
  }

  async requestDishReview(dishId: string, version: number, actorId: string) {
    const head = this.draftHead("dishes", dishId);
    const key = studioDishReviewKey(dishId, version);
    const requestRef = this.db.collection(studioDishReviewRequests).doc(key);
    return this.db.runTransaction(async transaction => {
      const [current, revision, existing] = await transaction.getAll(head, head.collection("revisions").doc(String(version)), requestRef);
      const draft = dishSchema.safeParse(current.data()?.item);
      if (!draft.success || draft.data.id !== dishId || draft.data.version !== version) throw conflict();
      const archived = dishSchema.safeParse(revision.data()?.item);
      if (!archived.success || !isDeepStrictEqual(archived.data, draft.data)) {
        throw new StudioProblem(503, "DRAFT_REVISION_INTEGRITY", "The saved dish revision could not be verified.");
      }
      const dish = archived.data;
      if (!dish.name || !dish.kitchenDescription || !assortmentIsComplete(dish)) {
        throw new StudioProblem(422, "DISH_REVIEW_INCOMPLETE", "Add a dish name, kitchen description and complete fixed assortment before requesting review.");
      }
      const subject = studioDishReviewSubject(dish);
      if (existing.exists) {
        const saved = existing.data() as StudioDishReviewRequest;
        if (saved.contract !== "hospitality-menu-studio.dish-review-request.v1" || !sameStudioDishReviewSubject(saved.subject, subject)) {
          throw new StudioProblem(503, "DISH_REVIEW_INTEGRITY", "The checker request could not be verified.");
        }
      } else {
        transaction.create(requestRef, {
          contract: "hospitality-menu-studio.dish-review-request.v1", subject, dish,
          requestedBy: actorId, requestedAt: this.now().toISOString(),
        } satisfies StudioDishReviewRequest);
      }
      return subject;
    });
  }

  async dishSafety(dishes: Dish[]) {
    const result = new Map<string, { status: StudioDishSafetyStatus; fence?: StudioDishSafetyFence }>();
    for (let offset = 0; offset < dishes.length; offset += 50) {
      const batch = dishes.slice(offset, offset + 50);
      const states = await this.db.runTransaction(transaction => this.readDishSafetyBatch(transaction, batch), { readOnly: true });
      for (const [id, state] of states) result.set(id, state);
    }
    return result;
  }

  private async readDishSafetyBatch(transaction: Transaction, dishes: Dish[]) {
    const subjects = dishes.map(studioDishReviewSubject);
    const refs = subjects.flatMap(subject => {
      const key = studioDishReviewKey(subject.dishId, subject.revision);
      return [this.db.collection(studioDishReviewRequests).doc(key), this.db.collection(studioDishSafetyFences).doc(key)];
    });
    const records = await transaction.getAll(...refs, { fieldMask: ["contract", "subject", "status", "releaseId", "matrixHash", "changedAt"] });
    const states = new Map<string, { status: StudioDishSafetyStatus; fence?: StudioDishSafetyFence }>();
    const active: { dishId: string; fence: StudioDishSafetyFence; head: DocumentReference }[] = [];
    for (const [index, subject] of subjects.entries()) {
      const request = records[index * 2].data() as StudioDishReviewRequest | undefined;
      const fence = records[index * 2 + 1].data() as StudioDishSafetyFence | undefined;
      if (request?.contract !== "hospitality-menu-studio.dish-review-request.v1" || !sameStudioDishReviewSubject(request.subject, subject)) {
        states.set(subject.dishId, { status: request || fence ? "unavailable" : "unverified" });
      } else if (!fence) states.set(subject.dishId, { status: "in_review" });
      else if (!validStudioDishSafetyFence(fence, subject)) states.set(subject.dishId, { status: "unavailable" });
      else if (fence.status === "revoked") states.set(subject.dishId, { status: "revoked", fence });
      else active.push({ dishId: subject.dishId, fence, head: this.db.collection(studioDishReviewRecords).doc(refs[index * 2].id) });
    }
    if (!active.length) return states;
    const releases = await transaction.getAll(...active.map(row => row.head.collection("releases").doc(studioDishReleaseVersion(row.fence))), {
      fieldMask: ["contract", "subject", "status", "releaseId", "matrixHash", "changedAt", "signatures"],
    });
    const candidates = active.flatMap((row, index) => {
      const header = releases[index].data() as StudioDishReleaseHeader | undefined;
      if (header && matchesStudioDishRelease(header, row.fence)) return [{ ...row, signatures: header.signatures }];
      states.set(row.dishId, { status: "unavailable" });
      return [];
    });
    if (!candidates.length) return states;
    const signatures = await transaction.getAll(...candidates.flatMap(row => row.signatures.map(signature => row.head.collection("events").doc(signature.eventId))), {
      fieldMask: ["action", "source", "role", "actorId", "eventId", "signedAt", "matrixHash", "sourceHash", "signatureHash"],
    });
    for (const [index, { dishId, fence, signatures: expected }] of candidates.entries()) {
      const complete = expected.every((signature, slot) => matchesStudioDishSignatureEvent(
        signatures[index * 2 + slot].data() as Parameters<typeof matchesStudioDishSignatureEvent>[0], signature));
      states.set(dishId, complete ? { status: "verified", fence } : { status: "unavailable" });
    }
    return states;
  }

  async save<T extends Draft>(kind: DraftCollection, actorId: string, draft: T): Promise<T> {
    const head = this.draftHead(kind, draft.id);
    return this.db.runTransaction(async transaction => {
      const previous = (await transaction.get(head)).data() as StoredDraft | undefined;
      const existing = previous && decodeDraft<T>(previous);
      const baseVersion = existing?.item.version ?? 0;
      const sameContent = existing && isDeepStrictEqual(content(existing.item), content(draft));
      if (draft.version !== baseVersion) {
        if (sameContent && existing.actorId === actorId && existing.baseVersion === draft.version && !existing.restoredFromVersion) return existing.item;
        throw conflict();
      }
      if (sameContent) return existing.item;

      return this.writeRevision(transaction, head, draft, actorId, baseVersion);
    });
  }

  async restoreMenuDraft(actorId: string, id: string, expectedVersion: number, sourceVersion: number) {
    if (sourceVersion >= expectedVersion) {
      throw new StudioProblem(422, "INVALID_RESTORE_SOURCE", "Select an earlier version to restore.");
    }
    const head = this.draftHead("menus", id);
    const revisions = head.collection("revisions");
    const restoredVersion = expectedVersion + 1;
    return this.db.runTransaction(async transaction => {
      const current = (await transaction.get(head)).data() as StoredDraft | undefined;
      if (!current) throw new StudioProblem(404, "DRAFT_NOT_FOUND", "This draft could not be found.");
      if (current.item.version !== expectedVersion) {
        if (current.item.version < restoredVersion) throw conflict();
        const receipt = current.item.version === restoredVersion ? current
          : (await transaction.get(revisions.doc(String(restoredVersion)))).data() as StoredDraft | undefined;
        if (receipt?.actorId === actorId && receipt.baseVersion === expectedVersion && receipt.restoredFromVersion === sourceVersion) {
          archivedMenu(receipt, id, restoredVersion);
          return { item: decodeDraft<Menu>(current).item, restoredVersion };
        }
        throw conflict();
      }

      const archived = (await transaction.get(revisions.doc(String(sourceVersion)))).data() as StoredDraft | undefined;
      const item = this.writeRevision(transaction, head, archivedMenu(archived, id, sourceVersion), actorId, expectedVersion, sourceVersion);
      return { item, restoredVersion };
    });
  }

  private writeRevision<T extends Draft>(
    transaction: Transaction, head: DocumentReference, draft: T, actorId: string, baseVersion: number, restoredFromVersion?: number,
  ): T {
    const item: T = { ...draft, version: baseVersion + 1, updatedAt: this.now().toISOString() };
    const evidence = encodeDraft({
      item, actorId, baseVersion, source: "hospitality-menu-studio",
      ...(restoredFromVersion === undefined ? {} : { restoredFromVersion }),
    });
    transaction.set(head, evidence);
    transaction.create(head.collection("revisions").doc(String(item.version)), evidence);
    return item;
  }

  private draftHead(kind: DraftCollection, id: string) { return this.db.collection(`${root}_${kind}`).doc(id); }

  private page(collection: FirebaseFirestore.CollectionReference, cursor?: string) {
    let query = collection.orderBy(FieldPath.documentId()).limit(pageSize + 1);
    if (cursor) query = query.startAfter(cursor);
    return query.get();
  }
}

// Firestore accepts lists of maps, but no directly nested arrays.
function encodeDraft({ item, ...evidence }: DraftData<Draft>): StoredDraft {
  if (!("sections" in item)) return { ...evidence, item };
  const sections = item.sections.map(section => ({ ...section, weeks: section.weeks.map(dishIds => ({ dishIds })) }));
  return { ...evidence, item: { ...item, sections } };
}

function decodeDraft<T extends Draft>({ item, ...evidence }: StoredDraft): DraftData<T> {
  if (!("sections" in item)) return { ...evidence, item: item as T };
  const sections = item.sections.map(section => ({ ...section, weeks: section.weeks.map(week => week.dishIds) }));
  return { ...evidence, item: { ...item, sections } as T };
}

function content({ version: _version, updatedAt: _updatedAt, ...draft }: Draft) { return draft; }

function conflict() {
  return new StudioProblem(409, "DRAFT_CONFLICT", "Someone saved a newer version. Your edits are still available locally.");
}

function publicationIntegrity() { return new StudioProblem(503, "PUBLICATION_INTEGRITY", "The saved publication evidence could not be verified."); }

function archivedMenu(value: StoredDraft | undefined, menuId: string, version: number): Menu {
  if (!value) throw new StudioProblem(404, "DRAFT_REVISION_MISSING", "The requested draft revision could not be found.");
  const parsed = menuSchema.safeParse(decodeDraft<Menu>(value).item);
  if (!parsed.success || parsed.data.id !== menuId || parsed.data.version !== version) {
    throw new StudioProblem(503, "DRAFT_REVISION_INTEGRITY", "The draft revision could not be verified.");
  }
  return parsed.data;
}

export function studioStore() {
  const runtime = studioRuntime();
  if (runtime.mode === "local") process.env.FIRESTORE_EMULATOR_HOST = runtime.firestoreHost;
  const name = `hospitality-menu-studio-${runtime.projectId}`;
  const app = getApps().find(app => app.name === name) || initializeApp({ projectId: runtime.projectId }, name);
  return new StudioStore(getFirestore(app));
}
