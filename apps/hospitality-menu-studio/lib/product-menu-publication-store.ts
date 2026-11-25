import { createHmac } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { CollectionReference, DocumentData, DocumentReference, DocumentSnapshot, Transaction } from "firebase-admin/firestore";
import type { CatalogueLoadResult } from "@fika/server-shared/hospitality-catalogue-client";
import { assortmentIsComplete, dishSchema, type Dish } from "../../shared/hospitality-menu-studio-content";
import { productMenuDraft, type ProductMenuDraft } from "../../shared/hospitality-menu-studio-product-content";
import {
  canonicalJson, maximumStudioPublicationBytes, publicationHash, publicationIdFor, studioPublicationDescriptor, type StudioPublicationDescriptor,
} from "../../shared/hospitality-menu-studio-publication";
import {
  decodeStudioProductPublication, studioProductMenuId, studioProductPublicationContract, studioProductPublicationReferences,
  studioProductSlots, type StudioProductPublication,
} from "../../shared/hospitality-menu-studio-product-publication";
import {
  studioDishReviewSubject, validStudioDishSafetyFence, type StudioDishReviewSubject,
} from "../../shared/hospitality-menu-studio-safety";
import { londonDate, type StudioActor } from "./contract";
import { sameReviewToken, type DishSafety } from "./publication";
import { StudioProblem } from "./problem";

type ReviewRequest = { itemId: string; version: number; effectiveDate: string };
type PublishRequest = ReviewRequest & { reviewToken: string; confirmed: true };
type Evidence = {
  actor: StudioActor;
  catalogue: CatalogueLoadResult;
  signingKey: string;
  safety: (subject: StudioDishReviewSubject) => Promise<DishSafety>;
};
type Package = { manifest: StudioPublicationDescriptor; body: string };
type Snapshot = { draft: ProductMenuDraft; previous: StudioPublicationDescriptor | null; dishes: (Dish | null)[] };
type Review = { issues: string[]; reviewToken: string | null; effectiveDate: string; sourceDraftVersion: number; impact: "unavailable" };

const missing = () => new StudioProblem(404, "PRODUCT_MENU_MISSING", "The product draft could not be found.");
const changed = () => new StudioProblem(409, "PRODUCT_PUBLICATION_REVIEW_CHANGED", "The draft or its evidence changed. Review it again.");
const integrity = () => new StudioProblem(503, "PRODUCT_PUBLICATION_INTEGRITY", "The saved product publication evidence could not be verified.");

export class ProductMenuPublicationStore {
  constructor(
    private readonly drafts: CollectionReference,
    private readonly dishes: CollectionReference,
    private readonly projectId: StudioProductPublication["projectId"],
    private readonly now: () => Date,
  ) {}

  async review(request: ReviewRequest, evidence: Evidence) {
    this.requirePilot(request, evidence.actor);
    return (await this.candidate(request, evidence)).review;
  }

  async publish(request: PublishRequest, evidence: Evidence, deliver: (record: Package) => Promise<void>) {
    this.requirePilot(request, evidence.actor);
    const head = this.drafts.doc(request.itemId);
    const commandId = publicationHash(canonicalJson([evidence.actor.id, request]));
    const receipt = head.collection("productPublicationReceipts").doc(commandId);
    const existing = await this.existingReceipt(head, receipt, request, evidence.actor.id);
    if (existing) return this.deliver(head, existing, deliver);

    const { review, publication, previous, draft } = await this.candidate(request, evidence);
    if (!publication || !sameReviewToken(request.reviewToken, review.reviewToken)) throw changed();
    const record = await this.drafts.firestore.runTransaction(async transaction => {
      const [receiptSnapshot, draftSnapshot, latestSnapshot] = await transaction.getAll(
        receipt, head, head.collection("productPublicationState").doc("latest"),
      );
      if (receiptSnapshot.exists) {
        return this.receiptPackage(transaction, head, receiptSnapshot, request, evidence.actor.id);
      }
      if (!isDeepStrictEqual(this.decodeDraft(draftSnapshot.data(), request.itemId), draft) ||
          !isDeepStrictEqual(latestSnapshot.exists ? latestSnapshot.data()?.manifest : null, previous)) throw changed();
      const { manifest, body } = publication;
      transaction.create(head.collection("productPublicationPackages").doc(manifest.id), publication);
      transaction.set(latestSnapshot.ref, { manifest });
      transaction.create(receipt, { actorId: evidence.actor.id, commandId, publicationId: manifest.id, contentHash: manifest.contentHash });
      transaction.create(head.collection("productPublicationDelivery").doc(manifest.id), {
        action: "studio-product-content-published", source: "hospitality-menu-studio", actorId: evidence.actor.id, at: manifest.publishedAt,
        itemId: request.itemId, sourceDraftVersion: request.version, publicationId: manifest.id, contentHash: manifest.contentHash,
        previousPublicationId: previous?.id ?? null, impact: review.impact, status: "pending", commandId,
      });
      return { manifest, body };
    });
    return this.deliver(head, record, deliver);
  }

