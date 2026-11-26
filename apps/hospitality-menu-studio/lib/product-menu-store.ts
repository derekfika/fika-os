import type { CollectionReference, DocumentData, DocumentReference, Transaction } from "firebase-admin/firestore";
import { FieldPath } from "firebase-admin/firestore";
import { isDeepStrictEqual } from "node:util";
import { dishSchema } from "../../shared/hospitality-menu-studio-content";
import {
  initialProductMenuConfiguration, productMenuDraft, productMenuSummary,
  type ProductMenuConfiguration, type ProductMenuDraft, type ProductMenuListing, type ProductMenuSetup, type ProductMenuSummary,
} from "../../shared/hospitality-menu-studio-product-content";
import { decodeStudioProductPublication, studioProductMenuId } from "../../shared/hospitality-menu-studio-product-publication";
import { publicationIdFor, publicationHash, studioPublicationDescriptor } from "../../shared/hospitality-menu-studio-publication";
import { productMenuDishKey, type ProductMenuDishReference } from "./product-menu-dishes";
import { StudioProblem } from "./problem";
import { readStudioDocument, readStudioDocuments, readStudioQuery } from "./data-trace";

const pageSize = 50;

type SavedDraft = {
  schemaVersion: 1;
  item: ProductMenuDraft;
  summary: ProductMenuSummary;
  actorId: string;
  baseVersion: number;
  source: "hospitality-menu-studio";
};

export class ProductMenuStore {
  constructor(private readonly drafts: CollectionReference, private readonly dishes: CollectionReference,
    private readonly now: () => Date, private readonly projectId: "demo-fika-os" | "fika-os-dev") {}

  async read(itemId: string) {
    const record = await readStudioDocument("product-menu.draft", this.drafts.doc(itemId).get());
    return record.exists ? decodeDraft(itemId, record.data()).item : null;
  }

  async readDishRevisions(references: ProductMenuDishReference[]) {
    const unique = [...new Map(references.map(reference => [productMenuDishKey(reference), reference])).values()];
    if (!unique.length) return [];
    const records = await readStudioDocuments("product-menu.dish-revisions", this.drafts.firestore.getAll(...unique.map(reference => this.dishRevision(reference))));
    return records.flatMap((record, index) => {
      if (!record.exists) return [];
      const { id, version, name, category, customerDescription } = decodeDishRevision(record.data(), unique[index]);
      return [{ id, version, name, category, customerDescription }];
    });
  }

  async list(currentItemIds: ReadonlySet<string>, cursor?: string): Promise<{ items: ProductMenuListing[]; nextCursor: string | null }> {
    let query = this.drafts.select("summary").orderBy(FieldPath.documentId()).limit(pageSize + 1);
    if (cursor) query = query.startAfter(cursor);
    const page = (await readStudioQuery("product-menu.summary-page", query.get())).docs;
    const rows = page.slice(0, pageSize).filter(record => currentItemIds.has(record.id))
      .map(record => {
        const summary = productMenuSummary.safeParse(record.get("summary"));
        if (!summary.success || summary.data.itemId !== record.id) throw integrity();
        return { ref: record.ref, summary: summary.data };
      });
    const statuses = await this.publicationStatuses(rows);
    const items = rows.map(({ ref, summary }) => ({ ...summary, ...(statuses.get(ref.id) ?? { publicationStatus: "unavailable" as const }) }));
    return { items, nextCursor: page.length > pageSize ? page[pageSize - 1].id : null };
  }

