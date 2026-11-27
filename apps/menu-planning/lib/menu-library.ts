import { CANONICAL_MENU_SLOTS, menuSectionForSlot } from "../../shared/menu-section-order";
import type { MenuServiceType, RollingSnapshot } from "./rolling-menu-types";
import { editWeek } from "./week-draft";
import { copyMenuStructure, validateMenuStructure, type MenuStructureSnapshot } from "./menu-structure-library";

export const MENU_LIBRARY_CATEGORIES = ["regular", "seasonal", "themed", "other"] as const;
export type MenuLibraryCategory = typeof MENU_LIBRARY_CATEGORIES[number];
export type SavedMenuDish = { slot: string; dishId: string; dishName: string };
export type SavedDailyMenuContent = {
  name: string;
  serviceType: MenuServiceType;
  category: MenuLibraryCategory;
  tags: string[];
  structure: MenuStructureSnapshot;
  dishes: SavedMenuDish[];
};
export type SavedDailyMenuRevision = {
  version: number;
  savedAt: string;
  savedBy: string;
  content: SavedDailyMenuContent;
};
export type SavedDailyMenu = SavedDailyMenuContent & {
  id: string;
  version: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  archivedAt?: string;
  audit: Array<{ action: "created" | "edited" | "duplicated" | "archived"; at: string; by: string }>;
  revisions: SavedDailyMenuRevision[];
};

const IDENTITY = /^[A-Za-z0-9:_-]{1,200}$/;
const fail = (message: string, status = 422): never => { throw Object.assign(new Error(message), { status }); };

export function validateSavedDailyMenuContent(value: unknown): SavedDailyMenuContent {
  if (!value || typeof value !== "object") return fail("Menu details are required.");
  const candidate = value as Record<string, unknown>;
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  if (!name || name.length > 100) return fail("Enter a menu name up to 100 characters.");
  const serviceType = candidate.serviceType;
  if (!["Breakfast", "Lunch", "Dinner", "Other"].includes(String(serviceType))) return fail("Choose a supported service type.");
  if (!MENU_LIBRARY_CATEGORIES.includes(candidate.category as MenuLibraryCategory)) return fail("Choose a supported menu category.");
  const tags = Array.isArray(candidate.tags) ? [...new Set(candidate.tags.map(tag => typeof tag === "string" ? tag.trim() : "").filter(Boolean))] : [];
  if (tags.length > 12 || tags.some(tag => tag.length > 30)) return fail("Use up to 12 menu tags, each no longer than 30 characters.");
  const structure = validateMenuStructure(candidate.structure);
  if (!Array.isArray(candidate.dishes) || candidate.dishes.length > 29) return fail("Menu dishes must use at most 29 saved menu rows.");
  const allowedSlots = new Set(structure.categories.flatMap(category => category.rows.map(row => row.slot)));
  const usedSlots = new Set<string>();
  const dishes = candidate.dishes.map(value => {
    if (!value || typeof value !== "object") return fail("Each menu dish needs a canonical Dish Library reference.");
    const dish = value as Record<string, unknown>;
    const slot = typeof dish.slot === "string" ? dish.slot.trim() : "";
    const dishId = typeof dish.dishId === "string" ? dish.dishId.trim() : "";
    const dishName = typeof dish.dishName === "string" ? dish.dishName.trim() : "";
    if (!allowedSlots.has(slot) || usedSlots.has(slot) || !IDENTITY.test(dishId) || !dishName || dishName.length > 200) {
      return fail("Each saved dish must use a unique row in the selected structure and a canonical Dish Library ID.");
    }
    usedSlots.add(slot);
    return { slot, dishId, dishName };
  });
  return { name, serviceType: serviceType as MenuServiceType, category: candidate.category as MenuLibraryCategory, tags, structure, dishes };
}

function savedContent(menu: SavedDailyMenu): SavedDailyMenuContent {
  return { name: menu.name, serviceType: menu.serviceType, category: menu.category, tags: [...menu.tags], structure: copyMenuStructure(menu.structure), dishes: menu.dishes.map(dish => ({ ...dish })) };
}

