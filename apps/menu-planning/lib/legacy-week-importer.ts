import type { MenuItem } from "./domain";
import type { RollingSnapshot } from "./rolling-menu-types";

export type DishResolutionKind = "matched" | "suggested" | "unresolved";
export type DishResolution = { sourceName: string; occurrences: number; kind: DishResolutionKind; canonicalId?: string; canonicalName?: string; suggestions: Array<{ id: string; name: string }> };
export type CanonicalIdentityClassification = "active" | "archived" | "missing" | "no-id";

export function classifyCanonicalIdentity(itemId: string | undefined, itemLabel: string, catalogue: MenuItem[]) {
  const current = itemId ? catalogue.find(item => item.canonicalId === itemId) : undefined;
  const classification: CanonicalIdentityClassification = !itemId ? "no-id" : !current ? "missing" : current.reviewStatus === "archived" ? "archived" : "active";
  const keys = new Set([safeDishKey(itemLabel), ...(current && classification === "archived" ? [safeDishKey(current.displayName), ...(current.sourceAliases || []).map(safeDishKey)] : [])].filter(Boolean));
  const matches = catalogue.filter(item => item.reviewStatus !== "archived" && (keys.has(safeDishKey(item.displayName)) || (item.sourceAliases || []).some(alias => keys.has(safeDishKey(alias)))));
  return { classification, current, matches };
}

export function safeDishKey(value: string) {
  return value.trim().toLocaleLowerCase("en-GB").replace(/[’']/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(value: string) { return new Set(safeDishKey(value).split(" ").filter(Boolean)); }
function similarity(left: string, right: string) {
  const a = tokens(left); const b = tokens(right); if (!a.size || !b.size) return 0;
  return [...a].filter(token => b.has(token)).length / new Set([...a, ...b]).size;
}

export function resolveDishNames(sourceNames: string[], catalogue: MenuItem[]): DishResolution[] {
  const unique = [...new Set(sourceNames.map(value => value.trim()).filter(Boolean))];
  const active = catalogue.filter(item => item.reviewStatus !== "archived");
  return unique.map(sourceName => {
    const key = safeDishKey(sourceName);
    const exact = active.find(item => safeDishKey(item.displayName) === key);
    const alias = active.find(item => (item.sourceAliases || []).some(value => safeDishKey(value) === key));
    const normalised = exact || alias || active.find(item => safeDishKey(item.displayName) === key);
    if (normalised) return { sourceName, occurrences: sourceNames.filter(value => value.trim() === sourceName).length, kind: "matched", canonicalId: normalised.canonicalId, canonicalName: normalised.displayName, suggestions: [] };
    const suggestions = active.map(item => ({ item, score: similarity(sourceName, item.displayName) })).filter(value => value.score >= 0.34).sort((a, b) => b.score - a.score).slice(0, 3).map(value => ({ id: value.item.canonicalId, name: value.item.displayName }));
    return { sourceName, occurrences: sourceNames.filter(value => value.trim() === sourceName).length, kind: suggestions.length ? "suggested" : "unresolved", suggestions };
  });
}

export function parseWorkbookWeekCommencing(workbookName: string): string | undefined {
  const match = workbookName.match(/(?:^|\D)(\d{2})[._-](\d{2})[._-](\d{2,4})(?:\D|$)/);
  if (!match) return undefined;
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const value = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1])));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== Number(match[2]) - 1 || value.getUTCDate() !== Number(match[1])) return undefined;
  const day = value.getUTCDay(); value.setUTCDate(value.getUTCDate() - (day === 0 ? 6 : day - 1));
  return value.toISOString().slice(0, 10);
}

