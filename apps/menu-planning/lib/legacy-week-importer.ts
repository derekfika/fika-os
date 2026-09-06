import type { MenuItem } from "./domain";
import type { RollingSnapshot } from "./rolling-menu-types";

export type DishResolutionKind = "matched" | "suggested" | "unresolved";
export type DishResolution = { sourceName: string; occurrences: number; kind: DishResolutionKind; canonicalId?: string; canonicalName?: string; suggestions: Array<{ id: string; name: string }> };

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
  for (const resolution of resolutions) if (!resolution.ignored && (!resolution.canonicalId || !byId.has(resolution.canonicalId))) throw new Error("Every dish must be matched to an existing Dish Library item or ignored.");
  const kept = snapshot.entries.filter(entry => { const decision = decisions.get(safeDishKey(entry.itemLabel)); return decision && !decision.ignored; });
  for (const entry of kept) { const decision = decisions.get(safeDishKey(entry.itemLabel))!; const item = byId.get(decision.canonicalId!); entry.itemId = item!.canonicalId; entry.itemLabel = item!.displayName; }
  snapshot.entries = kept; snapshot.days.forEach(day => { day.entryIds = snapshot.entries.filter(entry => entry.dayId === day.id).map(entry => entry.id); }); snapshot.week.entryIds = snapshot.entries.map(entry => entry.id); snapshot.week.status = "imported"; snapshot.week.audit.push({ action: "legacy-week-imported-after-dish-review", at: new Date().toISOString(), by: "menu-planning-importer" });
  return snapshot;
}
