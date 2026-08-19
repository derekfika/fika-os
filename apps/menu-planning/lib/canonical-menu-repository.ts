import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MenuItem } from "./domain";
import { deterministicId } from "./domain";
import { normaliseDishCategory } from "./dish-categories";
import { titleCase } from "./text";
import type { RollingEntry } from "./rolling-menu-types";

const filePath = path.join(process.cwd(), "local-data", "menu-planning", "canonical-menu-items.json");

async function readItems(): Promise<MenuItem[]> {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8")) as { items?: MenuItem[] };
    return Array.isArray(value.items) ? value.items : [];
  } catch {
    return [];
  }
}

async function writeItems(items: MenuItem[]) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const normalised = items.map(item => ({ ...item, displayName: titleCase(item.displayName) }));
  await writeFile(filePath, JSON.stringify({ version: 1, items: normalised }, null, 2) + "\n", "utf8");
}

export async function listCanonicalMenuItems() { return readItems(); }

export async function createCanonicalMenuItem(input: { displayName: string; category?: string; description?: string; preparationNotes?: string; allergenEvidence?: MenuItem["allergenEvidence"] }, actor = "local-menu-planner") {
  const items = await readItems();
  const displayName = titleCase(input.displayName);
  const existing = items.find(item => item.displayName.trim().toLocaleLowerCase() === displayName.toLocaleLowerCase());
  if (existing) { if (existing.displayName !== displayName) { existing.displayName = displayName; await writeItems(items); } return existing; }
  const at = new Date().toISOString();
  const item: MenuItem = {
    canonicalId: deterministicId("menu-item", "local", displayName, at),
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
    const name = titleCase(entry.itemLabel.trim());
    if (!name) continue;
    const existing = items.find(item => item.canonicalId === entry.itemId || item.displayName.toLowerCase() === name.toLowerCase());
    const at = new Date().toISOString();
    const allergenEvidence = Object.entries(entry.allergens || {})
      .filter(([, value]) => value !== "clear")
      .map(([allergen, value]) => ({ allergen, value: value === "may_contain" ? "may_contain" as const : "contains" as const, source: entry.source?.workbook || "Imported rolling menu", reviewedBy: actor, reviewedAt: at }));
    if (existing) {
      if (existing.displayName !== name) { existing.displayName = name; changed = true; }
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
    displayName: titleCase(candidate.displayName),
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
  if (existing) { const displayName = titleCase(existing.displayName); if (existing.displayName !== displayName) { existing.displayName = displayName; await writeItems(items); } return existing; }
  const item = canonicalFromSourceCandidate(candidate, actor);
  items.push(item);
  await writeItems(items);
  return item;
}

const mergeNoise = new Set(["salad", "dish", "main", "protein", "breast", "leaf", "leaves"]);
const mergeKey = (value: string) => value.toLocaleLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean).filter(token => !mergeNoise.has(token)).sort().join(" ");
const richness = (item: MenuItem) => Number(item.mayContainReviewed) * 100 + item.allergenEvidence.length * 5 + Number(Boolean(item.ingredients?.length)) * 3 + Number(Boolean(item.description || item.preparationDescription || item.methodSteps?.length));

export async function mergeSimilarCanonicalItems(actor = "automatic-dish-normaliser") {
  const items = await readItems();
  const active = items.filter(item => item.reviewStatus !== "archived");
  const groups = new Map<string, MenuItem[]>();
  for (const item of active) { const key = `${normaliseDishCategory(item.category)}|${mergeKey(item.displayName)}`; if (key.endsWith("|")) continue; groups.set(key, [...(groups.get(key) || []), item]); }
  const mapping: Record<string, string> = {};
  let merged = 0;
  for (const candidates of groups.values()) {
    if (candidates.length < 2) continue;
    const winner = candidates.slice().sort((a, b) => richness(b) - richness(a) || a.displayName.length - b.displayName.length)[0];
    for (const loser of candidates) { if (loser.canonicalId === winner.canonicalId) continue; mapping[loser.canonicalId] = winner.canonicalId; loser.reviewStatus = "archived"; loser.recipeStatus = "archived"; loser.audit.push({ action: "automatically-merged-into-canonical-dish", at: new Date().toISOString(), by: actor }); merged += 1; }
    winner.audit.push({ action: "automatic-dish-merge-survivor", at: new Date().toISOString(), by: actor });
  }
  const winners = new Map<string, MenuItem>();
  for (const item of items.filter(item => item.reviewStatus !== "archived")) { const key = `${normaliseDishCategory(item.category)}|${mergeKey(item.displayName)}`; if (key.endsWith("|")) continue; winners.set(key, item); }
  const aliases: Record<string, string> = {};
  for (const item of items) { const winner = winners.get(`${normaliseDishCategory(item.category)}|${mergeKey(item.displayName)}`); if (winner && winner.canonicalId !== item.canonicalId) { mapping[item.canonicalId] = winner.canonicalId; aliases[item.displayName.toLocaleLowerCase()] = winner.displayName; } }
  if (merged) await writeItems(items);
  return { mapping, aliases, merged };
}
