import { z } from "zod";

/** Hub-owned configuration. Dish Library and catalogue identities remain provider-owned. */
export const ROTATIONS_SCHEMA = "hospitality-rotations.v1" as const;
export const INITIAL_ROTATION_CYCLE_WEEKS = 6;
export const INITIAL_ROTATION_CATEGORIES = [
  { id: "finger-food", label: "Finger Food" },
  { id: "canapes", label: "Canapés" },
  { id: "bowl-food", label: "Bowl Food" },
  { id: "salad-proteins", label: "Salad Proteins" },
  { id: "salad-boxes", label: "Salad Boxes" },
] as const;
/** Hospitality-specific Dish Library classifications; deliberately separate from Menu Planning's governed dish categories. */
export const HOSPITALITY_DISH_CLASSES = [
  { id: "finger-food", label: "Finger Food" },
  { id: "canapes", label: "Canapés" },
  { id: "sweet-finger-food", label: "Sweet Finger Food" },
  { id: "sandwiches-wraps", label: "Sandwiches / Wraps" },
  { id: "breakfast-hospitality", label: "Breakfast Hospitality" },
  { id: "bowl-food", label: "Bowl Food" },
  { id: "salad-proteins", label: "Salad Proteins" },
  { id: "salad-boxes", label: "Salad Boxes" },
  { id: "other-hospitality", label: "Other Hospitality" },
] as const;
export type HospitalityDishClassId = typeof HOSPITALITY_DISH_CLASSES[number]["id"];
export const HOSPITALITY_DISH_CLASS_IDS = HOSPITALITY_DISH_CLASSES.map(value => value.id) as [HospitalityDishClassId, ...HospitalityDishClassId[]];
/** Explicit operational scope on a canonical Dish Library record. A missing value means MENU_PLANNING. */
export const DISH_OPERATIONAL_SCOPES = ["MENU_PLANNING", "HOSPITALITY_ROTATIONS", "SHARED"] as const;
export type DishOperationalScope = typeof DISH_OPERATIONAL_SCOPES[number];
/** Scopes the Rotations manager may offer; Brian's MENU_PLANNING dishes are never offered. */
export const ROTATION_PICKER_SCOPES = ["HOSPITALITY_ROTATIONS", "SHARED"] as const;
export const HOSPITALITY_DISH_RECORD_SOURCE = "hospitality-rotations" as const;
/** Stable, deterministic dish ID so one catalogue Item can never create a second hospitality dish. */
export function hospitalityDishIdForItem(itemId: string): string {
  const id = `hospitality-dish:${itemId}`;
  if (id.length > 160 || !/^[A-Za-z0-9:_-]+$/.test(id)) throw new Error("Catalogue Item ID cannot form a stable hospitality dish ID");
  return id;
}
export const ROTATIONS_AUTHORITY = { appId: "hospitality-booking", resource: "hospitality.rotations" } as const;
const Id = z.string().min(1).max(160).regex(/^[A-Za-z0-9:_-]+$/);
const Positive = z.number().finite().positive();
export const BusinessDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}, "Use a real calendar date");
export function londonDate(instant: Date): string {
  if (!Number.isFinite(instant.getTime())) throw new Error("Invalid instant");
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  return ["year", "month", "day"].map(key => parts.find(part => part.type === key)!.value).join("-");
}
export const RotationCalendar = z.object({
  anchorMonday: BusinessDate.refine(value => new Date(`${value}T00:00:00Z`).getUTCDay() === 1, "Anchor must be Monday"),
  cycleWeeks: z.number().int().min(1).max(52).default(INITIAL_ROTATION_CYCLE_WEEKS),
  timeZone: z.literal("Europe/London"),
}).strict();
export function rotationWeek(calendar: z.infer<typeof RotationCalendar>, date: string): number {
  RotationCalendar.parse(calendar); BusinessDate.parse(date);
  const weeks = Math.floor((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${calendar.anchorMonday}T00:00:00Z`)) / 604800000);
  return ((weeks % calendar.cycleWeeks) + calendar.cycleWeeks) % calendar.cycleWeeks + 1;
}
const Range = z.object({ minimum: Positive, maximum: Positive, increment: Positive }).strict().refine(value => value.maximum >= value.minimum, "Maximum must be at least minimum");
export const RotationRules = z.object({
  guests: Range,
  distinctDishes: z.object({ minimum: z.number().int().positive(), maximum: z.number().int().positive() }).strict().refine(value => value.maximum >= value.minimum),
  quantityPerDish: Range,
  unit: z.string().trim().min(1).max(60),
}).strict();
export const DishReference = z.object({ dishId: Id, recipeRevision: z.number().int().positive() }).strict();
const Group = z.object({
  id: Id, label: z.string().trim().min(1).max(160), categoryId: Id, itemId: Id,
  dishBank: z.array(DishReference).min(1).max(100),
  weeks: z.array(z.object({ week: z.number().int().positive(), dishIds: z.array(Id).min(1).max(100) }).strict()).min(1).max(52),
  rules: RotationRules,
}).strict();
export const RotationConfiguration = z.object({
  schema: z.literal(ROTATIONS_SCHEMA), label: z.string().trim().min(1).max(160),
  calendar: RotationCalendar,
  categories: z.array(z.object({ id: Id, label: z.string().trim().min(1).max(160) }).strict()).min(1).max(50),
  groups: z.array(Group).min(1).max(30),
}).strict().superRefine((value, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  const unique = (values: unknown[]) => new Set(values).size === values.length;
  if (!unique(value.categories.map(category => category.id))) issue("Duplicate category IDs");
  if (!unique(value.groups.map(group => group.id))) issue("Duplicate group IDs");
  if (!unique(value.groups.map(group => group.itemId))) issue("Each catalogue Item maps to exactly one group");
  for (const group of value.groups) {
    if (!value.categories.some(category => category.id === group.categoryId)) issue("Unknown category");
    if (!unique(group.dishBank.map(dish => dish.dishId))) issue("Duplicate dish bank IDs");
    if (group.weeks.length !== value.calendar.cycleWeeks || !unique(group.weeks.map(week => week.week)) || group.weeks.some(week => week.week > value.calendar.cycleWeeks)) issue("Every group must cover every week of the global calendar exactly once");
    for (const week of group.weeks) {
      if (!unique(week.dishIds) || week.dishIds.some(id => !group.dishBank.some(dish => dish.dishId === id))) issue("Week dishes must be distinct bank members");
      if (week.dishIds.length < group.rules.distinctDishes.minimum) issue("Week cannot satisfy minimum distinct dishes");
    }
  }
  const refs = value.groups.flatMap(group => group.dishBank);
  if (new Set(refs.map(ref => ref.dishId)).size > 150) issue("Maximum 150 canonical dishes per version");
  for (const ref of refs) if (refs.some(other => other.dishId === ref.dishId && other.recipeRevision !== ref.recipeRevision)) issue("Conflicting recipe revisions");
});
export type RotationConfiguration = z.infer<typeof RotationConfiguration>;
export const RotationCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save-draft"), requestId: Id, expectedVersion: z.number().int().nonnegative(), configuration: RotationConfiguration }).strict(),
  z.object({ action: z.literal("publish"), requestId: Id, expectedVersion: z.number().int().positive(), draftRevision: z.number().int().positive(), effectiveFrom: BusinessDate, reason: z.string().trim().min(1).max(500) }).strict(),
]);
export type RotationCommand = z.infer<typeof RotationCommand>;
/** Persists the stable catalogue-Item-to-dish mapping. The dish itself is authored in Menu Planning; Hub owns the mapping. */
export const DishLinkCommand = z.object({ action: z.literal("link-dish"), requestId: Id, itemId: Id, dishId: Id, classification: z.enum(HOSPITALITY_DISH_CLASS_IDS) }).strict();
export type DishLinkCommand = z.infer<typeof DishLinkCommand>;
export type DishLink = { schema: "hospitality-rotation-dish-link.v1"; itemId: string; dishId: string; classification: HospitalityDishClassId; actorId: string; recordedAt: string; requestId: string };
export type RotationRevision = {
  schema: typeof ROTATIONS_SCHEMA; revision: number; status: "draft" | "published";
  configuration: RotationConfiguration; actorId: string; recordedAt: string; requestId: string;
  effectiveFrom?: string; reason?: string; sourceDraftRevision?: number;
  /** Frozen source evidence, never a mutable alternative Dish Library. */
  recipes?: Array<{ dishId: string; recipeRevision: number; record: Record<string, unknown> }>;
};
export type RotationHead = { schema: typeof ROTATIONS_SCHEMA; version: number; draftRevision?: number; activations: Array<{ effectiveFrom: string; revision: number }> };
export function publishedRevisionFor(head: RotationHead, date: string): number | undefined {
  BusinessDate.parse(date);
  return [...head.activations].filter(entry => entry.effectiveFrom <= date).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]?.revision;
}
export function applicableMenu(revision: RotationRevision, date: string, itemId: string) {
  BusinessDate.parse(date);
  if (revision.status !== "published" || !revision.effectiveFrom || date < revision.effectiveFrom) throw new Error("Published menu is not applicable");
  const group = revision.configuration.groups.find(value => value.itemId === itemId);
  if (!group) throw new Error("Item has no rotation in this version");
  const week = rotationWeek(revision.configuration.calendar, date);
  return { group, week, dishIds: group.weeks.find(value => value.week === week)!.dishIds };
}
export type RotationBookingReference = {
  schema: typeof ROTATIONS_SCHEMA; publishedRevision: number; eventDate: string; itemId: string; groupId: string; week: number;
  rules: z.infer<typeof RotationRules>; guests: number;
  selections: Array<{ dishId: string; recipeRevision: number; quantity: number; unit: string }>;
};
/** Called by the future booking transaction, then stored unchanged with its booking revision. */
export function freezeRotationSelection(revision: RotationRevision, input: { eventDate: string; itemId: string; guests: number; selections: Array<{ dishId: string; quantity: number }> }): RotationBookingReference {
  const { group, week, dishIds } = applicableMenu(revision, input.eventDate, input.itemId);
  const inRange = (n: number, rule: z.infer<typeof Range>) => Number.isFinite(n) && n >= rule.minimum && n <= rule.maximum && Math.abs((n - rule.minimum) / rule.increment - Math.round((n - rule.minimum) / rule.increment)) < 1e-8;
  if (!inRange(input.guests, group.rules.guests)) throw new Error("Guest count violates rotation rules");
  if (new Set(input.selections.map(value => value.dishId)).size !== input.selections.length || input.selections.length < group.rules.distinctDishes.minimum || input.selections.length > group.rules.distinctDishes.maximum) throw new Error("Distinct dish selection violates rotation rules");
  const selections = input.selections.map(selection => {
    const ref = group.dishBank.find(value => value.dishId === selection.dishId);
    if (!ref || !dishIds.includes(selection.dishId) || !inRange(selection.quantity, group.rules.quantityPerDish) || !revision.recipes?.some(recipe => recipe.dishId === ref.dishId && recipe.recipeRevision === ref.recipeRevision)) throw new Error("Dish selection violates published menu");
    return { ...selection, recipeRevision: ref.recipeRevision, unit: group.rules.unit };
  });
  return structuredClone({ schema: ROTATIONS_SCHEMA, publishedRevision: revision.revision, eventDate: input.eventDate, itemId: input.itemId, groupId: group.id, week, rules: group.rules, guests: input.guests, selections });
}
