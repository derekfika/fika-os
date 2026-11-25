import { z } from "zod";
import { assortmentIsComplete, dateSchema, dishSchema, idSchema, revisionSchema } from "./hospitality-menu-studio-content";
import {
  maximumProductMenuDishRevisions, productMenuChoicesForDate, productMenuConfiguration, type ProductMenuConfiguration,
} from "./hospitality-menu-studio-product-content";
import {
  canonicalJson, maximumStudioPublicationBytes, publicationDigest, publicationHash, publicationIdFor, studioPublicationDescriptor,
} from "./hospitality-menu-studio-publication";
import { sameStudioDishReviewSubject, studioDishReviewKey, studioDishReviewSubject } from "./hospitality-menu-studio-safety";

export const studioProductPublicationContract = "hospitality-menu-studio.product-publication.v1";

const productPublicationSchema = z.strictObject({
  contract: z.literal(studioProductPublicationContract),
  publicationId: idSchema,
  publicationRevision: revisionSchema,
  previousPublicationId: idSchema.nullable(),
  sourceApp: z.literal("hospitality-menu-studio"),
  projectId: z.enum(["demo-fika-os", "fika-os-dev"]),
  itemId: idSchema,
  itemName: z.string().trim().min(1).max(200),
  effectiveDate: dateSchema,
  sourceDraftVersion: revisionSchema,
  catalogueHash: publicationDigest,
  configuration: productMenuConfiguration,
  dishes: z.array(z.strictObject({
    dish: dishSchema.strict(),
    safety: z.strictObject({
      subject: z.strictObject({ dishId: idSchema, revision: revisionSchema, sourceHash: publicationDigest }),
      releaseId: z.string().regex(/^cpu-studio-dish-release:[a-f0-9]{64}:v[1-9][0-9]*$/),
      matrixHash: publicationDigest,
    }),
  })).min(1).max(maximumProductMenuDishRevisions),
});

export type StudioProductPublication = z.infer<typeof productPublicationSchema>;

/** Use a distinct namespace to keep product identity separate from legacy Studio menu IDs. */
export function studioProductMenuId(itemId: string) {
  return `product-menu-${publicationHash(itemId)}`;
}

export function isStudioProductMenuId(menuId: string) {
  return /^product-menu-[a-f0-9]{64}$/.test(menuId);
}

export function studioProductDishKey(dishId: string, revision: number) {
  return `${dishId}@${revision}`;
}

export function studioProductSlots(configuration: ProductMenuConfiguration) {
  const { schedule } = configuration;
  return schedule.kind === "fixed" ? [schedule.choices] : schedule.weeks;
}

export function studioProductPublicationReferences(configuration: ProductMenuConfiguration) {
  const ordered = studioProductSlots(configuration).flatMap(slot => [...slot.dishes, ...slot.groups.flatMap(group => group.dishes)]);
  return [...new Map(ordered.map(ref => [studioProductDishKey(ref.dishId, ref.revision), ref])).values()];
}

/** Resolve a verified package to ordered, revision-specific choices for a London service date. */
export function studioProductChoicesForDate(payload: StudioProductPublication, eventDate: string) {
  if (eventDate < payload.effectiveDate) return;
  const slot = productMenuChoicesForDate(payload.configuration, eventDate);
  if (!slot) return;
  const exactRevisions = new Map(payload.dishes.map(record => [studioProductDishKey(record.dish.id, record.dish.version), record]));
  const select = (refs: typeof slot.choices.dishes) => refs.map(({ dishId, revision }) => {
    const record = exactRevisions.get(studioProductDishKey(dishId, revision));
    if (!record) throw Error("Verified product publication is missing an exact dish revision");
    return record;
  });
  const assigned = new Map(slot.choices.groups.map(group => [group.groupId, group.dishes]));
  return {
    ...(slot.week !== undefined ? { week: slot.week } : {}),
    presentation: payload.configuration.presentation,
    dishes: select(slot.choices.dishes),
    groups: payload.configuration.groups.flatMap(group => {
      const refs = assigned.get(group.id);
      if (!refs?.length) return [];
      return [{ id: group.id, name: group.name, presentation: group.presentation ?? payload.configuration.presentation,
        dishes: select(refs) }];
    }),
  };
}

export function decodeStudioProductPublication(
  body: string, descriptor: unknown, projectId: StudioProductPublication["projectId"],
): StudioProductPublication | undefined {
  const manifest = studioPublicationDescriptor.safeParse(descriptor);
  if (!manifest.success || Buffer.byteLength(body) > maximumStudioPublicationBytes ||
      publicationHash(body) !== manifest.data.contentHash || Object.keys(manifest.data.scope).length) return undefined;
  let value: unknown;
  try { value = JSON.parse(body); } catch { return undefined; }
  const checked = productPublicationSchema.safeParse(value);
  if (!checked.success || canonicalJson(checked.data) !== body) return undefined;
  const payload = checked.data;
  const publication = manifest.data;
  const menuId = studioProductMenuId(payload.itemId);
  if (payload.projectId !== projectId || publication.menuId !== menuId || payload.itemName !== publication.menuName ||
      payload.publicationId !== publication.id || payload.publicationRevision !== publication.revision ||
      publicationIdFor(menuId, publication.revision) !== publication.id ||
      payload.previousPublicationId !== (publication.revision === 1 ? null : publicationIdFor(menuId, publication.revision - 1)) ||
      payload.effectiveDate !== publication.effectiveDate || payload.sourceDraftVersion !== publication.sourceDraftVersion) return undefined;

  const slots = studioProductSlots(payload.configuration);
  if (slots.some(slot => !slot.dishes.length && !slot.groups.some(group => group.dishes.length))) return undefined;
  const references = studioProductPublicationReferences(payload.configuration);
  if (references.length !== payload.dishes.length || payload.dishes.some(({ dish, safety }, index) => {
    const reference = references[index];
    return dish.id !== reference.dishId || dish.version !== reference.revision || !dish.name || !dish.customerDescription ||
      !dish.kitchenDescription || !assortmentIsComplete(dish) ||
      !sameStudioDishReviewSubject(safety.subject, studioDishReviewSubject(dish)) ||
      !safety.releaseId.startsWith(`cpu-studio-dish-release:${studioDishReviewKey(dish.id, dish.version)}:v`);
  })) return undefined;
  return payload;
}
