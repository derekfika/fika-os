import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MenuItem } from "./domain";
import { deterministicId } from "./domain";
import { normaliseDishCategory } from "./dish-categories";
import { normaliseDishName } from "./text";
import type { RollingEntry } from "./rolling-menu-types";
import { appDataPath } from "./fika-contracts";
import { assertOperationalStoreAvailable } from "./hosted-runtime";
import { Firestore } from "@google-cloud/firestore";
import { recordMenuPlanningReadBudget } from "./read-budget";
import { getCatalogueManifest } from "./catalogue-manifest";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { catalogueUsagesFor } from "./catalogue-usage";

const filePath = appDataPath("menu-planning", "menu-planning", "canonical-menu-items.json");
const HOSTED_CATALOGUE_TTL_MS = 60_000;
let hostedCatalogueCache: { expiresAt: number; items: MenuItem[] } | undefined;
const hostedCatalogue = () => ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");

async function readItems(): Promise<MenuItem[]> {
  if (hostedCatalogue()) {
    if (!process.env.FIREBASE_PROJECT_ID && !process.env.GCLOUD_PROJECT) throw Object.assign(new Error("Hosted Menu Planning catalogue is not configured."), { status: 503 });
    if (hostedCatalogueCache && hostedCatalogueCache.expiresAt > Date.now()) {
      recordDataAccess({ app: "menu-planning", operation: "catalogue.app-cache", source: "APP_CACHE", documents: hostedCatalogueCache.items.length, cacheHit: true });
      recordMenuPlanningReadBudget({ operation: "catalogue", reads: { cacheHit: 1, documents: hostedCatalogueCache.items.length } });
      return structuredClone(hostedCatalogueCache.items);
    }
    const snapshot = await new Firestore({ projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT }).collection("fikaMenuPlanningCatalogue").where("kind", "==", "dish").get();
    recordDataAccess({ app: "menu-planning", operation: "catalogue.list", source: "FIRESTORE", documents: snapshot.size });
    const items = snapshot.docs.map(document => (document.data().record || document.data()) as MenuItem);
    hostedCatalogueCache = { expiresAt: Date.now() + HOSTED_CATALOGUE_TTL_MS, items: structuredClone(items) };
    recordMenuPlanningReadBudget({ operation: "catalogue", reads: { cacheHit: 0, documents: items.length, ttlMs: HOSTED_CATALOGUE_TTL_MS } });
    return structuredClone(items);
  }
  assertOperationalStoreAvailable();
  try {
    const value = JSON.parse(await readFile(filePath, "utf8")) as { items?: MenuItem[] };
    const items = Array.isArray(value.items) ? value.items : [];
    recordDataAccess({ app: "menu-planning", operation: "catalogue.static", source: "STATIC", documents: items.length });
    return items;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw Object.assign(new Error("Canonical menu catalogue is unavailable; no catalogue was loaded.", { cause }), { status: 503 });
  }
}

const hosted = hostedCatalogue;
export function invalidateHostedCatalogueCache() { hostedCatalogueCache = undefined; }
const hostedDb = () => {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
  if (!projectId) throw Object.assign(new Error("Hosted Menu Planning catalogue is not configured."), { status: 503 });
  return new Firestore({ projectId });
};
const hostedDocument = (item: MenuItem) => ({ id: item.canonicalId, kind: "dish", source: "menu-planning-local", record: item, reconciliationStatus: "reconciled", schemaVersion: "1.0.0" });
const recordsEqual = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
async function publishItemsBestEffort(items: MenuItem[]) {
  try {
    const { publishCataloguePackage } = await import("./catalogue-read-package");
    const entries = items.filter(item => item.reviewStatus !== "archived").map(item => ({
      id: item.canonicalId, kind: "canonical" as const, name: item.displayName, description: item.description || item.preparationDescription,
      category: normaliseDishCategory(item.category || item.subcategory), subcategory: item.subcategory, usage: catalogueUsagesFor(item),
      status: item.recipeStatus || item.reviewStatus, reviewStatus: item.reviewStatus, sourceLabel: item.sourceName,
      sourceEvidence: `${item.sourceReference.workbook} · ${item.sourceReference.sheet}`,
      recipeAvailable: Boolean(item.ingredients?.length || item.methodSteps?.length || item.preparationDescription),
      allergenCount: item.allergenEvidence.filter(evidence => evidence.value !== "unknown").length, item,
    }));
    await publishCataloguePackage(entries);
  } catch (error) { console.warn("[FIKA_SNAPSHOT_STALE] canonical catalogue mutation succeeded but package publication failed", error); }
}