export function applyDishResolutions(snapshot: RollingSnapshot, resolutions: Array<{ sourceName: string; canonicalId?: string; ignored?: boolean; remember?: boolean }>, catalogue: MenuItem[]) {
  const decisions = new Map(resolutions.map(value => [safeDishKey(value.sourceName), value]));
  const byId = new Map(catalogue.map(item => [item.canonicalId, item]));
  const missing = [...new Set(snapshot.entries.map(entry => safeDishKey(entry.itemLabel)))].filter(key => !decisions.has(key));
  if (missing.length) throw new Error("Please review every dish name before importing this week.");
  for (const resolution of resolutions) {
    const item = resolution.canonicalId ? byId.get(resolution.canonicalId) : undefined;
    if (!resolution.ignored && (!item || item.reviewStatus === "archived")) throw new Error("Every dish must be matched to an active Dish Library item or ignored.");
  }
  const kept = snapshot.entries.filter(entry => { const decision = decisions.get(safeDishKey(entry.itemLabel)); return decision && !decision.ignored; });
  for (const entry of kept) { const decision = decisions.get(safeDishKey(entry.itemLabel))!; const item = byId.get(decision.canonicalId!); entry.itemId = item!.canonicalId; entry.itemLabel = item!.displayName; }
  snapshot.entries = kept; snapshot.days.forEach(day => { day.entryIds = snapshot.entries.filter(entry => entry.dayId === day.id).map(entry => entry.id); }); snapshot.week.entryIds = snapshot.entries.map(entry => entry.id); snapshot.week.status = "imported"; snapshot.week.audit.push({ action: "legacy-week-imported-after-dish-review", at: new Date().toISOString(), by: "menu-planning-importer" });
  return snapshot;
}

/** Explicit, bounded repair report for one planning week; callers must opt into mutation. */
export function repairArchivedWeekDishIdentities(snapshot: RollingSnapshot, catalogue: MenuItem[]) {
  const repairedSnapshot = structuredClone(snapshot);
  const active = catalogue.filter(item => item.reviewStatus !== "archived");
  const byId = new Map(catalogue.map(item => [item.canonicalId, item]));
  const activeUnchanged: string[] = [];
  const archivedFound: string[] = [];
  const missingFound: string[] = [];
  const repaired: Array<{ entryId: string; itemLabel: string; fromId?: string; toId: string; reason: "archived-to-active" | "missing-to-active" | "no-id-to-active" }> = [];
  const blocked: Array<{ entryId: string; itemLabel: string; existingItemId?: string; classification: "archived-unresolved" | "missing-unresolved" | "ambiguous" | "no-id-unresolved"; reason: string }> = [];
  for (const entry of repairedSnapshot.entries) {
    const result = classifyCanonicalIdentity(entry.itemId, entry.itemLabel, catalogue);
    if (result.classification === "active") { activeUnchanged.push(entry.id); continue; }
    if (result.classification === "archived") archivedFound.push(entry.id);
    if (result.classification === "missing" || result.classification === "no-id") missingFound.push(entry.id);
    if (result.matches.length !== 1) {
      const classification = result.matches.length > 1 ? "ambiguous" : result.classification === "archived" ? "archived-unresolved" : result.classification === "missing" ? "missing-unresolved" : "no-id-unresolved";
      blocked.push({ entryId: entry.id, itemLabel: entry.itemLabel, ...(entry.itemId ? { existingItemId: entry.itemId } : {}), classification, reason: result.matches.length > 1 ? "More than one active exact display-name or alias replacement was found." : result.classification === "missing" ? "Canonical dish identity is missing and no active exact/alias replacement was found." : result.classification === "no-id" ? "Canonical dish identity is empty and no active exact/alias replacement was found." : "The archived canonical dish has no active exact/alias replacement." });
      continue;
    }
    const survivor = result.matches[0];
    const reason = result.classification === "archived" ? "archived-to-active" : result.classification === "missing" ? "missing-to-active" : "no-id-to-active";
    repaired.push({ entryId: entry.id, itemLabel: entry.itemLabel, ...(entry.itemId ? { fromId: entry.itemId } : {}), toId: survivor.canonicalId, reason });
    entry.itemId = survivor.canonicalId; entry.itemLabel = survivor.displayName; entry.audit.push({ action: "canonical-dish-identity-repaired", at: new Date().toISOString(), by: "menu-planning-repair" });
  }
  return { snapshot: repairedSnapshot, weekCommencing: snapshot.week.weekCommencing, activeUnchanged, archivedFound, missingFound, repaired, blocked, changed: repaired.length > 0 };
}
