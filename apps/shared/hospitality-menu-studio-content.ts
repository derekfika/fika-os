import { z } from "zod";
import { hospitalityCalendarDay } from "./hospitality-menu-date";

export const categories = ["meat", "fish", "vegetarian", "vegan", "salad", "dessert", "other"] as const;
export const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/).refine(id => !id.startsWith("__"));
export const versionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1);
export const revisionSchema = versionSchema.positive();
export const dateSchema = z.string().refine(date => Number.isFinite(hospitalityCalendarDay(date)));
const draftDate = z.union([z.literal(""), dateSchema]);
const name = z.string().trim().max(200);
const itemIds = z.array(idSchema).refine(ids => new Set(ids).size === ids.length);
const draftQuantity = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const versioned = { id: idSchema, version: versionSchema, updatedAt: z.string().max(40) };

export const sectionSchema = z.object({
  id: idSchema, name,
  catalogueItemId: z.union([z.literal(""), idSchema]),
  mode: z.enum(["static", "rotation"]),
  staticDishIds: itemIds,
  weeks: z.array(itemIds).length(6),
});

export const menuSchema = z.object({
  ...versioned,
  name,
  kind: z.enum(["seasonal", "collection"]),
  startDate: draftDate,
  endDate: draftDate,
  anchorMonday: draftDate,
  sections: z.array(sectionSchema).refine(sections => new Set(sections.map(section => section.id)).size === sections.length),
});

export const dishSchema = z.object({
  ...versioned,
  name,
  category: z.enum(categories),
  temperature: z.enum(["hot", "cold"]).nullable(),
  customerDescription: z.string().trim().max(4000),
  kitchenDescription: z.string().trim().max(12000),
  assortment: z.object({
    expectedTotal: draftQuantity,
    unit: z.string().trim().max(48),
    components: z.array(z.object({ id: idSchema, name, quantity: draftQuantity }))
      .refine(components => new Set(components.map(component => component.id)).size === components.length),
  }).nullable(),
});

export const scopeSchema = z.object({
  sectionId: idSchema.optional(),
  week: z.number().int().min(1).max(6).optional(),
  dishId: idSchema.optional(),
}).refine(scope => !scope.week || Boolean(scope.sectionId));

export type Dish = z.infer<typeof dishSchema>;
export type Menu = z.infer<typeof menuSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type PublicationScope = z.infer<typeof scopeSchema>;

export function assortmentIsComplete(dish: Dish): boolean {
  const assortment = dish.assortment;
  if (!assortment) return true;
  const { expectedTotal, unit, components } = assortment;
  return Boolean(unit.trim()) && Number.isSafeInteger(expectedTotal) && expectedTotal > 0
    && components.length > 0 && components.every(component => Boolean(component.name.trim())
      && Number.isSafeInteger(component.quantity) && component.quantity > 0)
    && components.reduce((sum, component) => sum + component.quantity, 0) === expectedTotal;
}
