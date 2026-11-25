import type { Firestore, Transaction } from "firebase-admin/firestore";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { z } from "zod";
import { dateSchema, idSchema } from "../../shared/hospitality-menu-studio-content";
import {
  canonicalJson, decodeStudioPublication, studioPublicationDescriptor, type PublicationPackage, type StudioPublicationDescriptor,
} from "../../shared/hospitality-menu-studio-publication";
import {
  decodeStudioProductPublication, isStudioProductMenuId, studioProductChoicesForDate, studioProductPublicationContract,
  type StudioProductPublication,
} from "../../shared/hospitality-menu-studio-product-publication";
import {
  matchesStudioDishRelease, matchesStudioDishSignatureEvent, studioDishReviewKey, studioDishReviewRecords, studioDishReleaseVersion,
  studioDishSafetyFences, validStudioDishSafetyFence, type StudioDishReleaseHeader, type StudioDishSafetyFence,
} from "../../shared/hospitality-menu-studio-safety";
import { hospitalityRotationWeek } from "../../shared/hospitality-menu-date";
import type { StudioChoiceGroup, StudioChoicePresentation } from "../../shared/hospitality-menu-studio-selection";

const visibilitySchema = z.enum(["staff", "customer"]);
const activationEntry = z.strictObject({
  publication: studioPublicationDescriptor, kind: z.enum(["seasonal", "collection", "product"]), visibility: visibilitySchema,
  startDate: dateSchema, endDate: dateSchema, catalogueItemIds: z.array(idSchema).min(1),
});
const maximumScheduleEntries = 128;
const scheduleSchema = z.strictObject({
  generation: z.int().nonnegative(), oplocId: idSchema, entries: z.array(activationEntry).max(maximumScheduleEntries),
});
export const studioActivationCommand = z.strictObject({
  publicationId: idSchema, oplocId: idSchema, expectedGeneration: z.int().nonnegative(), commandId: z.uuid(),
  confirmed: z.literal(true), action: z.enum(["activate-seasonal", "activate-collection", "activate-product"]), visibility: visibilitySchema,
  reason: z.string().trim().min(3).max(500),
});
export type ActivationCommand = z.infer<typeof studioActivationCommand>;
type ActivationEntry = z.infer<typeof activationEntry>;
type SiteSchedule = z.infer<typeof scheduleSchema>;
type FrozenDish = PublicationPackage["dishes"][number];
type PublicationInput = { manifest: StudioPublicationDescriptor; body: string };
type PublishedPayload = PublicationPackage | StudioProductPublication;
type DateScope = { firstDate: string; lastDate: string };
type ActivationSubject = { id: string; startDate: string; endDate: string };
export type CurrentStudioMenu = {
  publication: StudioPublicationDescriptor; dishes: FrozenDish[];
  productChoices?: {
    presentation: StudioChoicePresentation;
    groups: StudioChoiceGroup[];
  };
};

const packageCollection = "fikaStudioPublicationPackagesV1";
const scheduleCollection = "fikaStudioActivationSchedulesV1";

function failure(status: number, code: string, message: string) {
  return Object.assign(new Error(message), { status, code });
}
const integrity = () => failure(503, "STUDIO_PUBLICATION_INTEGRITY", "Studio publication evidence could not be verified.");
const unsafe = () => failure(409, "STUDIO_PUBLICATION_SAFETY_CHANGED", "Current CPU verification is required for the exact published dish revisions.");

function verifiedPayload(stored: unknown, projectId: PublicationPackage["projectId"], id: string) {
  const envelope = stored as Partial<PublicationInput> | undefined;
  if (!envelope?.manifest || envelope.manifest.id !== id || typeof envelope.body !== "string") throw integrity();
  const payload = isStudioProductMenuId(envelope.manifest.menuId)
    ? decodeStudioProductPublication(envelope.body, envelope.manifest, projectId)
    : decodeStudioPublication(envelope.body, envelope.manifest, projectId);
  if (!payload) throw integrity();
  return { payload, manifest: envelope.manifest };
}