  private requirePilot(request: ReviewRequest, actor: StudioActor) {
    const pilot = actor.publicationPilot;
    if (!actor.canManage || !actor.canPublish || !pilot?.publish ||
        pilot.menuId !== studioProductMenuId(request.itemId) ||
        request.effectiveDate < pilot.firstDate || request.effectiveDate > pilot.lastDate) {
      throw new StudioProblem(403, "PRODUCT_PUBLICATION_SCOPE_DENIED", "This product and date are outside your approved publication scope.");
    }
  }

  private async candidate(request: ReviewRequest, evidence: Evidence) {
    const { draft, previous, dishes } = await this.snapshot(request);
    const { configuration } = draft;
    const { catalogue } = evidence;
    const issues: string[] = [];
    const review: Review = { issues, reviewToken: null, effectiveDate: request.effectiveDate, sourceDraftVersion: request.version, impact: "unavailable" };
    if (request.effectiveDate < londonDate(this.now()) || previous && request.effectiveDate < previous.effectiveDate) {
      issues.push("Choose a date on or after today and the last publication.");
    }
    const product = catalogue.catalogue.items.find(item => item.id === request.itemId);
    if (!product || catalogue.source === "cache-unverified" || !/^[a-f0-9]{64}$/.test(catalogue.contentHash)) {
      issues.push("The product could not be verified in the current Hub catalogue.");
    }
    if (studioProductSlots(configuration).some(slot => !slot.dishes.length && !slot.groups.some(group => group.dishes.length))) {
      issues.push(configuration.schedule.kind === "rotation"
        ? "Every menu week needs at least one dish." : "Add at least one dish to the menu.");
    }
    if (dishes.some(dish => !dish || !dish.name || !dish.customerDescription || !dish.kitchenDescription || !assortmentIsComplete(dish))) {
      issues.push("Every assigned dish revision needs saved customer and kitchen details.");
    }
    if (issues.length || !product) return { review, previous, draft };
    const itemName = product.name.trim();
    if (!itemName || itemName.length > 200) {
      issues.push("The current Hub product name cannot be published. Check its catalogue record.");
      return { review, previous, draft };
    }

    const frozenDishes: StudioProductPublication["dishes"] = [];
    for (let start = 0; start < dishes.length; start += 8) {
      const batch = await Promise.all(dishes.slice(start, start + 8).map(async dish => {
        const subject = studioDishReviewSubject(dish!);
        const result = await evidence.safety(subject);
        const fence = result.fence;
        if (result.status !== "verified" || fence?.status !== "current" || !validStudioDishSafetyFence(fence, subject)) return null;
        return { dish: dish!, safety: { subject, releaseId: fence.releaseId, matrixHash: fence.matrixHash } };
      }));
      if (batch.some(record => !record)) {
        issues.push("Every assigned dish revision needs current signed CPU allergen evidence.");
        return { review, previous, draft };
      }
      for (const record of batch) if (record) frozenDishes.push(record);
    }

    const { itemId, effectiveDate } = request;
    const menuId = studioProductMenuId(itemId);
    const revision = (previous?.revision ?? 0) + 1;
    const publicationId = publicationIdFor(menuId, revision);
    const payload: StudioProductPublication = {
      contract: studioProductPublicationContract, publicationId, publicationRevision: revision,
      previousPublicationId: previous?.id ?? null, sourceApp: "hospitality-menu-studio", projectId: this.projectId,
      itemId, itemName, sourceDraftVersion: request.version, catalogueHash: catalogue.contentHash,
      effectiveDate, configuration, dishes: frozenDishes,
    };
    const body = canonicalJson(payload);
    if (Buffer.byteLength(body) > maximumStudioPublicationBytes) {
      issues.push("The menu is too large to publish as one product revision.");
      return { review, previous, draft };
    }
    const contentHash = publicationHash(body);
    const manifest: StudioPublicationDescriptor = {
      id: publicationId, menuId, menuName: itemName, revision, effectiveDate, publishedAt: this.now().toISOString(),
      publishedBy: evidence.actor.id, sourceDraftVersion: request.version, scope: {}, contentHash,
    };
    if (!decodeStudioProductPublication(body, manifest, this.projectId)) throw integrity();
    review.reviewToken = createHmac("sha256", evidence.signingKey)
      .update(canonicalJson([studioProductPublicationContract, evidence.actor.id, contentHash, "impact-unavailable"])).digest("hex");
    return { review, publication: { manifest, body }, previous, draft };
  }

