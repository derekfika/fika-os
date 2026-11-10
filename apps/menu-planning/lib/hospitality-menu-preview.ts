import { listCanonicalMenuItemsByIds } from "./canonical-menu-repository";
import { getWeek, planningWeekCommencing, operationalDateLondon } from "./rolling-menu";
import { getWeekHead } from "./operational-store";
import { publicationState } from "./menu-publication";
import { assertActorCanAccessOploc, type MenuActor } from "./auth";

/** Client-safe projection. Operational notes, quantities, allergens and publication artifacts stay inside Menu Planning. */
export async function hospitalityMenuPreview(date: string, oplocId: string, actor: MenuActor) {
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : undefined;
  if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date)
    throw Object.assign(new Error("A valid service date is required."), { status: 422 });
  assertActorCanAccessOploc(actor, oplocId);
  if (date < operationalDateLondon()) return { available: false, date, label: "Menu to be confirmed", dishes: [] as Array<{ dishId: string; name: string; category: string; description?: string }> };
  const weekId = `rolling-week:${planningWeekCommencing(date)}`;
  const head = await getWeekHead<{ id: string; version: number; weekCommencing: string; availableToHospitality?: boolean }>(weekId);
  if (!head?.availableToHospitality) return { available: false, date, label: "Menu to be confirmed", dishes: [] as Array<{ dishId: string; name: string; category: string; description?: string }> };
  const snapshot = await getWeek(weekId);
  const day = snapshot.days.find(value => value.date === date);
  if (!day) return { available: false, date, label: "Menu to be confirmed", dishes: [] as Array<{ dishId: string; name: string; category: string; description?: string }> };
  const entries = snapshot.entries.filter(entry => entry.dayId === day.id && entry.itemId && entry.itemLabel.trim() && (!entry.allocations.length || entry.allocations.some(allocation => allocation.destinationId === oplocId)));
  const items = await listCanonicalMenuItemsByIds([...new Set(entries.map(entry => entry.itemId!))]);
  const visibleItems = items.filter(item => item.reviewStatus !== "archived");
  const byId = new Map(visibleItems.map(item => [item.canonicalId, item]));
  const dishes = entries.flatMap(entry => {
    const item = byId.get(entry.itemId!);
    if (!item) return [];
    return [{ dishId: item.canonicalId, name: item.displayName, category: item.category, ...(item.description?.trim() ? { description: item.description.trim() } : {}) }];
  });
  if (!dishes.length) return { available: false, date, label: "Menu to be confirmed", dishes: [] as typeof dishes };
  const dayPublication = (await publicationState(snapshot))[day.id];
  const provisional = snapshot.week.status !== "published" || dayPublication?.hasUnpublishedChanges === true || !dayPublication?.hasCurrentPublication;
  return { available: true, date, weekCommencing: snapshot.week.weekCommencing, version: snapshot.week.version, label: provisional ? "Provisional menu" : "Published menu", provisional, dishes };
}