export async function assertCurrentStudioFoodSafety(db: Firestore, transaction: Transaction, dishes: FrozenDish[]) {
  for (let from = 0; from < dishes.length; from += 30) {
    const batch = dishes.slice(from, from + 30);
    const keys = batch.map(({ safety }) => studioDishReviewKey(safety.subject.dishId, safety.subject.revision));
    const fences = await transaction.getAll(...keys.map(key => db.collection(studioDishSafetyFences).doc(key)));
    const refs = batch.map(({ safety }, index) => {
      const fence = fences[index].data() as StudioDishSafetyFence | undefined;
      if (!fence || !validStudioDishSafetyFence(fence, safety.subject) || fence.status !== "current" ||
          fence.releaseId !== safety.releaseId || fence.matrixHash !== safety.matrixHash) throw unsafe();
      const record = db.collection(studioDishReviewRecords).doc(keys[index]);
      return { fence, record, release: record.collection("releases").doc(studioDishReleaseVersion(fence)) };
    });
    const releases = await transaction.getAll(...refs.map(item => item.release), {
      fieldMask: ["contract", "subject", "status", "releaseId", "matrixHash", "changedAt", "signatures"],
    });
    const signatures = refs.flatMap(({ fence, record }, index) => {
      const release = releases[index].data() as StudioDishReleaseHeader | undefined;
      if (!release || !matchesStudioDishRelease(release, fence)) throw unsafe();
      return release.signatures.map(signature => ({ signature, event: record.collection("events").doc(signature.eventId) }));
    });
    const events = await transaction.getAll(...signatures.map(item => item.event), {
      fieldMask: ["action", "source", "role", "actorId", "eventId", "signedAt", "matrixHash", "sourceHash", "signatureHash"],
    });
    if (signatures.some(({ signature }, index) => !matchesStudioDishSignatureEvent(
      events[index].data() as Parameters<typeof matchesStudioDishSignatureEvent>[0], signature,
    ))) throw unsafe();
  }
}

function isProduct(payload: PublishedPayload): payload is StudioProductPublication {
  return payload.contract === studioProductPublicationContract;
}

function entryFor(publication: StudioPublicationDescriptor, payload: PublishedPayload, visibility: ActivationEntry["visibility"], lastDate?: string): ActivationEntry {
  if (isProduct(payload)) {
    const startDate = payload.effectiveDate;
    if (!lastDate || lastDate < startDate || visibility !== "customer") throw integrity();
    return { publication, kind: "product", visibility, startDate, endDate: lastDate, catalogueItemIds: [payload.itemId] };
  }
  const { kind, startDate, endDate, sections } = payload.menu;
  return { publication, kind, visibility, startDate, endDate, catalogueItemIds: sections.map(section => section.catalogueItemId) };
}

export class HubStudioPublications {
  constructor(private readonly db: Firestore, private readonly projectId: PublicationPackage["projectId"], private readonly now = () => new Date()) {}

  async register(input: PublicationInput) {
    const { payload, manifest } = verifiedPayload(input, this.projectId, input.manifest.id);
    const ref = this.packageRef(payload.publicationId);
    return this.db.runTransaction(async transaction => {
      const existing = await transaction.get(ref);
      if (existing.exists) {
        verifiedPayload(existing.data(), this.projectId, payload.publicationId);
        if (canonicalJson(existing.data()?.manifest) !== canonicalJson(manifest) || existing.data()?.body !== input.body) {
          throw failure(409, "STUDIO_PUBLICATION_ID_CONFLICT", "Different evidence already exists for this publication ID.");
        }
      } else {
        if (isProduct(payload)) await assertCurrentStudioFoodSafety(this.db, transaction, payload.dishes);
        transaction.create(ref, { manifest, body: input.body });
      }
      return { publicationId: manifest.id, contentHash: manifest.contentHash };
    });
  }

  async generation(oplocId: string) {
    return this.schedule((await this.siteRef(oplocId).get()).data(), oplocId).generation;
  }

