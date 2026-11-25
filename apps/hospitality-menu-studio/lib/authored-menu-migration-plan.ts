import { z } from "zod";
import { hospitalityCalendarDay } from "../../shared/hospitality-menu-date";
import { dishSchema, idSchema, menuSchema } from "../../shared/hospitality-menu-studio-content";
import { productMenuConfiguration, type ProductMenuConfiguration } from "../../shared/hospitality-menu-studio-product-content";
import {
  canonicalJson, decodeStudioPublication, maximumStudioPublicationBytes, publicationDigest, publicationHash, studioPublicationDescriptor,
  type PublicationPackage,
} from "../../shared/hospitality-menu-studio-publication";

const snapshot = z.strictObject({
  contract: z.literal("fika.studio-authored-menu-export.v1"),
  projectId: z.enum(["demo-fika-os", "fika-os-dev"]),
  capturedAt: z.iso.datetime(),
  catalogueHash: publicationDigest,
  menus: z.array(z.strictObject({ item: menuSchema.strict(), archiveHash: publicationDigest })).max(1_000),
  dishes: z.array(z.strictObject({ item: dishSchema.strict(), archiveHash: publicationDigest })).max(20_000),
  publications: z.array(z.strictObject({
    manifest: studioPublicationDescriptor, body: z.string().max(maximumStudioPublicationBytes),
  })).max(1_000),
  catalogueItems: z.array(z.strictObject({ id: idSchema, presentation: z.enum(["dropdown", "checkboxes", "quantities"]).optional() })).max(20_000),
  existingProductDraftIds: z.array(idSchema).max(20_000),
});

type Candidate = {
  legacyMenuId: string;
  legacyMenuVersion: number;
  legacyMenuHash: string;
  legacySectionId: string;
  legacyStartDate: string | null;
  legacyEndDate: string | null;
  legacyMode: "static" | "rotation";
  legacyAnchorMonday: string | null;
  legacySlots: string[][];
  itemId: string;
  bindingPublicationIds: string[];
  configuration?: ProductMenuConfiguration;
  blockers: string[];
};

function indexById<T>(rows: T[], idFor: (row: T) => string) {
  const index = new Map<string, T>();
  for (const row of rows) {
    const id = idFor(row);
    if (index.has(id)) throw Error("The snapshot contains a duplicate authoritative identity.");
    index.set(id, row);
  }
  return index;
}

