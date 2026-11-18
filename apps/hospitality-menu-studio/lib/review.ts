import { calendarDay, londonDate, rotationWeek, type Dish, type Menu, type PublicationScope, type Review } from "./contract";
import { StudioProblem } from "./problem";

export function assortmentIsComplete(dish: Dish): boolean {
  const assortment = dish.assortment;
  if (!assortment) return true;
  const { expectedTotal, unit, components } = assortment;
  return Boolean(unit.trim()) && Number.isSafeInteger(expectedTotal) && expectedTotal > 0
    && components.length > 0 && components.every(component => Boolean(component.name.trim())
      && Number.isSafeInteger(component.quantity) && component.quantity > 0)
    && components.reduce((sum, component) => sum + component.quantity, 0) === expectedTotal;
}

export function menuDishIds(menu: Menu, eventDate?: string): string[] {
  if (eventDate && (eventDate < menu.startDate || eventDate > menu.endDate)) return [];
  if (eventDate) assertRotationPreviewAnchor(menu);
  return [...new Set(menu.sections.flatMap(section => {
    if (section.mode === "static") return section.staticDishIds;
    if (!eventDate) return section.weeks.flat();
    return section.weeks[rotationWeek(menu.anchorMonday, eventDate) - 1] ?? [];
  }))];
}

export function draftReadiness(
  menu: Menu, dishes: Dish[], effectiveDate: string, scope: PublicationScope, today = londonDate(),
): Review {
  const issues: string[] = [];
  if (!menu.name.trim()) issues.push("Enter a menu name.");
  if (!menu.startDate || !menu.endDate || menu.endDate < menu.startDate) issues.push("Enter a valid menu date range.");
  if (!Number.isFinite(calendarDay(effectiveDate)) || effectiveDate < today || effectiveDate < menu.startDate || effectiveDate > menu.endDate) {
    issues.push("Choose an effective date within the menu dates and on or after today.");
  }
  if (!menu.sections.length) issues.push("Add at least one section.");
  if (needsRotationAnchor(menu)) {
    issues.push("Choose a Monday to anchor the six-week cycle.");
  }

  const mappingIds = new Set<string>();
  for (const section of menu.sections) {
    const label = section.name.trim() || "Unnamed section";
    if (!section.name.trim()) issues.push("Give each section a name.");
    if (!section.catalogueItemId) issues.push(`${label} needs a Hub catalogue mapping.`);
    else if (mappingIds.has(section.catalogueItemId)) issues.push(`${label} duplicates a catalogue mapping.`);
    else mappingIds.add(section.catalogueItemId);
    const sets = section.mode === "rotation" ? section.weeks : [section.staticDishIds];
    if (sets.some(ids => ids.length === 0)) issues.push(`${label} has an empty dish list.`);
  }

  const byId = new Map(dishes.map(dish => [dish.id, dish]));
  const ids = menuDishIds(menu);
  for (const id of ids) {
    const dish = byId.get(id);
    if (!dish) issues.push(`Dish ${id} is unavailable.`);
    else {
      const label = dish.name || "Unnamed dish";
      if (!dish.name || !dish.customerDescription || !dish.kitchenDescription) {
        issues.push(`${label} needs a name and both descriptions.`);
      }
      if (!assortmentIsComplete(dish)) issues.push(`${label} has an incomplete fixed assortment.`);
    }
  }

  const scopedSection = menu.sections.find(section => section.id === scope.sectionId);
  if (scope.sectionId && !scopedSection) issues.push("Select a section included in this draft.");
  if (scope.week && scopedSection?.mode !== "rotation") issues.push("Choose a rotating section for a week amendment.");
  const scopeSets = scopedSection ? (scopedSection.mode === "static" ? [scopedSection.staticDishIds]
    : scope.week ? [scopedSection.weeks[scope.week - 1]] : scopedSection.weeks) : [ids];
  if (scope.dishId && !scopeSets.flat().includes(scope.dishId)) issues.push("The selected dish is unavailable in this scope.");

  const changes = scopedSection
    ? [`${scopedSection.name || "Unnamed section"}${scope.week ? ` · Week ${scope.week}` : ""}${scope.dishId ? ` · ${byId.get(scope.dishId)?.name || "Dish"}` : ""}`]
    : scope.dishId ? [byId.get(scope.dishId)?.name || "Dish"] : menu.sections.map(section => section.name || "Unnamed section");

  return {
    canPublish: false,
    issues: [...issues, "Signed dish verification, catalogue eligibility and booking impact are unavailable."],
    changes,
    reviewToken: null,
    safety: { status: "unavailable" },
    impact: { status: "unavailable" },
  };
}

export function draftCustomerChoices(menu: Menu, dishes: Dish[], eventDate: string) {
  if (!Number.isFinite(calendarDay(eventDate)) || !menu.startDate || !menu.endDate || eventDate < menu.startDate || eventDate > menu.endDate) return [];
  assertRotationPreviewAnchor(menu);
  const byId = new Map(dishes.map(dish => [dish.id, dish]));
  const week = rotationWeek(menu.anchorMonday, eventDate);
  return menu.sections.map(section => ({
    id: section.id,
    name: section.name,
    dishes: (section.mode === "static" ? section.staticDishIds : section.weeks[week - 1] ?? []).map(id => {
      const dish = byId.get(id);
      if (!dish) throw new StudioProblem(409, "DRAFT_DISH_MISSING", "This preview references a dish that could not be loaded.");
      return { id, name: dish.name, category: dish.category, temperature: dish.temperature, description: dish.customerDescription };
    }),
  }));
}

function needsRotationAnchor(menu: Menu) {
  return menu.sections.some(section => section.mode === "rotation") &&
    new Date(calendarDay(menu.anchorMonday)).getUTCDay() !== 1;
}

function assertRotationPreviewAnchor(menu: Menu) {
  if (needsRotationAnchor(menu)) {
    throw new StudioProblem(422, "ROTATION_ANCHOR_REQUIRED", "Choose a Monday before previewing rotating sections.");
  }
}

export function kitchenQuantities(dish: Dish, boxes: number) {
  if (!dish.assortment || !assortmentIsComplete(dish) || !Number.isSafeInteger(boxes) || boxes <= 0 ||
      !Number.isSafeInteger(dish.assortment.expectedTotal * boxes)) {
    throw new StudioProblem(422, "INVALID_ASSORTMENT", "A complete assortment and valid box count are required.");
  }
  const { components, unit, expectedTotal } = dish.assortment;
  return {
    boxes, unit, kitchenDescription: dish.kitchenDescription,
    perBox: expectedTotal, total: expectedTotal * boxes,
    components: components.map(component => ({
      id: component.id, name: component.name, perBox: component.quantity, total: component.quantity * boxes,
    })),
  };
}
