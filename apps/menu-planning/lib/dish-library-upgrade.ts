import type { MenuItem } from "./domain";
import { normaliseSaladSubtype } from "./dish-editor";
import { findExistingTag, isDishTagGroup, type DishTagGroup, type DishTagRegistry } from "./dish-tags";

/**
 * Pure planning for a Dish Library upgrade: replace one environment's library with a reviewed export,
 * apply the approved tags and salad slots, archive what is left, and prove that nothing a published menu
 * depends on has been merged or removed. It reads and writes nothing; scripts/replace-dish-library.ts
 * performs the (staging-only, dry-run-first) I/O around it.
 *
 * Rules it enforces: dish IDs, names, categories, aliases and allergen evidence are never changed; only
 * `tagIds`, a Salad's `subcategory` and an audit line are added; tags come only from the shared registry;
 * old dishes that are not in the new library are archived (kept, still resolvable by ID), never deleted;
 * no dishes are merged.
 */

export type TagAssignment = {
  name?: string;
  category?: string;
  confidence?: string;
  type?: string[];
  cuisine?: string[];
  style?: string[];
  occasion?: string[];
  subtype?: string;
};

const GROUP_FIELDS: Array<[keyof TagAssignment, DishTagGroup]> = [["type", "type"], ["cuisine", "cuisine"], ["style", "style"], ["occasion", "occasion"]];

/** Registry tag IDs for a dish's proposed tag words. Words with no registry tag are reported, never invented. */
export function resolveAssignmentTags(assignment: TagAssignment, registry: DishTagRegistry) {
  const tagIds: string[] = [];
  const skipped: string[] = [];
  for (const [field, group] of GROUP_FIELDS) {
    if (!isDishTagGroup(group)) continue;
    for (const word of (assignment[field] as string[] | undefined) || []) {
      const tag = findExistingTag(registry, group, word);
      if (tag) { if (!tagIds.includes(tag.id)) tagIds.push(tag.id); } else skipped.push(`${group}:${word}`);
    }
  }
  return { tagIds, skipped };
}

/** The exact fields an upgrade may add to a dish. Everything else is copied through untouched. */
export function applyAssignment(item: MenuItem, assignment: TagAssignment | undefined, registry: DishTagRegistry, actor: string, at: string) {
  if (!assignment || assignment.confidence === "Low") return { item, tagsApplied: 0, subtypeApplied: false, skipped: [] as string[] };
  const { tagIds, skipped } = resolveAssignmentTags(assignment, registry);
  const subtype = item.category === "Salad" ? normaliseSaladSubtype(assignment.subtype) : undefined;
  if (!tagIds.length && !subtype) return { item, tagsApplied: 0, subtypeApplied: false, skipped };
  const next: MenuItem = { ...item, audit: [...(item.audit || []), { action: "dish-library-upgrade-tags", at, by: actor }] };
  if (tagIds.length) next.tagIds = tagIds;
  if (subtype) next.subcategory = subtype;
  return { item: next, tagsApplied: tagIds.length, subtypeApplied: Boolean(subtype), skipped };
}

export type UpgradePlan = {
  /** Every dish to write: the new library with tags, plus old-only dishes carried as archived. */
  items: MenuItem[];
  stats: {
    current: number;
    incoming: number;
    replaced: number;
    added: number;
    carriedArchived: number;
    retainedForPublished: string[];
    alreadyArchived: number;
    tagged: number;
    tagsApplied: number;
    subtypesApplied: number;
    unmatchedAssignments: string[];
    skippedTagWords: Record<string, number>;
  };
  /** Active dishes that would share a name; the catalogue writer rejects these, so they must be fixed first. */
  nameCollisions: string[];
};