function retainCurrentRevision(menu: SavedDailyMenu, at: string, by: string): SavedDailyMenuRevision[] {
  return [...(menu.revisions || []), { version: menu.version, savedAt: at, savedBy: by, content: savedContent(menu) }];
}

function ensureUniqueName(menus: SavedDailyMenu[], name: string, exceptId?: string) {
  if (menus.some(menu => menu.id !== exceptId && !menu.archivedAt && menu.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
    fail("A saved menu already uses this name. Choose a different name.", 409);
  }
}

export function mutateSavedDailyMenus(
  menus: SavedDailyMenu[],
  input: Record<string, unknown>,
  actorId: string,
  at = new Date().toISOString(),
  createId = () => crypto.randomUUID(),
): SavedDailyMenu[] {
  const action = String(input.action || "");
  if (action === "create") {
    const content = validateSavedDailyMenuContent(input.menu);
    ensureUniqueName(menus, content.name);
    menus.push({ ...content, id: createId(), version: 1, createdAt: at, createdBy: actorId, updatedAt: at, updatedBy: actorId, audit: [{ action: "created", at, by: actorId }], revisions: [] });
    return menus;
  }
  const id = typeof input.menuId === "string" ? input.menuId : "";
  const index = menus.findIndex(menu => menu.id === id);
  if (index < 0) return fail("The saved menu was not found.", 404);
  const previous = menus[index];
  if (Number(input.expectedVersion) !== previous.version) return fail("This saved menu changed. Reload it before saving.", 409);
  if (previous.archivedAt) return fail("Archived menus cannot be changed.", 409);
  const revisions = retainCurrentRevision(previous, at, actorId);
  if (action === "edit") {
    const content = validateSavedDailyMenuContent(input.menu);
    ensureUniqueName(menus, content.name, id);
    menus[index] = { ...previous, ...content, version: previous.version + 1, updatedAt: at, updatedBy: actorId, audit: [...previous.audit, { action: "edited", at, by: actorId }], revisions };
  } else if (action === "rename") {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name || name.length > 100) return fail("Enter a menu name up to 100 characters.");
    ensureUniqueName(menus, name, id);
    menus[index] = { ...previous, name, version: previous.version + 1, updatedAt: at, updatedBy: actorId, audit: [...previous.audit, { action: "edited", at, by: actorId }], revisions };
  } else if (action === "duplicate") {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name || name.length > 100) return fail("Enter a menu name up to 100 characters.");
    ensureUniqueName(menus, name);
    menus.push({ ...savedContent(previous), name, structure: copyMenuStructure(previous.structure), dishes: previous.dishes.map(dish => ({ ...dish })), id: createId(), version: 1, createdAt: at, createdBy: actorId, updatedAt: at, updatedBy: actorId, audit: [{ action: "duplicated", at, by: actorId }], revisions: [] });
  } else if (action === "archive") {
    menus[index] = { ...previous, version: previous.version + 1, archivedAt: at, updatedAt: at, updatedBy: actorId, audit: [...previous.audit, { action: "archived", at, by: actorId }], revisions };
  } else return fail("Choose a supported Menu Library action.");
  return menus;
}

export function standardMainLunchStructure(): MenuStructureSnapshot {
  const categories = new Map<string, { id: string; name: string; rows: Array<{ id: string; slot: string; name: string }> }>();
  for (const slot of CANONICAL_MENU_SLOTS) {
    const section = menuSectionForSlot(slot.id);
    const category = categories.get(section.label) || { id: `main-lunch-${section.id}`, name: section.label, rows: [] };
    category.rows.push({ id: `main-lunch-row-${slot.order}`, slot: slot.id, name: slot.label });
    categories.set(section.label, category);
  }
  return { categories: [...categories.values()] };
}

export function menuStructureForWeek(snapshot: RollingSnapshot): MenuStructureSnapshot {
  return snapshot.week.menuStructure ? copyMenuStructure(snapshot.week.menuStructure) : standardMainLunchStructure();
}

const structuralShape = (structure: MenuStructureSnapshot) => JSON.stringify(structure.categories.map(category => ({
  name: category.name,
  rows: category.rows.map(row => ({ slot: row.slot, name: row.name })),
})));