  private async publicationStatuses(rows: { ref: DocumentReference; summary: ProductMenuSummary }[]) {
    if (!rows.length) return new Map<string, Pick<ProductMenuListing, "publicationStatus" | "hasPublishedRevision">>();
    const latest = await readStudioDocuments("product-menu.publication-heads",
      this.drafts.firestore.getAll(...rows.map(({ ref }) => ref.collection("productPublicationState").doc("latest"))));
    const entries = rows.map((row, index) => {
      const snapshot = latest[index]!;
      if (!snapshot.exists) return { ...row, status: { publicationStatus: "draft" as const, hasPublishedRevision: false } };
      const descriptor = studioPublicationDescriptor.safeParse(snapshot.data()?.manifest);
      if (!descriptor.success || descriptor.data.menuId !== studioProductMenuId(row.ref.id)) {
        return { ...row, status: { publicationStatus: "unavailable" as const } };
      }
      return { ...row, manifest: descriptor.data };
    });
    const packageEntries = entries.filter((entry): entry is typeof entry & { manifest: ReturnType<typeof studioPublicationDescriptor.parse> } => "manifest" in entry);
    const packages = packageEntries.length
      ? await readStudioDocuments("product-menu.publication-packages",
        this.drafts.firestore.getAll(...packageEntries.map(({ ref, manifest }) => ref.collection("productPublicationPackages").doc(manifest.id))))
      : [];
    const verifiedPackages = packageEntries.flatMap((entry, index) => {
      const record = packages[index]!.data();
      const { manifest } = entry;
      if (!record || !isDeepStrictEqual(record.manifest, manifest) || typeof record.body !== "string" ||
          manifest.id !== publicationIdFor(manifest.menuId, manifest.revision) ||
          !decodeStudioProductPublication(record.body, manifest, this.projectId) ||
          manifest.sourceDraftVersion > entry.summary.version) return [];
      return [{ ...entry, body: record.body }];
    });
    const outboxes = verifiedPackages.length
      ? await readStudioDocuments("product-menu.publication-outboxes",
        this.drafts.firestore.getAll(...verifiedPackages.map(({ ref, manifest }) => ref.collection("productPublicationDelivery").doc(manifest.id))))
      : [];
    const verifiedStatuses = new Map<string, Pick<ProductMenuListing, "publicationStatus" | "hasPublishedRevision">>();
    for (const [index, entry] of verifiedPackages.entries()) {
      const { manifest, summary, ref } = entry;
      const outbox = outboxes[index]!.data();
      if (outbox?.action !== "studio-product-content-published" || outbox.source !== "hospitality-menu-studio" ||
          outbox.actorId !== manifest.publishedBy || outbox.at !== manifest.publishedAt || outbox.status !== "delivered" ||
          outbox.contentHash !== manifest.contentHash || outbox.publicationId !== manifest.id || outbox.itemId !== ref.id ||
          outbox.sourceDraftVersion !== manifest.sourceDraftVersion ||
          outbox.previousPublicationId !== (manifest.revision === 1 ? null : publicationIdFor(manifest.menuId, manifest.revision - 1)) ||
          publicationHash(entry.body) !== manifest.contentHash) {
        verifiedStatuses.set(ref.id, { publicationStatus: "unavailable" });
        continue;
      }
      verifiedStatuses.set(ref.id, { publicationStatus: manifest.sourceDraftVersion === summary.version ? "published" : "draft", hasPublishedRevision: true });
    }
    return new Map(entries.map(entry => [entry.ref.id, "status" in entry ? entry.status : verifiedStatuses.get(entry.ref.id) ?? { publicationStatus: "unavailable" as const }]));
  }

  async createOrOpen(actorId: string, itemId: string, setup: ProductMenuSetup) {
    const head = this.drafts.doc(itemId);
    return this.drafts.firestore.runTransaction(async transaction => {
      const record = await readStudioDocument("product-menu.create", transaction.get(head), true);
      if (record.exists) return decodeDraft(itemId, record.data()).item;
      return this.writeRevision(transaction, head, actorId, 0, initialProductMenuConfiguration(setup));
    });
  }

  async save(actorId: string, request: ProductMenuDraft) {
    const head = this.drafts.doc(request.itemId);
    return this.drafts.firestore.runTransaction(async transaction => {
      const record = await readStudioDocument("product-menu.save", transaction.get(head), true);
      if (!record.exists) throw new StudioProblem(404, "PRODUCT_MENU_MISSING", "Create the product menu before saving changes.");
      const current = decodeDraft(head.id, record.data());
      const sameConfiguration = isDeepStrictEqual(current.item.configuration, request.configuration);
      if (request.version !== current.item.version) {
        if (sameConfiguration && current.actorId === actorId && current.baseVersion === request.version) return current.item;
        throw new StudioProblem(409, "DRAFT_CONFLICT", "Someone saved a newer version. Your edits are still available locally.");
      }
      if (sameConfiguration) return current.item;
      await this.verifyNewDishRevisions(transaction, current.item.configuration, request.configuration);
      return this.writeRevision(transaction, head, actorId, current.item.version, request.configuration);
    });
  }

