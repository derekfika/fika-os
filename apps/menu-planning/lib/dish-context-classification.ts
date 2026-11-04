import { Firestore } from "@google-cloud/firestore";
import type { MenuItem } from "./domain";
import { dishCategoryForWrite } from "./dish-categories";
import { createDishTag } from "./dish-tag-store";
import { invalidateHostedCatalogueCache, listCanonicalMenuItemsByIds, sanitiseFirestoreValue, updateCanonicalMenuItem } from "./canonical-menu-repository";
import { catalogueSourceHash, CATALOGUE_SOURCE_HASH_VERSION } from "./catalogue-source";
import { markCataloguePackageFailed } from "./catalogue-manifest";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";

/** Add a many-use registry tag without changing primary category, prior tags or safety evidence. */
export function addUseTag(item: MenuItem, tagId: string, actor: string, at = new Date().toISOString()): MenuItem {
  if (item.reviewStatus === "archived") throw Object.assign(new Error("This dish is archived."), { status: 409 });
  if (item.tagIds?.includes(tagId)) return item;
  if ((item.tagIds?.length || 0) >= 30) throw Object.assign(new Error("This dish already has the maximum number of tags."), { status: 422 });
  return { ...item, tagIds: [...(item.tagIds || []), tagId], revision: item.revision + 1, audit: [...item.audit, { action: `dish-use-classification-added:${tagId}`, by: actor, at }] };
}
export async function addDishUseClassification(dishId: string, categoryInput: string, actor: string) {
  const category = dishCategoryForWrite(categoryInput);
  if (!dishId || dishId.includes("/")) throw Object.assign(new Error("A stable dish ID is required."), { status: 422 });
  const { tag } = await createDishTag({ label: `Menu use: ${category}`, group: "type" }, actor);
  if (!["production", "staging"].includes(process.env.FIKA_RUNTIME_MODE || "")) {
    const item = (await listCanonicalMenuItemsByIds([dishId]))[0];
    if (!item) throw Object.assign(new Error("The dish was not found."), { status: 404 });
    const updated = addUseTag(item, tag.id, actor);
    if (updated === item) return { item, tag };
    return { item: await updateCanonicalMenuItem(dishId, { ...item, tagIds: updated.tagIds }, actor), tag };
  }
  const db = new Firestore({ projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT });
  // Canonical catalogue source hashes cover the catalogue. This deliberate classification
  // command uses its existing bounded mutation pattern; there are no new read/poll paths.
  const result = await db.runTransaction(async transaction => {
    const manifestRef = db.collection("fikaMenuPlanningCatalogueManifests").doc("catalogue");
    const manifest = await transaction.get(manifestRef);
    const catalogue = await transaction.get(db.collection("fikaMenuPlanningCatalogue").where("kind", "==", "dish"));
    recordDataAccess({ app: "menu-planning", operation: "catalogue.use-classification", source: "FIRESTORE", documents: catalogue.size + 1, firestoreReadKind: "transaction" });
    const items = catalogue.docs.map(document => (document.data().record || document.data()) as MenuItem);
    const item = items.find(item => item.canonicalId === dishId);
    if (!item) throw Object.assign(new Error("The dish was not found."), { status: 404 });
    const updated = addUseTag(item, tag.id, actor);
    if (updated === item) return { item, source: undefined };
    const sourceRevision = Number(manifest.data()?.sourceRevision ?? manifest.data()?.catalogueVersion ?? 0) + 1;
    const sourceHash = catalogueSourceHash(items.map(item => item.canonicalId === dishId ? updated : item));
    const at = new Date().toISOString();
    transaction.set(db.collection("fikaMenuPlanningCatalogue").doc(dishId), sanitiseFirestoreValue({ record: updated }), { merge: true });
    transaction.set(manifestRef, { schemaVersion: 1, sourceHashVersion: CATALOGUE_SOURCE_HASH_VERSION, catalogueVersion: sourceRevision, sourceRevision, sourceHash, updatedAt: at, lastMutationBy: actor, dishCount: items.length, packageState: { status: "pending", sourceRevision, sourceHash, requestedAt: at, updatedAt: at, attempts: 0 } }, { merge: true });
    return { item: updated, source: { sourceRevision, sourceHash } };
  });
  invalidateHostedCatalogueCache();
  if (result.source) {
    try { const { materialiseCataloguePackage } = await import("./catalogue-read-package"); await materialiseCataloguePackage(undefined, result.source); }
    catch (cause) { await markCataloguePackageFailed(result.source, cause); }
  }
  return { item: result.item, tag };
}
