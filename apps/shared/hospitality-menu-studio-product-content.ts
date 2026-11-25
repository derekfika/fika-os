import { z } from "zod";
import { dateSchema, idSchema, revisionSchema } from "./hospitality-menu-studio-content";
import { hospitalityCalendarDay, hospitalityRotationWeek } from "./hospitality-menu-date";

export const maximumProductMenuWeeks = 52;
export const maximumProductMenuDishRevisions = 200;
const maximumGroups = 24;

const anchorMonday = dateSchema.refine(date => new Date(hospitalityCalendarDay(date)).getUTCDay() === 1, "Choose a Monday for the rotation start.");
const cycleWeeks = z.int().min(1, "Enter at least one week.").max(maximumProductMenuWeeks, `Enter no more than ${maximumProductMenuWeeks} weeks.`);
const presentation = z.enum(["dropdown", "checkboxes", "quantities"]);
const dishReference = z.strictObject({ dishId: idSchema, revision: revisionSchema });
const choiceList = z.array(dishReference).max(maximumProductMenuDishRevisions);
const group = z.strictObject({ id: idSchema, name: z.string().trim().min(1).max(200), presentation: presentation.optional() });
const choices = z.strictObject({
  dishes: choiceList,
  groups: z.array(z.strictObject({ groupId: idSchema, dishes: choiceList })).max(maximumGroups),
});
const schedule = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("fixed"), choices }),
  z.strictObject({ kind: z.literal("rotation"), anchorMonday, weeks: z.array(choices).min(1).max(maximumProductMenuWeeks) }),
]);

export const productMenuConfiguration = z.strictObject({
  presentation,
  groups: z.array(group).max(maximumGroups),
  schedule,
}).superRefine((configuration, context) => {
  const invalid = (path: (string | number)[], message: string) => context.addIssue({ code: "custom", path, message });
  const groupIds = new Set(configuration.groups.map(group => group.id));
  if (groupIds.size !== configuration.groups.length) invalid(["groups"], "Each group must have a unique ID.");

  const slots = configuration.schedule.kind === "fixed" ? [configuration.schedule.choices] : configuration.schedule.weeks;
  const references = new Set<string>();
  for (const [index, slot] of slots.entries()) {
    const path = configuration.schedule.kind === "fixed" ? ["schedule", "choices"] : ["schedule", "weeks", index];
    const assignedGroups = new Set(slot.groups.map(group => group.groupId));
    if ((groupIds.size && slot.dishes.length) || assignedGroups.size !== slot.groups.length ||
        [...assignedGroups].some(id => !groupIds.has(id))) {
      invalid(path, "Use either a flat dish list or distinct groups defined for this product.");
    }
    const assigned = [...slot.dishes, ...slot.groups.flatMap(group => group.dishes)];
    if (new Set(assigned.map(dish => dish.dishId)).size !== assigned.length) {
      invalid(path, "Each dish can appear only once in this choice set.");
    }
    for (const reference of assigned) references.add(`${reference.dishId}|${reference.revision}`);
  }
  if (references.size > maximumProductMenuDishRevisions) {
    invalid(["schedule"], `A draft supports up to ${maximumProductMenuDishRevisions} different dish revisions.`);
  }
});

const versionedProduct = {
  itemId: idSchema,
  version: revisionSchema,
  updatedAt: z.iso.datetime(),
};

export const productMenuDraft = z.strictObject({
  schemaVersion: z.literal(1),
  ...versionedProduct,
  configuration: productMenuConfiguration,
});

export const productMenuSummary = z.discriminatedUnion("kind", [
  z.strictObject({ ...versionedProduct, kind: z.literal("fixed"), dishCount: z.int().nonnegative().max(maximumProductMenuDishRevisions) }),
  z.strictObject({ ...versionedProduct, kind: z.literal("rotation"), cycleWeeks }),
]);

export const productMenuSetup = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("fixed") }),
  z.strictObject({ kind: z.literal("rotation"), anchorMonday, cycleWeeks }),
]);

export type ProductMenuDraft = z.infer<typeof productMenuDraft>;
export type ProductMenuSummary = z.infer<typeof productMenuSummary>;
export type ProductMenuConfiguration = z.infer<typeof productMenuConfiguration>;
export type ProductMenuChoices = z.infer<typeof choices>;
export type ProductMenuSetup = z.infer<typeof productMenuSetup>;

export function initialProductMenuConfiguration(setup: ProductMenuSetup): ProductMenuConfiguration {
  const empty = (): ProductMenuChoices => ({ dishes: [], groups: [] });
  return {
    presentation: "quantities",
    groups: [],
    schedule: setup.kind === "fixed" ? { kind: "fixed", choices: empty() } : {
      kind: "rotation", anchorMonday: setup.anchorMonday, weeks: Array.from({ length: setup.cycleWeeks }, empty),
    },
  };
}

export function productMenuChoicesForDate(configuration: ProductMenuConfiguration, date: string) {
  if (!Number.isFinite(hospitalityCalendarDay(date))) return;
  const { schedule } = configuration;
  if (schedule.kind === "fixed") return { choices: schedule.choices };
  const week = hospitalityRotationWeek(schedule.anchorMonday, date, schedule.weeks.length);
  return { week, choices: schedule.weeks[week - 1]! };
}