export function savedMenuCompatibilityReason(
  menu: Pick<SavedDailyMenu, "serviceType" | "structure">,
  target: RollingSnapshot,
): string | undefined {
  const targetService = target.week.supplementaryMenu?.serviceType || "Lunch";
  if (menu.serviceType !== targetService) return `This is a ${menu.serviceType} menu; the selected day is ${targetService}.`;
  if (structuralShape(menu.structure) !== structuralShape(menuStructureForWeek(target))) return "Its category and row layout differs from this service. Choose a menu with the same layout.";
  return undefined;
}

/** Apply only canonical dish identity and label to the target day draft. Operational fields stay with that day. */
export function loadSavedDailyMenuIntoDay(snapshot: RollingSnapshot, dayId: string, menu: Pick<SavedDailyMenu, "serviceType" | "structure" | "dishes">): RollingSnapshot {
  const day = snapshot.days.find(candidate => candidate.id === dayId);
  if (!day) return fail("The selected planner day is no longer available.", 409);
  const incompatibility = savedMenuCompatibilityReason(menu, snapshot);
  if (incompatibility) return fail(incompatibility, 409);
  const dishesBySlot = new Map(menu.dishes.map(dish => [dish.slot, dish]));
  let next = snapshot;
  for (const category of menu.structure.categories) for (const row of category.rows) {
    const existing = next.entries.find(entry => entry.dayId === dayId && entry.slot === row.slot);
    const dish = dishesBySlot.get(row.slot);
    if (!existing && !dish) continue;
    if (!existing && dish) {
      next = editWeek(next, "create-entry", { id: `${next.week.id}:entry:${crypto.randomUUID()}`, dayId, slot: row.slot, itemId: dish.dishId, itemLabel: dish.dishName });
      continue;
    }
    if (!existing) continue;
    const nextDishId = dish?.dishId || "";
    const changedIdentity = existing.itemId !== nextDishId;
    const changedLabel = existing.itemLabel !== (dish?.dishName || "");
    if (!changedIdentity && !changedLabel) continue;
    next = editWeek(next, "update-entry", { entryId: existing.id, patch: {
      itemId: nextDishId,
      itemLabel: dish?.dishName || "",
      ...(changedIdentity ? { portions: 0, allocations: [] } : {}),
    } });
  }
  const savedSlots = new Set(menu.structure.categories.flatMap(category => category.rows.map(row => row.slot)));
  for (const existing of next.entries.filter(entry => entry.dayId === dayId && !savedSlots.has(entry.slot) && (entry.itemId || entry.itemLabel.trim()))) {
    next = editWeek(next, "update-entry", { entryId: existing.id, patch: { itemId: "", itemLabel: "", portions: 0, allocations: [] } });
  }
  return next;
}

export function captureDayAsSavedMenuContent(
  snapshot: RollingSnapshot,
  dayId: string,
  metadata: { name: string; category: MenuLibraryCategory; tags: string[] },
): SavedDailyMenuContent {
  const day = snapshot.days.find(candidate => candidate.id === dayId);
  if (!day) return fail("The selected planner day is no longer available.", 409);
  const entriesBySlot = new Map(snapshot.entries.filter(entry => entry.dayId === dayId && entry.itemId && entry.itemLabel.trim()).map(entry => [entry.slot, entry]));
  const structure = menuStructureForWeek(snapshot);
  const savedSlots = new Set(structure.categories.flatMap(category => category.rows.map(row => row.slot)));
  if ([...entriesBySlot.keys()].some(slot => !savedSlots.has(slot))) return fail("This day has populated rows outside its reusable menu layout. Adjust the saved layout before adding the day to Menu Library.", 409);
  const dishes = structure.categories.flatMap(category => category.rows.flatMap(row => {
    const entry = entriesBySlot.get(row.slot);
    return entry?.itemId ? [{ slot: row.slot, dishId: entry.itemId, dishName: entry.itemLabel }] : [];
  }));
  return validateSavedDailyMenuContent({ name: metadata.name, serviceType: snapshot.week.supplementaryMenu?.serviceType || "Lunch", category: metadata.category, tags: metadata.tags, structure, dishes });
}
