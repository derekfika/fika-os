import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { MenuItem } from "./domain";
import { deterministicId } from "./domain";
import { normaliseDishCategory } from "./dish-categories";
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
  await writeFile(filePath, JSON.stringify({ version: 1, items }, null, 2) + "\n", "utf8");
}

export async function listCanonicalMenuItems() { return readItems(); }

/** Promote imported rolling-menu labels into reusable records once, without replacing reviewed records. */
export async function syncRollingEntries(entries: RollingEntry[], actor = "rolling-menu-migration") {
  const items = await readItems();
  let changed = false;
  for (const entry of entries) {
    const name = entry.itemLabel.trim();
    if (!name) continue;
    const existing = items.find(item => item.canonicalId === entry.itemId || item.displayName.toLowerCase() === name.toLowerCase());
    const at = new Date().toISOString();
    const allergenEvidence = Object.entries(entry.allergens || {})
      .filter(([, value]) => value !== "clear")
      .map(([allergen, value]) => ({ allergen, value: value === "may_contain" ? "may_contain" as const : "contains" as const, source: entry.source?.workbook || "Imported rolling menu", reviewedBy: actor, reviewedAt: at }));
    if (existing) {
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
  if (existing) return existing;
  const item = canonicalFromSourceCandidate(candidate, actor);
  items.push(item);
  await writeItems(items);
  return item;
}