async function writeItems(items: MenuItem[]) {
  if (hosted()) {
    const db = hostedDb();
    const current = await db.collection("fikaMenuPlanningCatalogue").where("kind", "==", "dish").get();
    const currentById = new Map(current.docs.map(document => [document.id, document.data()]));
    const changed = items.filter(item => !recordsEqual(currentById.get(item.canonicalId)?.record, item));
    if (!changed.length) return;
    await db.runTransaction(async transaction => {
      const refs = changed.map(item => db.collection("fikaMenuPlanningCatalogue").doc(item.canonicalId));
      const latest = await transaction.getAll(...refs);
      latest.forEach((document, index) => {
        const item = changed[index];
        const existing = document.exists ? document.data() : undefined;
        const existingRecord = existing?.record as MenuItem | undefined;
        if (existingRecord && existingRecord.revision > item.revision && existingRecord.reviewStatus !== "unreviewed") return;
        transaction.set(refs[index], { ...(existing || hostedDocument(item)), id: item.canonicalId, kind: "dish", record: item }, { merge: true });
      });
      });
    invalidateHostedCatalogueCache();
    await publishItemsBestEffort(items);
    return;
  }
  assertOperationalStoreAvailable();
  await mkdir(path.dirname(filePath), { recursive: true });
  const normalised = items.map(item => ({ ...item, displayName: normaliseDishName(item.displayName) }));
  let version = 0;
  try { version = Number((JSON.parse(await readFile(filePath, "utf8")) as { version?: number }).version || 0); } catch { /* First local catalogue write. */ }
  await writeFile(filePath, JSON.stringify({ version: version + 1, updatedAt: new Date().toISOString(), items: normalised }, null, 2) + "\n", "utf8");
  await publishItemsBestEffort(normalised);
}

export { getCatalogueManifest };

export async function listCanonicalMenuItems() { return readItems(); }

export async function listCanonicalMenuItemsByIds(ids: string[]) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return [];
  if (["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "")) {
    if (!process.env.FIREBASE_PROJECT_ID && !process.env.GCLOUD_PROJECT) throw Object.assign(new Error("Hosted Menu Planning catalogue is not configured."), { status: 503 });
    const db = new Firestore({ projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT });
    const records = await Promise.all(Array.from(
      { length: Math.ceil(wanted.length / 100) },
      (_, index) => db.getAll(...wanted.slice(index * 100, index * 100 + 100).map(id => db.collection("fikaMenuPlanningCatalogue").doc(id))),
    ));
    recordDataAccess({ app: "menu-planning", operation: "catalogue.by-id.batch", source: "FIRESTORE", documents: records.flat().filter(document => document.exists && document.data()?.kind === "dish").length });
    return records.flatMap(documents => documents.filter(document => document.exists && document.data()?.kind === "dish").map(document => (document.data()!.record || document.data()) as MenuItem));
  }
  const items = await readItems();
  return items.filter(item => wanted.includes(item.canonicalId));
}

export async function getCanonicalMenuItemById(id: string) {
  const cleanId = id.trim();
  if (!cleanId) return undefined;
  if (hosted()) {
    if (!process.env.FIREBASE_PROJECT_ID && !process.env.GCLOUD_PROJECT) throw Object.assign(new Error("Hosted Menu Planning catalogue is not configured."), { status: 503 });
    const document = await new Firestore({ projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT }).collection("fikaMenuPlanningCatalogue").doc(cleanId).get();
    recordDataAccess({ app: "menu-planning", operation: "catalogue.by-id", source: "FIRESTORE", documents: document.exists && document.data()?.kind === "dish" ? 1 : 0 });
    if (!document.exists || document.data()?.kind !== "dish") return undefined;
    return (document.data()!.record || document.data()) as MenuItem;
  }
  return (await readItems()).find(item => item.canonicalId === cleanId);
}

