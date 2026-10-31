import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { BusinessDate, DishLinkCommand, ROTATION_PICKER_SCOPES, ROTATIONS_SCHEMA, RotationCommand, RotationConfiguration, londonDate, publishedRevisionFor, type DishLink, type RotationHead, type RotationRevision } from "../../../shared/hospitality-rotations";

export const ROTATION_COLLECTION = "integrationHubHospitalityRotationsV1";
export const rotationProblem = (message: string, status = 422) => Object.assign(new Error(message), { status, code: `ROTATIONS_${status}` });
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, canonical(child)]));
  return value;
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const initialHead = (): RotationHead => ({ schema: ROTATIONS_SCHEMA, version: 0, activations: [] });
function checkedRevision(value: Record<string, unknown>, revision: number): RotationRevision {
  const { evidenceHash, ...record } = value;
  if (record.revision !== revision || record.schema !== ROTATIONS_SCHEMA || evidenceHash !== hash(record)) throw rotationProblem("Rotation evidence integrity check failed", 503);
  return record as RotationRevision;
}

type ProviderData = Record<string, any> | undefined;
export function assertActiveItem(item: ProviderData, itemId: string) {
  if (!item || item.canonicalId !== itemId || item.entityType !== "Hospitality Menu Item" || item.lifecycleStatus === "archived" || item.record?.lifecycleState === "archived" || item.publicationStatus === "withdrawn") throw rotationProblem(`Canonical Item ${itemId} is unavailable`, 409);
}
/** A rotation dish must be an active canonical dish in a scope the Rotations manager is allowed to use. */
export function assertRotationDish(source: ProviderData, dishId: string) {
  const record = (source?.record || source) as Record<string, any> | undefined;
  if (!record || source?.kind !== "dish" || record.canonicalId !== dishId || record.reviewStatus === "archived") throw rotationProblem(`Canonical dish ${dishId} is missing or archived`, 409);
  if (!(ROTATION_PICKER_SCOPES as readonly string[]).includes(record.operationalScope)) throw rotationProblem(`Dish ${dishId} is not authorised for Hospitality Rotations`, 422);
  return record;
}

