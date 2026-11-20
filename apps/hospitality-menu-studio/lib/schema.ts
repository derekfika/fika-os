import { z } from "zod";
import { dateSchema, dishSchema, idSchema, menuSchema, revisionSchema, scopeSchema, versionSchema } from "../../shared/hospitality-menu-studio-content";

export { dateSchema, dishSchema, idSchema, menuSchema, revisionSchema, scopeSchema, versionSchema } from "../../shared/hospitality-menu-studio-content";
export const versionQuerySchema = z.string().regex(/^\d+$/).transform(Number).pipe(revisionSchema);

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