  async activate(command: ActivationCommand,
    authorise: (transaction: Transaction, command: ActivationCommand) => Promise<string>,
    validateCatalogue: (transaction: Transaction, oplocId: string, itemIds: readonly string[], menu: ActivationSubject) => Promise<void>,
    productScope?: DateScope) {
    const ref = this.siteRef(command.oplocId);
    const receiptRef = ref.collection("events").doc(command.commandId);
    return this.db.runTransaction(async transaction => {
      const actorId = await authorise(transaction, command);
      const idempotency = canonicalJson({ actorId, command });
      const receipt = await transaction.get(receiptRef);
      if (receipt.exists) {
        if (receipt.data()?.idempotency !== idempotency) throw failure(409, "STUDIO_ACTIVATION_COMMAND_CONFLICT", "This activation command was already used.");
        return { generation: z.int().positive().parse(receipt.data()?.generation), publicationId: command.publicationId };
      }
      const [scheduleDoc, packageDoc] = await transaction.getAll(ref, this.packageRef(command.publicationId));
      const schedule = this.schedule(scheduleDoc.data(), command.oplocId);
      if (schedule.generation !== command.expectedGeneration) throw failure(409, "STUDIO_ACTIVATION_GENERATION", "The current site activation changed. Refresh before activating.");
      if (schedule.entries.length >= maximumScheduleEntries) throw failure(409, "STUDIO_ACTIVATION_SCHEDULE_FULL", "The site activation index needs review.");
      if (!packageDoc.exists) throw failure(404, "STUDIO_PUBLICATION_MISSING", "This Studio publication has not been delivered.");
      const { manifest, payload } = verifiedPayload(packageDoc.data(), this.projectId, command.publicationId);
      const kind = command.action === "activate-product" ? "product" : command.action === "activate-seasonal" ? "seasonal" : "collection";
      const payloadKind = isProduct(payload) ? "product" : payload.menu.kind;
      if (payloadKind !== kind || (kind !== "collection" && command.visibility !== "customer")) {
        throw failure(422, "STUDIO_ACTIVATION_KIND", "Use the activation authority for this menu type.");
      }
      if (isProduct(payload)) {
        if (!productScope || payload.effectiveDate < productScope.firstDate || payload.effectiveDate > productScope.lastDate) {
          throw failure(403, "STUDIO_PUBLICATION_SCOPE_DENIED", "This product is outside the approved staging date window.");
        }
        const { configuration } = payload;
        if (configuration.groups.length
          ? configuration.groups.some(group => (group.presentation ?? configuration.presentation) !== "quantities")
          : configuration.presentation === "checkboxes") {
          throw failure(422, "STUDIO_CHOICE_QUANTITY_POLICY_UNAVAILABLE", "These selection controls need a verified booking quantity rule.");
        }
      }
      const entry = entryFor(manifest, payload, command.visibility, productScope?.lastDate);
      const earlier = schedule.entries.filter(previous => previous.publication.menuId === manifest.menuId).at(-1);
      if (manifest.revision !== (earlier?.publication.revision ?? 0) + 1 ||
          (earlier && (payload.previousPublicationId !== earlier.publication.id || manifest.effectiveDate < earlier.publication.effectiveDate ||
            (entry.kind !== "product" && entry.startDate !== earlier.startDate) || entry.endDate !== earlier.endDate || entry.kind !== earlier.kind))) {
        throw failure(409, "STUDIO_ACTIVATION_LINEAGE", "The publication does not advance the current menu activation.");
      }
      if (entry.visibility === "customer" && schedule.entries.some(other => other.visibility === "customer" &&
          other.publication.menuId !== manifest.menuId && other.endDate >= manifest.effectiveDate && entry.endDate >= other.publication.effectiveDate &&
          (entry.kind === "seasonal" && other.kind === "seasonal" || entry.catalogueItemIds.some(item => other.catalogueItemIds.includes(item))))) {
        throw failure(409, "STUDIO_ACTIVATION_OVERLAP", "An activated menu overlaps the date or catalogue item scope.");
      }
      await validateCatalogue(transaction, command.oplocId, entry.catalogueItemIds, {
        id: manifest.menuId, startDate: entry.startDate, endDate: entry.endDate,
      });
      await assertCurrentStudioFoodSafety(this.db, transaction, payload.dishes);
      const generation = schedule.generation + 1;
      transaction.set(ref, { generation, oplocId: command.oplocId, entries: [...schedule.entries, entry] });
      transaction.create(receiptRef, { source: "hospitality-menu-studio", action: command.action, actorId, at: this.now().toISOString(),
        publicationId: manifest.id, contentHash: manifest.contentHash, reason: command.reason, idempotency, generation });
      return { generation, publicationId: manifest.id };
    });
  }