/** Plan inactive drafts only. Original menu, publication and customer records are outside this plan. */
export function planAuthoredStudioMenuMigration(input: unknown) {
  const source = snapshot.parse(input);
  const menus = indexById(source.menus, row => row.item.id);
  const dishes = indexById(source.dishes, row => dishRevisionKey(row.item.id, row.item.version));
  const publications = indexById(source.publications, row => row.manifest.id);
  const catalogue = indexById(source.catalogueItems, row => row.id);
  const existing = new Set(source.existingProductDraftIds);
  if (existing.size !== source.existingProductDraftIds.length) throw Error("The snapshot contains a duplicate product draft identity.");
  for (const { item, archiveHash } of [...menus.values(), ...dishes.values()]) {
    if (item.version < 1 || publicationHash(canonicalJson(item)) !== archiveHash) {
      throw Error("The source record did not match its exact archived revision.");
    }
  }
  const bindings = new Map<string, PublicationPackage[]>();
  for (const { manifest, body } of publications.values()) {
    const published = decodeStudioPublication(body, manifest, source.projectId);
    if (!published) throw Error("The supplied legacy publication could not be verified.");
    const sourceMenu = menus.get(manifest.menuId);
    // A scoped or changed menu package cannot establish what this saved draft contained.
    if (published.scope || !sourceMenu || published.sourceDraftVersion !== sourceMenu.item.version ||
        publicationHash(canonicalJson(published.menu)) !== sourceMenu.archiveHash) continue;
    const existing = bindings.get(manifest.menuId) ?? [];
    bindings.set(manifest.menuId, [...existing, published]);
  }

  const sourcesPerProduct = new Map<string, number>();
  for (const { item } of menus.values()) {
    for (const section of item.sections) {
      const id = section.catalogueItemId;
      if (id) sourcesPerProduct.set(id, (sourcesPerProduct.get(id) ?? 0) + 1);
    }
  }

  const candidates: Candidate[] = [];
  for (const menuId of [...menus.keys()].sort()) {
    const { item: menu, archiveHash } = menus.get(menuId)!;
    const evidence = bindings.get(menuId) ?? [];
    for (const section of menu.sections) {
      const itemId = section.catalogueItemId;
      const blockers: string[] = [];
      const policy = catalogue.get(itemId);
      if (!itemId || !policy) blockers.push("CURRENT_CANONICAL_ITEM_REQUIRED");
      if (itemId && existing.has(itemId)) blockers.push("PRODUCT_DRAFT_ALREADY_EXISTS");
      if ((sourcesPerProduct.get(itemId) ?? 0) > 1) blockers.push("MULTIPLE_LEGACY_SOURCES_FOR_PRODUCT");
      if (menu.kind === "collection") blockers.push("COLLECTION_SCOPE_REVIEW_REQUIRED");
      if (!menu.startDate || !menu.endDate || menu.endDate < menu.startDate) blockers.push("LEGACY_DATE_WINDOW_UNVERIFIED");
      if (section.mode === "rotation" && new Date(hospitalityCalendarDay(menu.anchorMonday)).getUTCDay() !== 1) blockers.push("LEGACY_ANCHOR_MONDAY_UNVERIFIED");
      if (policy && !policy.presentation) blockers.push("REVIEWED_CHOICE_PRESENTATION_REQUIRED");
      const slots = section.mode === "rotation" ? section.weeks : [section.staticDishIds];
      const references = new Map<string, { dishId: string; revision: number }>();
      for (const dishId of new Set(slots.flat())) {
        const bound = evidence.flatMap(publication => publication.dishes.filter(record => record.dish.id === dishId));
        const keys = new Set(bound.map(({ dish }) => dishRevisionKey(dish.id, dish.version)));
        const archive = keys.size === 1 ? dishes.get([...keys][0]) : undefined;
        if (!archive || bound.some(({ dish }) => publicationHash(canonicalJson(dish)) !== archive.archiveHash)) continue;
        references.set(dishId, { dishId, revision: archive.item.version });
      }
      if (references.size !== new Set(slots.flat()).size) blockers.push("EXACT_DISH_REVISION_REQUIRED");

      const candidate: Candidate = {
        legacyMenuId: menu.id, legacyMenuVersion: menu.version, legacyMenuHash: archiveHash,
        legacySectionId: section.id, legacyStartDate: menu.startDate || null, legacyEndDate: menu.endDate || null,
        legacyMode: section.mode, legacyAnchorMonday: section.mode === "rotation" ? menu.anchorMonday || null : null,
        legacySlots: slots, itemId, bindingPublicationIds: evidence.map(publication => publication.publicationId).sort(), blockers,
      };
      if (!blockers.length && policy?.presentation) {
        const choices = slots.map(slot => ({
          dishes: slot.map(id => references.get(id)!),
          groups: [],
        }));
        const parsed = productMenuConfiguration.safeParse({
          presentation: policy.presentation, groups: [],
          schedule: section.mode === "static" ? { kind: "fixed", choices: choices[0] }
            : { kind: "rotation", anchorMonday: menu.anchorMonday, weeks: choices },
        });
        if (parsed.success) candidate.configuration = parsed.data;
        else blockers.push("PRODUCT_DRAFT_CANNOT_REPRESENT_SOURCE");
      }
      candidates.push(candidate);
    }
  }
  const plan = {
    contract: "fika.studio-authored-menu-migration-plan.v1",
    projectId: source.projectId, capturedAt: source.capturedAt, catalogueHash: source.catalogueHash,
    executable: false, activatable: false, status: candidates.some(candidate => candidate.blockers.length) ? "BLOCKED" : "REVIEW_REQUIRED",
    // Keep original date windows and historical packages as source lineage. An inactive draft is not an active schedule.
    candidates,
  };
  return { ...plan, planHash: publicationHash(canonicalJson(plan)) };
}

function dishRevisionKey(dishId: string, revision: number) { return `${dishId}@${revision}`; }
