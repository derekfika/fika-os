import type { Menu, PublicationScope, Section } from "./contract";
import type { PublicationPackage } from "./publication";
import { menuDishIds } from "./review";

export type ScopedPublicationContent = {
  menu: Menu;
  preserved: PublicationPackage["dishes"];
  refreshDishIds: string[];
  impactItemIds: string[];
  impactScope: "catalogue-item" | "dish-selection";
  rotation?: { anchorMonday: string; week: number };
  issues: string[];
  changes: string[];
};

export function hasPublicationScope(scope: PublicationScope) {
  return Boolean(scope.sectionId || scope.week || scope.dishId);
}

export function publicationContent(draft: Menu, scope: PublicationScope, previous?: PublicationPackage): ScopedPublicationContent {
  const whole: ScopedPublicationContent = { menu: draft, preserved: [], refreshDishIds: menuDishIds(draft),
    impactItemIds: itemIds([...(previous?.menu.sections || []), ...draft.sections]), impactScope: "catalogue-item", issues: [], changes: [] };
  if (!hasPublicationScope(scope)) return whole;
  if (!previous) return { ...whole, issues: ["Publish the whole menu before making a scoped amendment."], impactItemIds: [] };

  const base = { ...previous.menu, version: draft.version, updatedAt: draft.updatedAt };
  const original = base.sections.find(section => section.id === scope.sectionId);
  const edited = draft.sections.find(section => section.id === scope.sectionId);
  const reject = (problem: string): ScopedPublicationContent => ({ ...whole, menu: base, preserved: previous.dishes,
    refreshDishIds: [], impactItemIds: [], issues: [problem] });
  if (scope.dishId) {
    const dishId = scope.dishId;
    const containing = base.sections.filter(section => sectionLists(section).some(ids => ids.includes(dishId)));
    const inContext = !scope.sectionId || Boolean(original && (scope.week
      ? original.mode === "rotation" && original.weeks[scope.week - 1]?.includes(dishId)
      : containing.includes(original)));
    if (!containing.length || !inContext) return reject("Select a dish used by the published menu in this scope.");
    const occurrences = containing.flatMap(sectionLists).filter(ids => ids.includes(dishId)).length;
    const name = previous.dishes.find(({ dish }) => dish.id === dishId)?.dish.name || "This dish";
    return {
      ...whole, menu: base, preserved: previous.dishes.filter(({ dish }) => dish.id !== dishId), refreshDishIds: [dishId],
      impactItemIds: itemIds(containing), impactScope: "dish-selection",
      changes: [`${name} updates in all ${occurrences} ${occurrences === 1 ? "placement" : "placements"} in this menu. The dish stays in the same places.`],
    };
  }

  if (!original && !edited) return reject("Select a section in the publication or the saved draft.");
  const untouched = base.sections.filter(section => section.id !== scope.sectionId);
  const protectedIds = new Set(untouched.flatMap(sectionLists).flat());
  let replacement = edited;
  let affected = edited ? sectionLists(edited).flat() : [];
  let rotation: ScopedPublicationContent["rotation"];
  if (scope.week) {
    if (original?.mode !== "rotation" || edited?.mode !== "rotation") return reject("Select a rotating section in both the publication and the saved draft.");
    const weekIndex = scope.week - 1;
    affected = edited.weeks[weekIndex];
    replacement = { ...original, weeks: original.weeks.map((ids, index) => index === weekIndex ? affected : ids) };
    for (const ids of original.weeks.filter((_ids, index) => index !== weekIndex)) for (const id of ids) protectedIds.add(id);
    rotation = { anchorMonday: base.anchorMonday, week: scope.week };
  }
  const sections = original ? base.sections.flatMap(section => section !== original ? [section] : replacement ? [replacement] : [])
    : replacement ? [...base.sections, replacement] : base.sections;
  const menu = { ...base, sections };
  const shared = new Set(affected.filter(id => protectedIds.has(id)));
  const preserved = previous.dishes.filter(({ dish }) => protectedIds.has(dish.id));
  const changes = preserved.filter(({ dish }) => shared.has(dish.id)).map(({ dish }) =>
    `${dish.name} keeps published revision ${dish.version} because it also appears outside this scope. Use a dish amendment to change it everywhere in this menu.`);
  return {
    menu, preserved, refreshDishIds: menuDishIds(menu).filter(id => !protectedIds.has(id)),
    impactItemIds: itemIds([original, replacement]), impactScope: "catalogue-item", rotation, issues: [], changes,
  };
}

function sectionLists(section: Section) { return section.mode === "rotation" ? section.weeks : [section.staticDishIds]; }

function itemIds(sections: (Section | undefined)[]) {
  return [...new Set(sections.flatMap(section => section?.catalogueItemId ? [section.catalogueItemId] : []))].sort();
}