export function planLibraryUpgrade(input: { current: readonly MenuItem[]; incoming: readonly MenuItem[]; assignments: Record<string, TagAssignment>; registry: DishTagRegistry; actor: string; at: string; /** Old-only dishes a published menu still uses: kept active and unchanged instead of archived. */ keepActiveIds?: ReadonlySet<string> }): UpgradePlan {
  const currentById = new Map(input.current.map((item) => [item.canonicalId, item]));
  const incomingIds = new Set(input.incoming.map((item) => item.canonicalId));
  const items: MenuItem[] = [];
  const skippedTagWords: Record<string, number> = {};
  let replaced = 0, added = 0, tagged = 0, tagsApplied = 0, subtypesApplied = 0;

  for (const incoming of input.incoming) {
    const applied = applyAssignment(incoming, input.assignments[incoming.canonicalId], input.registry, input.actor, input.at);
    for (const word of applied.skipped) skippedTagWords[word] = (skippedTagWords[word] || 0) + 1;
    if (applied.tagsApplied || applied.subtypeApplied) tagged++;
    tagsApplied += applied.tagsApplied;
    if (applied.subtypeApplied) subtypesApplied++;
    const existing = currentById.get(incoming.canonicalId);
    // The catalogue writer keeps the higher revision, so an overlapping dish must outrank the old copy to replace it.
    const revision = existing ? Math.max(existing.revision || 0, applied.item.revision || 0) + 1 : applied.item.revision || 1;
    if (existing) replaced++; else added++;
    items.push({ ...applied.item, revision });
  }

  let carriedArchived = 0, alreadyArchived = 0;
  const retainedForPublished: string[] = [];
  for (const old of input.current) {
    if (incomingIds.has(old.canonicalId)) continue;
    if (old.reviewStatus === "archived") { alreadyArchived++; continue; }
    if (input.keepActiveIds?.has(old.canonicalId)) { retainedForPublished.push(old.canonicalId); items.push(old); continue; }
    carriedArchived++;
    items.push({ ...old, reviewStatus: "archived", revision: (old.revision || 0) + 1, audit: [...(old.audit || []), { action: "dish-library-upgrade-archived", at: input.at, by: input.actor, reason: "Not in the upgraded Dish Library; kept for history and ID resolution" }] });
  }

  const names = new Map<string, string[]>();
  for (const item of items) {
    if (item.reviewStatus === "archived") continue;
    const key = item.displayName.trim().toLocaleLowerCase("en-GB");
    names.set(key, [...(names.get(key) || []), item.canonicalId]);
  }
  const nameCollisions = [...names.entries()].filter(([, ids]) => ids.length > 1).map(([name, ids]) => `${name}: ${ids.join(", ")}`);

  return {
    items,
    stats: {
      current: input.current.length,
      incoming: input.incoming.length,
      replaced,
      added,
      carriedArchived,
      retainedForPublished,
      alreadyArchived,
      tagged,
      tagsApplied,
      subtypesApplied,
      unmatchedAssignments: Object.keys(input.assignments).filter((id) => input.assignments[id].confidence !== "Low" && !incomingIds.has(id)),
      skippedTagWords,
    },
    nameCollisions,
  };
}

/** Only the intended fields may differ between a dish in the plan and the incoming/old dish it came from. */
export function unexpectedChanges(before: MenuItem, after: MenuItem) {
  const allowed = new Set(["tagIds", "subcategory", "audit", "revision", "reviewStatus"]);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => !allowed.has(key) && JSON.stringify((before as Record<string, unknown>)[key]) !== JSON.stringify((after as Record<string, unknown>)[key]));
}

export type PublishedReference = { publicationId: string; weekCommencing: string; date: string; slot: string; dishId: string; dishName: string };
export type ReferenceProblem = PublishedReference & { problem: "missing" | "archived" | "possibly-merged"; detail: string };

/**
 * Every dish a currently published menu uses on or after `fromDate` must still be an ACTIVE dish with the
 * same ID in the library that will exist after the upgrade. A dish that is gone, archived, or only reachable
 * through another dish's alias has been removed or merged and blocks the upgrade.
 */
export function checkPublishedReferences(references: readonly PublishedReference[], finalItems: readonly MenuItem[], fromDate: string): ReferenceProblem[] {
  const byId = new Map(finalItems.map((item) => [item.canonicalId, item]));
  const problems: ReferenceProblem[] = [];
  for (const reference of references) {
    if (reference.date < fromDate) continue;
    const item = byId.get(reference.dishId);
    if (item && item.reviewStatus !== "archived") continue;
    const nameKey = reference.dishName.trim().toLocaleLowerCase("en-GB");
    const merged = finalItems.find((candidate) => candidate.reviewStatus !== "archived" && candidate.canonicalId !== reference.dishId && ((candidate.sourceAliases || []).some((alias) => alias.trim().toLocaleLowerCase("en-GB") === nameKey) || candidate.displayName.trim().toLocaleLowerCase("en-GB") === nameKey));
    if (!item) problems.push({ ...reference, problem: merged ? "possibly-merged" : "missing", detail: merged ? `ID not in the new library; "${merged.displayName}" (${merged.canonicalId}) carries the same name` : "ID not in the new library" });
    else problems.push({ ...reference, problem: merged ? "possibly-merged" : "archived", detail: merged ? `archived; "${merged.displayName}" (${merged.canonicalId}) is active with the same name` : "dish would be archived" });
  }
  return problems;
}