  /** Resolve publication before matching items so a removed section never falls back to an earlier revision. */
  async choices(transaction: Transaction, oplocId: string, eventDate: string, itemIds: readonly string[], allowedMenuId?: string) {
    const schedule = this.schedule((await transaction.get(this.siteRef(oplocId))).data(), oplocId);
    const effective = new Map<string, ActivationEntry>();
    for (const entry of schedule.entries) {
      if ((!allowedMenuId || allowedMenuId === entry.publication.menuId) &&
          entry.startDate <= eventDate && entry.endDate >= eventDate && entry.publication.effectiveDate <= eventDate) {
        effective.set(entry.publication.menuId, entry);
      }
    }
    const active = [...effective.values()].filter(entry => entry.visibility === "customer");
    const managedItems = new Set(schedule.entries
      .filter(entry => entry.visibility === "customer" && effective.has(entry.publication.menuId) &&
        entry.publication.effectiveDate <= eventDate)
      .flatMap(entry => entry.catalogueItemIds)
      .filter(id => itemIds.includes(id)));
    const wanted = active.filter(entry => entry.catalogueItemIds.some(id => itemIds.includes(id)));
    const snapshots = wanted.length ? await transaction.getAll(...wanted.map(entry => this.packageRef(entry.publication.id))) : [];
    const items = new Map<string, CurrentStudioMenu>();
    for (const [index, entry] of wanted.entries()) {
      const pkg = verifiedPayload(snapshots[index].data(), this.projectId, entry.publication.id);
      if (canonicalJson(entry) !== canonicalJson(entryFor(pkg.manifest, pkg.payload, entry.visibility, entry.endDate))) throw integrity();
      if (isProduct(pkg.payload)) {
        const { itemId } = pkg.payload;
        if (items.has(itemId)) throw integrity();
        const selected = studioProductChoicesForDate(pkg.payload, eventDate);
        if (!selected) throw integrity();
        items.set(itemId, { publication: pkg.manifest, dishes: [...selected.dishes, ...selected.groups.flatMap(group => group.dishes)],
          productChoices: {
            presentation: selected.groups.length ? "quantities" : selected.presentation,
            groups: selected.groups.map(group => ({ id: group.id, name: group.name, presentation: group.presentation,
              dishIds: group.dishes.map(record => record.dish.id) })),
          },
        });
        continue;
      }
      const { menu, dishes } = pkg.payload;
      const byId = new Map(dishes.map(item => [item.dish.id, item]));
      for (const section of menu.sections) {
        if (!itemIds.includes(section.catalogueItemId)) continue;
        if (items.has(section.catalogueItemId)) throw integrity();
        const dishIds = section.mode === "static" ? section.staticDishIds :
          section.weeks[hospitalityRotationWeek(menu.anchorMonday, eventDate, 6) - 1];
        const selected = dishIds?.map(id => byId.get(id));
        if (!selected?.length || selected.some(dish => !dish)) throw integrity();
        items.set(section.catalogueItemId, { publication: pkg.manifest, dishes: selected as FrozenDish[] });
      }
    }
    const distinct = new Map([...items.values()].flatMap(entry => entry.dishes.map(dish => [dish.safety.releaseId, dish])));
    await assertCurrentStudioFoodSafety(this.db, transaction, [...distinct.values()]);
    return { generation: schedule.generation, items, managedItems };
  }

  private packageRef(id: string) { return this.db.collection(packageCollection).doc(id); }
  private siteRef(oplocId: string) { return this.db.collection(scheduleCollection).doc(stableDocumentId(oplocId)); }
  private schedule(data: unknown, oplocId: string): SiteSchedule {
    if (data === undefined) return { generation: 0, oplocId, entries: [] };
    const checked = scheduleSchema.safeParse(data);
    if (!checked.success || checked.data.oplocId !== oplocId || checked.data.generation !== checked.data.entries.length) throw integrity();
    return checked.data;
  }
}
