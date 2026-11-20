import { createHash } from "node:crypto";
import { z } from "zod";
import { assortmentIsComplete, dateSchema, dishSchema, idSchema, menuSchema, revisionSchema, scopeSchema } from "./hospitality-menu-studio-content";
import { sameStudioDishReviewSubject, studioDishReviewKey, studioDishReviewSubject } from "./hospitality-menu-studio-safety";
import { hospitalityCalendarDay } from "./hospitality-menu-date";

export const publicationDigest = z.string().regex(/^[a-f0-9]{64}$/);
export const maximumStudioPublicationBytes = 650_000;
const packageSchema = z.strictObject({
  contract: z.literal("hospitality-menu-studio.publication.v1"),
  publicationId: idSchema, publicationRevision: revisionSchema, sourceApp: z.literal("hospitality-menu-studio"),
  projectId: z.enum(["demo-fika-os", "fika-os-dev"]), menu: menuSchema.strict(),
  effectiveDate: dateSchema, sourceDraftVersion: revisionSchema, previousPublicationId: idSchema.nullable(),
  catalogueHash: publicationDigest, scope: scopeSchema.optional(),
  dishes: z.array(z.strictObject({ dish: dishSchema.strict(), safety: z.strictObject({
    subject: z.strictObject({ dishId: idSchema, revision: revisionSchema, sourceHash: publicationDigest }),
    releaseId: z.string().regex(/^cpu-studio-dish-release:[a-f0-9]{64}:v[1-9][0-9]*$/), matrixHash: publicationDigest,
  }) })),
});

export const studioPublicationDescriptor = z.strictObject({
  id: idSchema, menuId: idSchema, menuName: z.string().min(1).max(200), revision: revisionSchema,
  effectiveDate: dateSchema, publishedAt: z.iso.datetime(), publishedBy: z.string().min(1).max(256),
  scope: scopeSchema, sourceDraftVersion: revisionSchema, contentHash: publicationDigest,
});

export type PublicationPackage = z.infer<typeof packageSchema>;
export type StudioPublicationDescriptor = z.infer<typeof studioPublicationDescriptor>;

export function canonicalJson(value: unknown) {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
}

export function publicationHash(value: string) { return createHash("sha256").update(value).digest("hex"); }

export function publicationIdFor(menuId: string, revision: number) {
  return `publication-${publicationHash(menuId).slice(0, 32)}-v${revision}`;
}

export function decodeStudioPublication(body: string, descriptor: unknown, projectId: PublicationPackage["projectId"]): PublicationPackage | undefined {
  const manifest = studioPublicationDescriptor.safeParse(descriptor);
  if (!manifest.success || Buffer.byteLength(body) > maximumStudioPublicationBytes ||
      publicationHash(body) !== manifest.data.contentHash) return undefined;
  let value: unknown;
  try { value = JSON.parse(body); }
  catch { return undefined; }
  const parsed = packageSchema.safeParse(value);
  if (!parsed.success || canonicalJson(parsed.data) !== body) return undefined;
  const payload = parsed.data;
  const { menu, publicationRevision, effectiveDate, sourceDraftVersion, scope } = payload;
  const publication = manifest.data;
  if (payload.projectId !== projectId || payload.publicationId !== publication.id || publicationRevision !== publication.revision ||
      publication.id !== publicationIdFor(menu.id, publicationRevision) ||
      payload.previousPublicationId !== (publicationRevision === 1 ? null : publicationIdFor(menu.id, publicationRevision - 1)) ||
      canonicalJson(scope || {}) !== canonicalJson(publication.scope) ||
      (scope && (!(scope.sectionId || scope.week || scope.dishId) || publicationRevision === 1)) ||
      effectiveDate !== publication.effectiveDate || menu.id !== publication.menuId || menu.name !== publication.menuName ||
      sourceDraftVersion !== publication.sourceDraftVersion || menu.version !== sourceDraftVersion ||
      !menu.startDate || !menu.endDate || effectiveDate < menu.startDate || effectiveDate > menu.endDate || !menu.sections.length) return undefined;
  const items = new Set<string>();
  const dishIds = new Set<string>();
  for (const section of menu.sections) {
    const selections = section.mode === "rotation" ? section.weeks : [section.staticDishIds];
    if (!section.name || !section.catalogueItemId || items.has(section.catalogueItemId) || selections.some(ids => !ids.length) ||
        (section.mode === "rotation" && new Date(hospitalityCalendarDay(menu.anchorMonday)).getUTCDay() !== 1)) return undefined;
    items.add(section.catalogueItemId);
    for (const ids of selections) for (const dishId of ids) dishIds.add(dishId);
  }
  const expected = [...dishIds];
  if (expected.length !== payload.dishes.length || payload.dishes.some(({ dish, safety }, index) =>
    dish.id !== expected[index] || dish.version < 1 || !dish.name || !dish.kitchenDescription || !dish.customerDescription ||
    !assortmentIsComplete(dish) || !sameStudioDishReviewSubject(safety.subject, studioDishReviewSubject(dish)) ||
    !safety.releaseId.startsWith(`cpu-studio-dish-release:${studioDishReviewKey(dish.id, dish.version)}:v`))) return undefined;
  return payload;
}
