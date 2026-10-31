import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Firestore } from "@google-cloud/firestore";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { appDataPath } from "./fika-contracts";
import { assertOperationalStoreAvailable } from "./hosted-runtime";
import { addTag, emptyDishTagRegistry, mergeSeedTags, type AddTagOutcome, type DishTag, type DishTagInput, type DishTagRegistry } from "./dish-tags";

/**
 * One small versioned document holds the whole registry (a few hundred short tags), so a read is
 * one document and a write is one transaction. It lives beside the dish documents in the existing
 * catalogue collection under its own `kind`, so the dish listing (`kind == "dish"`) never sees it.
 */
const COLLECTION = "fikaMenuPlanningCatalogue";
const REGISTRY_ID = "dish-tag-registry";
const localPath = appDataPath("menu-planning", "menu-planning", "dish-tag-registry.json");
const hosted = () => ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");

function hostedDb() {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
  if (!projectId) throw Object.assign(new Error("Hosted Menu Planning catalogue is not configured."), { status: 503 });
  return new Firestore({ projectId });
}

function coerce(value: unknown): DishTagRegistry {
  const record = value as Partial<DishTagRegistry> | undefined;
  if (!record || !Array.isArray(record.tags)) return emptyDishTagRegistry();
  return { schemaVersion: 1, version: Number(record.version) || 0, tags: record.tags as DishTag[] };
}

export async function readDishTagRegistry(): Promise<DishTagRegistry> {
  if (hosted()) {
    const document = await hostedDb().collection(COLLECTION).doc(REGISTRY_ID).get();
    recordDataAccess({ app: "menu-planning", operation: "dish-tags.read", source: "FIRESTORE", documents: document.exists ? 1 : 0 });
    return document.exists ? coerce(document.data()?.registry) : emptyDishTagRegistry();
  }
  assertOperationalStoreAvailable();
  try {
    return coerce(JSON.parse(await readFile(localPath, "utf8")));
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return emptyDishTagRegistry();
    throw Object.assign(new Error("The dish tag registry is unavailable.", { cause }), { status: 503 });
  }
}

class VersionConflict extends Error { status = 409 as const; }

/**
 * Apply a pure registry change under optimistic concurrency. `expectedVersion` (when the caller
 * supplies it) must match the stored version; otherwise the caller is told to refresh. A change
 * that produces no new tag writes nothing, so replays and double clicks are free and idempotent.
 */
export async function createDishTag(input: DishTagInput, actor: string, expectedVersion?: number): Promise<{ tag: DishTag; outcome: AddTagOutcome; registry: DishTagRegistry }> {
  const at = new Date().toISOString();
  const apply = (current: DishTagRegistry) => {
    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      // An equivalent tag created concurrently is still a success for the caller.
      const probe = addTag(current, input, actor, at);
      if (probe.outcome === "existing") return { ...probe, write: false };
      throw new VersionConflict("The tag list changed while you were editing. Refresh and try again.");
    }
    const result = addTag(current, input, actor, at);
    return { ...result, write: result.outcome === "created" };
  };

  if (hosted()) {
    const db = hostedDb();
    const ref = db.collection(COLLECTION).doc(REGISTRY_ID);
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const current = snapshot.exists ? coerce(snapshot.data()?.registry) : emptyDishTagRegistry();
      const result = apply(current);
      if (!result.write) return { tag: result.tag, outcome: result.outcome, registry: current };
      const registry: DishTagRegistry = { ...result.registry, version: current.version + 1 };
      transaction.set(ref, { id: REGISTRY_ID, kind: "dish-tag-registry", schemaVersion: "1.0.0", registry, updatedAt: at, updatedBy: actor });
      recordDataAccess({ app: "menu-planning", operation: "dish-tags.write", source: "FIRESTORE", documents: 1 });
      return { tag: result.tag, outcome: result.outcome, registry };
    });
  }

  assertOperationalStoreAvailable();
  const current = await readDishTagRegistry();
  const result = apply(current);
  if (!result.write) return { tag: result.tag, outcome: result.outcome, registry: current };
  const registry: DishTagRegistry = { ...result.registry, version: current.version + 1 };
  await mkdir(path.dirname(localPath), { recursive: true });
  const temporary = `${localPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(registry, null, 2));
  await rename(temporary, localPath);
  return { tag: result.tag, outcome: result.outcome, registry };
}

/**
 * Additive seed in one transaction (or one atomic file write). Adds only tags that do not already
 * exist; never edits or removes one. Re-running it is a no-op that writes nothing.
 */
export async function seedDishTags(seeds: readonly DishTagInput[], actor: string, options: { dryRun?: boolean } = {}): Promise<{ added: DishTag[]; registry: DishTagRegistry; wrote: boolean }> {
  const at = new Date().toISOString();
  if (hosted()) {
    const db = hostedDb();
    const ref = db.collection(COLLECTION).doc(REGISTRY_ID);
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      const current = snapshot.exists ? coerce(snapshot.data()?.registry) : emptyDishTagRegistry();
      const merged = mergeSeedTags(current, seeds, actor, at);
      if (!merged.added.length || options.dryRun) return { added: merged.added, registry: current, wrote: false };
      const registry: DishTagRegistry = { ...merged.registry, version: current.version + 1 };
      transaction.set(ref, { id: REGISTRY_ID, kind: "dish-tag-registry", schemaVersion: "1.0.0", registry, updatedAt: at, updatedBy: actor });
      recordDataAccess({ app: "menu-planning", operation: "dish-tags.seed", source: "FIRESTORE", documents: 1 });
      return { added: merged.added, registry, wrote: true };
    });
  }
  assertOperationalStoreAvailable();
  const current = await readDishTagRegistry();
  const merged = mergeSeedTags(current, seeds, actor, at);
  if (!merged.added.length || options.dryRun) return { added: merged.added, registry: current, wrote: false };
  const registry: DishTagRegistry = { ...merged.registry, version: current.version + 1 };
  await mkdir(path.dirname(localPath), { recursive: true });
  const temporary = `${localPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(registry, null, 2));
  await rename(temporary, localPath);
  return { added: merged.added, registry, wrote: true };
}