/** Read only canonical provider records by ID; snapshots are historical publication evidence. */
async function freezeProviders(db: Firestore, tx: Transaction, configuration: RotationConfiguration) {
  const dishes = [...new Map(configuration.groups.flatMap(group => group.dishBank).map(dish => [dish.dishId, dish])).values()];
  const refs = [...dishes.map(dish => db.collection("fikaMenuPlanningCatalogue").doc(dish.dishId)), ...configuration.groups.map(group => db.collection("integrationHubCanonical").doc(stableDocumentId(group.itemId)))];
  const snapshots = await tx.getAll(...refs);
  const recipes = dishes.map((dish, index) => {
    const source = snapshots[index].data();
    const record = (source?.record || source) as Record<string, unknown> | undefined;
    if (!record || source?.kind !== "dish" || record.canonicalId !== dish.dishId || record.revision !== dish.recipeRevision || record.reviewStatus === "archived") throw rotationProblem(`Canonical dish ${dish.dishId} is missing, archived or changed`, 409);
    return { ...dish, record };
  });
  configuration.groups.forEach((group, index) => {
    const item = snapshots[dishes.length + index].data();
    assertActiveItem(item, group.itemId);
  });
  return recipes;
}
export class RotationStore {
  constructor(private readonly db: Firestore, private readonly now = () => new Date()) {}
  private root() { return this.db.collection(ROTATION_COLLECTION).doc("company"); }
  private revisionRef(revision: number) { return this.root().collection("revisions").doc(String(revision)); }
  async head(): Promise<RotationHead> { return (await this.root().get()).data() as RotationHead || initialHead(); }
  async revision(revision: number): Promise<RotationRevision> {
    const value = (await this.revisionRef(revision).get()).data();
    if (!value) throw rotationProblem("Rotation revision not found", 404);
    return checkedRevision(value, revision);
  }
  private linkRef(itemId: string) { return this.root().collection("dishLinks").doc(stableDocumentId(itemId)); }
  private reverseLinkRef(dishId: string) { return this.root().collection("dishLinkByDish").doc(stableDocumentId(dishId)); }
  /** Bounded: one small document per mapped catalogue Item. */
  async links(): Promise<DishLink[]> {
    const snapshot = await this.root().collection("dishLinks").limit(1000).get();
    return snapshot.docs.map(document => document.data() as DishLink).sort((a, b) => a.itemId.localeCompare(b.itemId));
  }
  /** Persist the stable Item-to-dish mapping once. Replays are idempotent; a different dish for the same Item, or the same dish for a different Item, is a conflict. */
  async linkDish(actorId: string, raw: unknown) {
    const command = DishLinkCommand.parse(raw);
    const at = this.now().toISOString();
    return this.db.runTransaction(async tx => {
      const [existing, reverse, dish, item] = await tx.getAll(this.linkRef(command.itemId), this.reverseLinkRef(command.dishId), this.db.collection("fikaMenuPlanningCatalogue").doc(command.dishId), this.db.collection("integrationHubCanonical").doc(stableDocumentId(command.itemId)));
      if (existing.exists) {
        const link = existing.data() as DishLink;
        if (link.dishId === command.dishId && link.classification === command.classification) return { link, replayed: true };
        throw rotationProblem(`Item ${command.itemId} is already linked to dish ${link.dishId}`, 409);
      }
      if (reverse.exists) throw rotationProblem(`Dish ${command.dishId} is already linked to Item ${(reverse.data() as DishLink).itemId}`, 409);
      assertActiveItem(item.data(), command.itemId);
      const record = assertRotationDish(dish.data(), command.dishId);
      if (record.hospitalityClass && record.hospitalityClass !== command.classification) throw rotationProblem("Classification does not match the dish's recorded hospitality class");
      const link: DishLink = { schema: "hospitality-rotation-dish-link.v1", itemId: command.itemId, dishId: command.dishId, classification: command.classification, actorId, recordedAt: at, requestId: command.requestId };
      tx.create(this.linkRef(command.itemId), link);
      tx.create(this.reverseLinkRef(command.dishId), link);
      return { link, replayed: false };
    });
  }
  async published(date: string) {
    BusinessDate.parse(date);
    const head = await this.head();
    const number = publishedRevisionFor(head, date);
    if (!number) throw rotationProblem("No published rotation for this event date", 404);
    return { schema: ROTATIONS_SCHEMA, version: head.version, eventDate: date, revision: await this.revision(number) };
  }
  /** Caller is server-authorised before entry. Replay is actor-bound and still requires current permission. */
  async command(actorId: string, raw: unknown) {
    const command = RotationCommand.parse(raw);
    const fingerprint = hash({ actorId, command });
    const receipt = this.root().collection("commands").doc(hash({ actorId, requestId: command.requestId }));
    const at = this.now();
    return this.db.runTransaction(async tx => {
      const [headSnapshot, replay] = await tx.getAll(this.root(), receipt);
      if (replay.exists) {
        if (replay.data()!.fingerprint !== fingerprint) throw rotationProblem("Request ID reused for different content", 409);
        return { version: replay.data()!.version as number, revision: replay.data()!.revision as number, replayed: true };
      }
      const head = headSnapshot.data() as RotationHead || initialHead();
      if (head.version !== command.expectedVersion) throw rotationProblem("Rotation changed elsewhere; reload before saving", 409);
      const version = head.version + 1;
      let revision: RotationRevision;
      let next: RotationHead;
      if (command.action === "save-draft") {
        revision = { schema: ROTATIONS_SCHEMA, revision: version, status: "draft", configuration: command.configuration, actorId, recordedAt: at.toISOString(), requestId: command.requestId };
        next = { ...head, version, draftRevision: version };
      } else {
        const draftValue = (await tx.get(this.revisionRef(command.draftRevision))).data();
        if (!draftValue) throw rotationProblem("Publish requires the current draft", 409);
        const draft = checkedRevision(draftValue, command.draftRevision);
        if (draft.status !== "draft" || head.draftRevision !== command.draftRevision) throw rotationProblem("Publish requires the current draft", 409);
        if (command.effectiveFrom < londonDate(at)) throw rotationProblem("Publication cannot rewrite past event dates");
        if (head.activations.some(entry => entry.effectiveFrom >= command.effectiveFrom)) throw rotationProblem("Activation dates must append after the existing calendar", 409);
        if (head.activations.length >= 100) throw rotationProblem("Activation manifest limit reached; archive design required", 409);
        const configuration = RotationConfiguration.parse(draft.configuration);
        const recipes = await freezeProviders(this.db, tx, configuration);
        revision = { schema: ROTATIONS_SCHEMA, revision: version, status: "published", configuration, recipes, actorId, recordedAt: at.toISOString(), requestId: command.requestId, reason: command.reason, sourceDraftRevision: draft.revision, effectiveFrom: command.effectiveFrom };
        next = { ...head, version, activations: [...head.activations, { effectiveFrom: command.effectiveFrom, revision: version }] };
      }
      if (Buffer.byteLength(JSON.stringify(revision)) > 700_000) throw rotationProblem("Rotation revision exceeds the supported evidence size");
      // Immutable revision doubles as the durable business event; all three writes are atomic.
      tx.create(this.revisionRef(version), { ...revision, evidenceHash: hash(revision) });
      tx.set(this.root(), next);
      tx.create(receipt, { fingerprint, actorId, action: command.action, source: "hospitality-rotations", expectedVersion: head.version, version, revision: version, recordedAt: at.toISOString() });
      return { version, revision: version, replayed: false };
    });
  }
}