export async function recordDishSourceAliases(aliasesById: Record<string, string[]>, actor = "menu-planning-importer") {
  const items = await readItems(); const at = new Date().toISOString(); let changed = 0;
  for (const item of items) {
    const aliases = [...new Set((aliasesById[item.canonicalId] || []).map(value => value.trim()).filter(value => value && value.toLocaleLowerCase() !== item.displayName.toLocaleLowerCase()))];
    if (!aliases.length) continue;
    const next = [...new Set([...(item.sourceAliases || []), ...aliases])];
    if (next.length === (item.sourceAliases || []).length) continue;
    item.sourceAliases = next; item.revision += 1; item.audit.push({ action: "legacy-workbook-dish-alias-confirmed", at, by: actor }); changed += 1;
  }
  if (changed) await writeItems(items);
  return changed;
}

export async function createCanonicalMenuItem(input: { displayName: string; category?: string; description?: string; preparationNotes?: string; allergenEvidence?: MenuItem["allergenEvidence"] }, actor = "local-menu-planner") {
  if (hosted() && /(?:^|[-_:])(?:test|fixture|synthetic|e2e)(?:$|[-_:])/i.test(actor)) throw Object.assign(new Error("Synthetic catalogue writes are not allowed in hosted Menu Planning."), { status: 403 });
  const items = await readItems();
  const displayName = normaliseDishName(input.displayName);
  const existing = items.find(item => item.displayName.trim().toLocaleLowerCase() === displayName.toLocaleLowerCase());
  if (existing) { if (existing.displayName !== displayName) { existing.displayName = displayName; await writeItems(items); } return existing; }
  const at = new Date().toISOString();
  const item: MenuItem = {
    canonicalId: deterministicId("menu-item", "local", displayName),
    sourceName: displayName,
    displayName,
    description: input.description?.trim() || undefined,
    preparationNotes: input.preparationNotes?.trim() || undefined,
    category: normaliseDishCategory(input.category),
    weekId: "menu-week:menu-planning",
    dayId: "",
    sourceReference: { workbook: "Menu Planning", sheet: "Local dish creation" },
    revision: 1,
    reviewStatus: "unreviewed",
    allergenEvidence: input.allergenEvidence || [],
    mayContainReviewed: Boolean(input.allergenEvidence?.length),
    audit: [{ action: "locally-created-in-menu-planning", at, by: actor }],
  };
  items.push(item);
  await writeItems(items);
  return item;
}

/** Promote imported rolling-menu labels into reusable records once, without replacing reviewed records. */
export async function syncRollingEntries(entries: RollingEntry[], actor = "rolling-menu-migration") {
  const items = await readItems();
  let changed = false;
  for (const entry of entries) {
    const name = normaliseDishName(entry.itemLabel);
    if (!name) continue;
    const existing = items.find(item => item.canonicalId === entry.itemId || item.displayName.toLowerCase() === name.toLowerCase());
    const at = new Date().toISOString();
    const allergenEvidence = Object.entries(entry.allergens || {})
      .filter(([, value]) => value !== "clear")
      .map(([allergen, value]) => ({ allergen, value: value === "may_contain" ? "may_contain" as const : "contains" as const, source: entry.source?.workbook || "Imported rolling menu", reviewedBy: actor, reviewedAt: at }));
    if (existing) {
      const reviewed = existing.reviewStatus !== "unreviewed" || existing.mayContainReviewed;
      if (existing.displayName !== name && !reviewed) { existing.displayName = name; changed = true; }
      if (!existing.mayContainReviewed && Object.keys(entry.allergens || {}).length) {
        existing.allergenEvidence = allergenEvidence;
        existing.mayContainReviewed = true;
        existing.audit.push({ action: "rolling-allergen-review-restored", at, by: actor });
        changed = true;
      }
      continue;
    }
    items.push({
      canonicalId: entry.itemId || deterministicId("menu-item", "rolling", name),
      sourceName: name,
      displayName: name,
      category: normaliseDishCategory(entry.slot),
      weekId: "menu-week:rolling-import",
      dayId: "",
      sourceReference: { workbook: entry.source?.workbook || "rolling menu", sheet: entry.source?.sheet || entry.slot, range: entry.source?.range },
      revision: 1,
      reviewStatus: "unreviewed",
      allergenEvidence,
      mayContainReviewed: Object.keys(entry.allergens || {}).length > 0,
      audit: [{ action: "rolling-menu-item-promoted", at, by: actor }],
    });
    changed = true;
  }
  if (changed) await writeItems(items);
  return items;
}

