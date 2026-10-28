import { createHash } from "node:crypto";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { BusinessDate, ROTATIONS_SCHEMA, RotationCommand, RotationConfiguration, londonDate, publishedRevisionFor, type RotationHead, type RotationRevision } from "../../../shared/hospitality-rotations";

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
    if (!item || item.canonicalId !== group.itemId || item.entityType !== "Hospitality Menu Item" || item.lifecycleStatus === "archived" || item.record?.lifecycleState === "archived" || item.publicationStatus === "withdrawn") throw rotationProblem(`Canonical Item ${group.itemId} is unavailable`, 409);
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