  private async snapshot(request: ReviewRequest): Promise<Snapshot> {
    const ref = this.drafts.doc(request.itemId);
    return this.drafts.firestore.runTransaction(async transaction => {
      const [current, archive, latest] = await transaction.getAll(
        ref, ref.collection("revisions").doc(String(request.version)), ref.collection("productPublicationState").doc("latest"),
      );
      if (!current.exists) throw missing();
      const draft = this.decodeDraft(current.data(), request.itemId);
      if (draft.version !== request.version) throw changed();
      if (!archive.exists || !isDeepStrictEqual(archive.data(), current.data())) throw integrity();
      const previousManifest = studioPublicationDescriptor.safeParse(latest.data()?.manifest);
      if (latest.exists && !previousManifest.success) throw integrity();
      const previous = previousManifest.success
        ? (await this.readPackage(transaction, ref, previousManifest.data.id)).manifest
        : null;
      if (previous && !isDeepStrictEqual(previous, previousManifest.data)) throw integrity();
      const dishes: Snapshot["dishes"] = [];
      const references = studioProductPublicationReferences(draft.configuration);
      for (let offset = 0; offset < references.length; offset += 50) {
        const batch = references.slice(offset, offset + 50);
        const records = await transaction.getAll(...batch.map(({ dishId, revision }) =>
          this.dishes.doc(dishId).collection("revisions").doc(String(revision))));
        for (const [i, record] of records.entries()) {
          const saved = record.data();
          if (!saved) { dishes.push(null); continue; }
          const { dishId, revision } = batch[i];
          const dish = dishSchema.safeParse(saved.item);
          if (!dish.success || dish.data.id !== dishId || dish.data.version !== revision ||
              saved.source !== "hospitality-menu-studio" || saved.baseVersion !== revision - 1 ||
              typeof saved.actorId !== "string" || !saved.actorId) throw integrity();
          dishes.push(dish.data);
        }
      }
      return { draft, previous, dishes };
    }, { readOnly: true });
  }

  private decodeDraft(value: DocumentData | undefined, itemId: string) {
    const parsed = productMenuDraft.safeParse(value?.item);
    if (!parsed.success || parsed.data.itemId !== itemId || value?.schemaVersion !== 1 ||
        value.source !== "hospitality-menu-studio" || value.baseVersion !== parsed.data.version - 1 ||
        typeof value.actorId !== "string" || !value.actorId) throw integrity();
    return parsed.data;
  }

  private async existingReceipt(head: DocumentReference, receipt: DocumentReference, request: PublishRequest, actorId: string) {
    return this.drafts.firestore.runTransaction(async transaction => {
      const snapshot = await transaction.get(receipt);
      return snapshot.exists ? this.receiptPackage(transaction, head, snapshot, request, actorId) : null;
    }, { readOnly: true });
  }

  private async receiptPackage(transaction: Transaction, head: DocumentReference,
    receipt: DocumentSnapshot, request: PublishRequest, actorId: string) {
    const saved = receipt.data();
    const record = await this.readPackage(transaction, head, saved?.publicationId);
    if (record.manifest.sourceDraftVersion !== request.version || record.manifest.effectiveDate !== request.effectiveDate ||
        record.manifest.publishedBy !== actorId || saved?.actorId !== actorId || saved?.commandId !== receipt.id ||
        saved?.contentHash !== record.manifest.contentHash) throw integrity();
    return record;
  }

  private async readPackage(transaction: Transaction, head: DocumentReference, id: unknown): Promise<Package> {
    if (typeof id !== "string" || !/^publication-[a-f0-9]{32}-v[1-9][0-9]*$/.test(id)) throw integrity();
    const record = (await transaction.get(head.collection("productPublicationPackages").doc(id))).data();
    const manifest = studioPublicationDescriptor.safeParse(record?.manifest);
    if (!manifest.success || manifest.data.id !== id || manifest.data.menuId !== studioProductMenuId(head.id) ||
        typeof record?.body !== "string" || !decodeStudioProductPublication(record.body, manifest.data, this.projectId)) throw integrity();
    return { manifest: manifest.data, body: record.body };
  }

  private async deliver(head: DocumentReference, record: Package, deliver: (record: Package) => Promise<void>) {
    const outbox = head.collection("productPublicationDelivery").doc(record.manifest.id);
    const current = (await outbox.get()).data();
    if (current?.contentHash !== record.manifest.contentHash || (current.status !== "pending" && current.status !== "delivered")) throw integrity();
    if (current.status === "pending") {
      await deliver(record);
      await this.drafts.firestore.runTransaction(async transaction => {
        const checked = (await transaction.get(outbox)).data();
        if (checked?.contentHash !== record.manifest.contentHash || (checked.status !== "pending" && checked.status !== "delivered")) throw integrity();
        if (checked.status === "pending") transaction.update(outbox, { status: "delivered", deliveredAt: this.now().toISOString() });
      });
    }
    return record.manifest;
  }
}
