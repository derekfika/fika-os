import { z } from "zod";
import { calendarDay, categories, type Dish, type Menu, type Section } from "./contract";

export const idSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$/).refine(id => !id.startsWith("__"));
export const versionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1);
export const revisionSchema = versionSchema.positive();
export const versionQuerySchema = z.string().regex(/^\d+$/).transform(Number).pipe(revisionSchema);
export const dateSchema = z.string().refine(date => Number.isFinite(calendarDay(date)));
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
}) satisfies z.ZodType<Section>;

export const menuSchema = z.object({
  ...versioned,
  name,
  kind: z.enum(["seasonal", "collection"]),
  startDate: draftDate,
  endDate: draftDate,
  anchorMonday: draftDate,
  sections: z.array(sectionSchema).refine(sections => new Set(sections.map(section => section.id)).size === sections.length),
}) satisfies z.ZodType<Menu>;

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
}) satisfies z.ZodType<Dish>;

export const scopeSchema = z.object({
  sectionId: idSchema.optional(),
  week: z.number().int().min(1).max(6).optional(),
  dishId: idSchema.optional(),
}).refine(scope => !scope.week || Boolean(scope.sectionId));

const candidate = {
  menuId: idSchema,
  version: versionSchema.positive(),
  effectiveDate: dateSchema,
  scope: scopeSchema,
};
export const commandSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save-menu"), item: menuSchema }),
  z.object({ action: z.literal("save-dish"), item: dishSchema }),
  z.object({ action: z.literal("submit-dish-review"), dishId: idSchema, version: revisionSchema, confirmed: z.literal(true) }).strict(),
  z.object({ action: z.literal("review"), ...candidate }),
  z.object({ action: z.literal("publish"), ...candidate, reviewToken: z.string().min(1).max(256), confirmed: z.literal(true) }),
  z.object({ action: z.literal("restore-menu"), menuId: idSchema, version: versionSchema.positive(), publicationId: idSchema }),
  z.object({ action: z.literal("restore-draft"), menuId: idSchema, version: revisionSchema, sourceVersion: revisionSchema, confirmed: z.literal(true) })
    .refine(command => command.sourceVersion < command.version),
  z.object({ action: z.literal("activate-collection"), menuId: idSchema, publicationId: idSchema, visibility: z.enum(["staff", "customer"]), confirmed: z.literal(true) }),
]);
export type StudioCommand = z.infer<typeof commandSchema>;