export function canonicalFromSourceCandidate(candidate: MenuItem, actor = "local-menu-reviewer", at = new Date().toISOString()): MenuItem {
  return {
    ...structuredClone(candidate),
    displayName: normaliseDishName(candidate.displayName),
    category: normaliseDishCategory(candidate.category),
    reviewStatus: "unreviewed",
    recipeStatus: "draft",
    weekId: "menu-week:canonical-catalogue",
    dayId: "",
    audit: [...candidate.audit, { action: "menu-item-promoted-from-source-candidate", at, by: actor }],
  };
}

export async function promoteSourceCandidate(candidate: MenuItem, actor = "local-menu-reviewer") {
  const items = await readItems();
  const existing = items.find((item) => item.canonicalId === candidate.canonicalId);
  if (existing) { const displayName = normaliseDishName(existing.displayName); if (existing.displayName !== displayName) { existing.displayName = displayName; await writeItems(items); } return existing; }
  const item = canonicalFromSourceCandidate(candidate, actor);
  items.push(item);
  await writeItems(items);
  return item;
}

const mergeNoise = new Set(["salad", "dish", "main", "protein", "breast", "leaf", "leaves", "fresh", "style", "styled"]);
const stemMergeToken = (token: string) => {
  if (token.endsWith("ies") && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith("es") && token.length > 5) return token.slice(0, -2);
  if (token.endsWith("s") && token.length > 4) return token.slice(0, -1);
  return token;
};
const mergeTokens = (value: string) => normaliseDishName(value).toLocaleLowerCase("en-GB").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean).map(stemMergeToken).filter(token => !mergeNoise.has(token));
const mergeKey = (value: string) => [...new Set(mergeTokens(value))].sort().join(" ");
const levenshtein = (left: string, right: string) => {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column++) {
      const above = previous[column];
      previous[column] = left[row - 1] === right[column - 1] ? diagonal : Math.min(diagonal + 1, above + 1, previous[column - 1] + 1);
      diagonal = above;
    }
  }
  return previous[right.length];
};
const similarDishNames = (left: string, right: string) => {
  const leftTokens = new Set(mergeTokens(left));
  const rightTokens = new Set(mergeTokens(right));
  if (!leftTokens.size || !rightTokens.size) return false;
  const overlap = [...leftTokens].filter(token => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const containment = overlap / Math.min(leftTokens.size, rightTokens.size);
  const jaccard = overlap / union;
  const leftKey = [...leftTokens].sort().join("");
  const rightKey = [...rightTokens].sort().join("");
  const editSimilarity = 1 - levenshtein(leftKey, rightKey) / Math.max(leftKey.length, rightKey.length);
  // The catalogue is deliberately forgiving: two shared ingredients in the same
  // governed category are enough to treat a dish as a likely naming variant.
  return (leftTokens.size >= 3 && overlap >= 2 && (jaccard >= 0.35 || containment >= 0.5)) || (leftTokens.size >= 3 && (jaccard >= 0.58 || (containment >= 0.76 && editSimilarity >= 0.62))) || editSimilarity >= 0.91;
};
const richness = (item: MenuItem) => Number(item.mayContainReviewed) * 100 + item.allergenEvidence.length * 5 + Number(Boolean(item.ingredients?.length)) * 3 + Number(Boolean(item.description || item.preparationDescription || item.methodSteps?.length));

const allergenEvidenceKey = (evidence: MenuItem["allergenEvidence"][number]) => `${evidence.allergen.toLocaleLowerCase()}|${evidence.value}|${evidence.source.toLocaleLowerCase()}|${evidence.reviewedBy || ""}`;
const mergeAllergenEvidence = (items: MenuItem[]) => [...new Map(items.flatMap(item => item.allergenEvidence).map(evidence => [allergenEvidenceKey(evidence), evidence])).values()];

/** Returns fuzzy groups for deliberate review without changing the catalogue. */
export async function previewSimilarCanonicalItems() {
  const active = (await readItems()).filter(item => item.reviewStatus !== "archived"); const groups: MenuItem[][] = [];
  for (const item of active) { const category = normaliseDishCategory(item.category); const matching = groups.find(group => normaliseDishCategory(group[0].category) === category && group.some(candidate => similarDishNames(candidate.displayName, item.displayName))); if (matching) matching.push(item); else groups.push([item]); }
  return groups.filter(group => group.length > 1).map(group => { const ordered = group.slice().sort((a, b) => richness(b) - richness(a) || a.displayName.length - b.displayName.length); return { category: normaliseDishCategory(ordered[0].category), survivor: { id: ordered[0].canonicalId, name: ordered[0].displayName }, candidates: ordered.map(item => ({ id: item.canonicalId, name: item.displayName, allergenCount: item.allergenEvidence.length, hasRecipe: Boolean(item.ingredients?.length || item.methodSteps?.length || item.preparationDescription) })) }; });
}

export async function mergeSimilarCanonicalItems(actor = "automatic-dish-normaliser", selectedIds?: Set<string>) {
  const items = await readItems();
  const inScope = (item: MenuItem) => !selectedIds || selectedIds.has(item.canonicalId);
  const active = items.filter(item => item.reviewStatus !== "archived" && inScope(item));
  const groups: MenuItem[][] = [];
  for (const item of active) {
    const category = normaliseDishCategory(item.category);
    const matching = groups.find(group => normaliseDishCategory(group[0].category) === category && group.some(candidate => similarDishNames(candidate.displayName, item.displayName)));
    if (matching) matching.push(item);
    else { const group = [item]; groups.push(group); }
  }
  const mapping: Record<string, string> = {};
  let merged = 0;
  for (const candidates of groups) {
    if (candidates.length < 2) continue;
    const winner = candidates.slice().sort((a, b) => richness(b) - richness(a) || a.displayName.length - b.displayName.length)[0];
    const at = new Date().toISOString();
    winner.allergenEvidence = mergeAllergenEvidence(candidates);
    winner.mayContainReviewed = candidates.some(item => item.mayContainReviewed);
    for (const loser of candidates) { if (loser.canonicalId === winner.canonicalId) continue; mapping[loser.canonicalId] = winner.canonicalId; loser.reviewStatus = "archived"; loser.recipeStatus = "archived"; loser.audit.push({ action: "automatically-merged-into-canonical-dish", at, by: actor }); merged += 1; }
    winner.audit.push({ action: "automatic-dish-merge-survivor", at: new Date().toISOString(), by: actor });
  }
  const winners = new Map<string, MenuItem>();
  for (const item of items.filter(item => item.reviewStatus !== "archived" && inScope(item))) { const key = `${normaliseDishCategory(item.category)}|${mergeKey(item.displayName)}`; if (key.endsWith("|")) continue; winners.set(key, item); }
  const aliases: Record<string, string> = {};
  for (const item of items.filter(inScope)) { const winner = winners.get(`${normaliseDishCategory(item.category)}|${mergeKey(item.displayName)}`); if (winner && winner.canonicalId !== item.canonicalId) { mapping[item.canonicalId] = winner.canonicalId; aliases[item.displayName.toLocaleLowerCase()] = winner.displayName; } }
  if (merged) await writeItems(items);
  return { mapping, aliases, merged };
}