  private async verifyNewDishRevisions(transaction: Transaction, current: ProductMenuConfiguration, next: ProductMenuConfiguration) {
    const previous = dishRevisions(current);
    const additions = [...dishRevisions(next)].filter(([key]) => !previous.has(key)).map(([, reference]) => reference);
    for (let start = 0; start < additions.length; start += 50) {
      const batch = additions.slice(start, start + 50);
      const revisions = await readStudioDocuments("product-menu.save.verify-dishes", transaction.getAll(...batch.map(reference => this.dishRevision(reference))), true);
      for (const [index, record] of revisions.entries()) {
        if (!record.exists) throw new StudioProblem(422, "PRODUCT_MENU_DISH_REVISION_MISSING", "Choose a saved dish revision before assigning it.");
        decodeDishRevision(record.data(), batch[index]);
      }
    }
  }

  private dishRevision({ dishId, revision }: ProductMenuDishReference) {
    return this.dishes.doc(dishId).collection("revisions").doc(String(revision));
  }

  private writeRevision(transaction: Transaction, head: DocumentReference, actorId: string, baseVersion: number,
    configuration: ProductMenuConfiguration) {
    const item: ProductMenuDraft = { schemaVersion: 1, itemId: head.id, version: baseVersion + 1,
      updatedAt: this.now().toISOString(), configuration };
    const evidence: SavedDraft = { schemaVersion: 1, item, summary: summarise(item), actorId, baseVersion, source: "hospitality-menu-studio" };
    transaction.set(head, evidence);
    transaction.create(head.collection("revisions").doc(String(item.version)), evidence);
    return item;
  }
}

function decodeDishRevision(saved: DocumentData | undefined, expected: ProductMenuDishReference) {
  const dish = dishSchema.safeParse(saved?.item);
  if (!dish.success || dish.data.id !== expected.dishId || dish.data.version !== expected.revision ||
      saved?.source !== "hospitality-menu-studio" || saved.baseVersion !== expected.revision - 1 ||
      typeof saved.actorId !== "string" || !saved.actorId) {
    throw new StudioProblem(503, "PRODUCT_MENU_DISH_REVISION_INTEGRITY", "The assigned dish revision could not be verified.");
  }
  return dish.data;
}

function decodeDraft(itemId: string, data: unknown): SavedDraft {
  const record = data as Partial<SavedDraft> | undefined;
  const item = productMenuDraft.safeParse(record?.item);
  if (!item.success || record?.schemaVersion !== 1 || record.source !== "hospitality-menu-studio" ||
      item.data.itemId !== itemId || typeof record.actorId !== "string" || !record.actorId ||
      record.baseVersion !== item.data.version - 1 || !isDeepStrictEqual(record.summary, summarise(item.data))) throw integrity();
  return { ...record, item: item.data } as SavedDraft;
}

function summarise({ itemId, version, updatedAt, configuration }: ProductMenuDraft): ProductMenuSummary {
  const { schedule } = configuration;
  const details = { itemId, version, updatedAt };
  if (schedule.kind === "rotation") return { ...details, kind: "rotation", cycleWeeks: schedule.weeks.length };
  const { choices } = schedule;
  const dishCount = choices.dishes.length + choices.groups.reduce((total, group) => total + group.dishes.length, 0);
  return { ...details, kind: "fixed", dishCount };
}

function integrity() {
  return new StudioProblem(503, "PRODUCT_MENU_INTEGRITY", "The saved product draft could not be verified.");
}

function dishRevisions(configuration: ProductMenuConfiguration) {
  const { schedule } = configuration;
  const slots = schedule.kind === "fixed" ? [schedule.choices] : schedule.weeks;
  const references = slots.flatMap(slot => [...slot.dishes, ...slot.groups.flatMap(group => group.dishes)]);
  return new Map(references.map(reference => [`${reference.dishId}|${reference.revision}`, reference]));
}
