import { createHash } from "node:crypto";
import { z } from "zod";
import {
  BusinessDate, DISH_OPERATIONAL_SCOPES, DishReference, HOSPITALITY_DISH_CLASS_IDS, INITIAL_ROTATION_CYCLE_WEEKS,
  ROTATION_PICKER_SCOPES, ROTATIONS_SCHEMA, RotationConfiguration, RotationDraftConfiguration, londonDate, publishedRevisionFor,
} from "../../apps/shared/hospitality-rotations.ts";
import { stableDocumentId } from "../../packages/server-shared/src/stable-document-id.ts";

const sourceSchema = "hospitality-rotations-export.v1";
const Id = DishReference.shape.dishId;
const Revision = z.number().int().positive();
const Hash = z.string().regex(/^[0-9a-f]{64}$/);
const NonBlank = z.string().max(500).refine(value => value.trim() !== "");
const DateTime = z.iso.datetime();
const ProviderRecord = z.looseObject({});
const Document = z.strictObject({ id: Id, data: ProviderRecord });
const LegacyHead = z.strictObject({
  schema: z.literal(ROTATIONS_SCHEMA),
  version: z.number().int().min(0).max(10_000),
  draftRevision: Revision.optional(),
  activations: z.array(z.strictObject({ revision: Revision, effectiveFrom: BusinessDate })).max(100),
});
const ExactRecipe = DishReference.extend({ record: ProviderRecord });
const RevisionMetadata = {
  schema: z.literal(ROTATIONS_SCHEMA),
  revision: Revision,
  configuration: z.unknown(),
  actorId: NonBlank,
  recordedAt: DateTime,
  requestId: Id,
  evidenceHash: Hash,
};
const LegacyRevision = z.discriminatedUnion("status", [
  z.strictObject({ ...RevisionMetadata, status: z.literal("draft") }),
  z.strictObject({
    ...RevisionMetadata, status: z.literal("published"), effectiveFrom: BusinessDate,
    sourceDraftRevision: Revision, reason: NonBlank, recipes: z.array(ExactRecipe).max(150),
  }),
]);
const DishLink = z.strictObject({
  schema: z.literal("hospitality-rotation-dish-link.v1"),
  itemId: Id,
  dishId: Id,
  classification: z.enum(HOSPITALITY_DISH_CLASS_IDS),
  actorId: NonBlank,
  recordedAt: DateTime,
  requestId: Id,
});
const LegacyExport = z.strictObject({
  schema: z.literal(sourceSchema),
  projectId: z.string().regex(/^[a-z][a-z0-9-]{4,62}$/),
  capturedAt: DateTime,
  head: LegacyHead.nullable(),
  revisions: z.array(Document).max(10_000),
  dishLinks: z.array(Document).max(10_000),
  dishLinksByDish: z.array(Document).max(10_000),
  dishes: z.array(Document).max(10_000),
  items: z.array(Document).max(10_000),
  destinationBindings: z.array(DishReference.extend({ sourceHash: Hash })).max(10_000).optional(),
});

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

// Identical key ordering and array semantics to Hub RotationStore's persisted evidenceHash.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => compare(a, b))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

function contentHash(value) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

function indexBy(items, keyFor, kind, report) {
  const index = new Map();
  for (const item of items) {
    const key = keyFor(item);
    if (index.has(key)) {
      report("blocker", "DUPLICATE_IDENTITY", kind, key);
    } else {
      index.set(key, item);
    }
  }
  return index;
}

function dishKey(dish) {
  return `${dish.dishId}@${dish.recipeRevision}`;
}

function collectRevisions(source, head, report) {
  const revisions = new Map();
  const documents = indexBy(source.revisions, document => document.id, "rotation-revision", report);
  for (const [id, { data }] of documents) {
    const parsed = LegacyRevision.safeParse(data);
    if (!parsed.success || id !== String(parsed.data.revision)) {
      report("blocker", "INVALID_LEGACY_REVISION", "rotation-revision", id);
      continue;
    }
    const { evidenceHash, ...evidence } = data;
    if (contentHash(evidence) !== evidenceHash) {
      report("blocker", "REVISION_HASH_MISMATCH", "rotation-revision", id);
      continue;
    }
    const revision = parsed.data;
    const configuration = revision.status === "published" ? RotationConfiguration : RotationDraftConfiguration;
    const result = configuration.safeParse(revision.configuration);
    if (!result.success) {
      report("blocker", "INVALID_ROTATION_CONFIGURATION", "rotation-revision", id);
      continue;
    }
    if (revision.revision > head.version) report("blocker", "REVISION_AHEAD_OF_HEAD", "rotation-revision", id);
    revisions.set(revision.revision, { ...revision, configuration: result.data });
  }

  let lastDraft;
  for (let number = 1; number <= head.version; number += 1) {
    const revision = revisions.get(number);
    if (!revision) {
      report("blocker", "MISSING_LEGACY_REVISION", "rotation-revision", String(number));
      continue;
    }
    if (revision.status === "draft") {
      lastDraft = revision;
    } else if (!lastDraft || lastDraft.revision !== revision.sourceDraftRevision ||
      contentHash(lastDraft.configuration) !== contentHash(revision.configuration)) {
      report("blocker", "PUBLISHED_DRAFT_LINEAGE_MISMATCH", "rotation-revision", String(number));
    }
  }
  if (head.draftRevision !== lastDraft?.revision) report("blocker", "DRAFT_POINTER_MISMATCH", "rotation-head", "company");

  const activations = indexBy(head.activations, entry => entry.revision, "activation", report);
  let previous;
  for (const entry of head.activations) {
    const recorded = revisions.get(entry.revision);
    if (previous && (previous.effectiveFrom >= entry.effectiveFrom || previous.revision >= entry.revision)) {
      report("blocker", "ACTIVATIONS_OUT_OF_ORDER", "activation", String(entry.revision));
    }
    if (recorded?.status !== "published" || recorded.effectiveFrom !== entry.effectiveFrom) {
      report("blocker", "ACTIVATION_REVISION_MISMATCH", "activation", String(entry.revision));
    }
    previous = entry;
  }
  for (const revision of revisions.values()) {
    if (revision.status === "published" && !activations.has(revision.revision)) {
      report("blocker", "PUBLISHED_REVISION_UNREFERENCED", "rotation-revision", String(revision.revision));
    }
  }
  return revisions;
}

const DishMetadata = z.looseObject({
  canonicalId: Id,
  revision: Revision,
  displayName: NonBlank,
  reviewStatus: NonBlank.optional(),
  operationalScope: z.enum(DISH_OPERATIONAL_SCOPES).optional(),
  hospitalityClass: z.enum(HOSPITALITY_DISH_CLASS_IDS).optional(),
});

function readDishes(source, report) {
  const documents = indexBy(source.dishes, document => document.id, "catalogue-dish", report);
  const records = new Map();
  for (const [id, { data }] of documents) {
    const parsed = DishMetadata.safeParse(data.record ?? data);
    if (data.kind !== "dish" || !parsed.success || parsed.data.canonicalId !== id) {
      report("blocker", "INVALID_CATALOGUE_DISH", "catalogue-dish", id);
      continue;
    }
    records.set(id, parsed.data);
  }
  return records;
}

function readItems(source, report) {
  const documents = indexBy(source.items, document => document.id, "catalogue-item-record", report);
  const records = new Map();
  for (const [id, { data }] of documents) {
    const match = Id.safeParse(data.canonicalId);
    if (!match.success || id !== stableDocumentId(match.data) || data.entityType !== "Hospitality Menu Item" || !ProviderRecord.safeParse(data.record).success) {
      report("blocker", "INVALID_CATALOGUE_ITEM", "catalogue-item-record", id);
      continue;
    }
    records.set(match.data, data);
  }
  return records;
}

function activeItem(item) {
  return item && item.lifecycleStatus !== "archived" && item.record.lifecycleState !== "archived" &&
    item.publicationStatus !== "withdrawn";
}

function readLinkIndex(documents, property, kind, report) {
  const rows = indexBy(documents, document => document.id, kind, report);
  const links = new Map();
  for (const [id, { data }] of rows) {
    const parsed = DishLink.safeParse(data);
    if (!parsed.success || stableDocumentId(parsed.data[property]) !== id) {
      report("blocker", "INVALID_DESIGNATED_DISH_LINK", kind, id);
      continue;
    }
    links.set(parsed.data[property], parsed.data);
  }
  return links;
}

function assessLinks(source, dishes, items, report) {
  const byItem = readLinkIndex(source.dishLinks, "itemId", "item-dish-link", report);
  const byDish = readLinkIndex(source.dishLinksByDish, "dishId", "dish-item-link", report);
  function checkPair(link, opposite) {
    if (!opposite || contentHash(opposite) !== contentHash(link)) {
      report("blocker", "DESIGNATED_DISH_LINK_MISMATCH", "catalogue-item", link.itemId);
    }
  }
  for (const link of byDish.values()) {
    checkPair(link, byItem.get(link.itemId));
  }
  for (const link of byItem.values()) {
    checkPair(link, byDish.get(link.dishId));
    const dish = dishes.get(link.dishId);
    if (!activeItem(items.get(link.itemId))) report("review", "DESIGNATED_ITEM_UNAVAILABLE", "catalogue-item", link.itemId);
    if (!dish || dish.reviewStatus === "archived" || !ROTATION_PICKER_SCOPES.includes(dish.operationalScope)) {
      report("review", "DESIGNATED_DISH_UNAVAILABLE", "catalogue-dish", link.dishId);
    } else if (dish.hospitalityClass && dish.hospitalityClass !== link.classification) {
      report("review", "DESIGNATED_CLASSIFICATION_CHANGED", "catalogue-dish", link.dishId);
    }
  }
  return [...byItem.values()].sort((a, b) => compare(a.itemId, b.itemId))
    .map(({ itemId, dishId, classification }) => ({ itemId, dishId, classification }));
}

function assessRecipes(revision, relevant, dishes, rememberDish, report) {
  const references = new Map(revision.configuration.groups.flatMap(group => group.dishBank).map(dish => [dishKey(dish), dish]));
  const revisionId = String(revision.revision);
  if (revision.status === "draft") {
    if (!relevant) return;
    for (const ref of references.values()) {
      const record = dishes.get(ref.dishId);
      if (!record || record.revision !== ref.recipeRevision || record.reviewStatus === "archived") {
        report("blocker", "CURRENT_DRAFT_DISH_REVISION_UNAVAILABLE", "rotation-revision", revisionId, dishKey(ref));
      }
    }
    return;
  }

  const recipes = indexBy(revision.recipes, dishKey, `frozen-recipes-for-${revisionId}`, report);
  for (const [key, ref] of references) {
    const snapshot = recipes.get(key);
    const record = DishMetadata.safeParse(snapshot?.record);
    if (!record.success || ref.dishId !== record.data.canonicalId || ref.recipeRevision !== record.data.revision) {
      report("blocker", "FROZEN_RECIPE_MISSING_OR_MISMATCHED", "rotation-revision", revisionId, key);
      continue;
    }
    if (record.data.reviewStatus === "archived") {
      report("blocker", "ARCHIVED_RECIPE_IN_PUBLICATION", "rotation-revision", revisionId, key);
    }
    rememberDish(record.data, "frozen");
    if (relevant) {
      if (!ROTATION_PICKER_SCOPES.includes(record.data.operationalScope)) {
        report("blocker", "LIVE_FROZEN_RECIPE_SCOPE_UNSUPPORTED", "rotation-revision", revisionId, key);
      }
      report("review", "STUDIO_CONTENT_AND_SAFETY_REVIEW_REQUIRED", "dish-source", key);
    }
  }
  for (const key of recipes.keys()) {
    if (!references.has(key)) report("blocker", "UNREFERENCED_FROZEN_RECIPE", "rotation-revision", revisionId, key);
  }
}

export function planRotationMigration(raw) {
  const parsed = LegacyExport.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(issue => ({ code: issue.code, path: issue.path }));
    return { status: "INVALID_EXPORT", issues };
  }
  const source = parsed.data;
  const eventDate = londonDate(new Date(source.capturedAt));
  const head = source.head ?? { schema: ROTATIONS_SCHEMA, version: 0, activations: [] };
  const issueSet = new Map();
  const report = (severity, code, entity, id, reference) => {
    const issue = { severity, code, entity, id: String(id), ...(reference !== undefined ? { reference } : {}) };
    issueSet.set(JSON.stringify(issue), issue);
  };

  const revisions = collectRevisions(source, head, report);
  const dishes = readDishes(source, report);
  const items = readItems(source, report);
  const designatedLinks = assessLinks(source, dishes, items, report);
  const relevantRevision = publishedRevisionFor(head, eventDate);
  const liveRevisions = new Set(head.activations.filter(entry => entry.effectiveFrom >= eventDate).map(entry => entry.revision));
  liveRevisions.add(relevantRevision);
  liveRevisions.add(head.draftRevision);

  const dishSources = new Map();
  function rememberDish(record, sourceLocation) {
    const ref = { dishId: record.canonicalId, recipeRevision: record.revision };
    const key = dishKey(ref);
    const sourceHash = contentHash(record);
    const earlier = dishSources.get(key);
    if (earlier) {
      if (earlier.sourceHash !== sourceHash) report("blocker", "DISH_REVISION_CONTENT_CONFLICT", "dish-source", key);
      return;
    }
    const current = sourceLocation === "catalogue" && record.reviewStatus !== "archived";
    let action = "PRESERVE_HISTORICAL_SOURCE";
    if (current && record.operationalScope === "HOSPITALITY_ROTATIONS") action = "PROPOSE_INACTIVE_DRAFT";
    if (current && record.operationalScope === "SHARED") action = "KEEP_EXACT_PROVIDER_REFERENCE";
    if (action !== "PRESERVE_HISTORICAL_SOURCE") {
      report("review", "STUDIO_CONTENT_AND_SAFETY_REVIEW_REQUIRED", "dish-source", key);
      if (!record.hospitalityClass) report("review", "LEGACY_CLASSIFICATION_UNRECORDED", "dish-source", key);
    }
    dishSources.set(key, { ...ref, sourceHash, scope: record.operationalScope ?? "UNRECORDED", action });
  }

  for (const record of [...dishes.values()].sort((a, b) => compare(a.canonicalId, b.canonicalId))) {
    if (ROTATION_PICKER_SCOPES.includes(record.operationalScope)) rememberDish(record, "catalogue");
  }
  const rotationRevisions = [...revisions.values()].sort((a, b) => a.revision - b.revision).map(revision => {
    const relevant = liveRevisions.has(revision.revision);
    const { calendar, categories, groups } = revision.configuration;
    assessRecipes(revision, relevant, dishes, rememberDish, report);
    if (relevant && calendar.cycleWeeks !== INITIAL_ROTATION_CYCLE_WEEKS) {
      report("blocker", "STUDIO_SIX_WEEK_CYCLE_INCOMPATIBLE", "rotation-revision", String(revision.revision));
    }
    for (const group of groups) {
      if (relevant && !activeItem(items.get(group.itemId))) {
        report("blocker", "CURRENT_ITEM_UNAVAILABLE", "rotation-group", group.id, group.itemId);
      }
      if (revision.revision === head.draftRevision) {
        for (const ref of group.dishBank) {
          const dish = dishes.get(ref.dishId);
          if (dish && !ROTATION_PICKER_SCOPES.includes(dish.operationalScope)) {
            report("blocker", "CURRENT_DRAFT_DISH_SCOPE_UNSUPPORTED", "rotation-group", group.id, dishKey(ref));
          }
        }
      }
    }
    return {
      revision: revision.revision, status: revision.status, evidenceHash: revision.evidenceHash, calendar,
      ...(revision.status === "published" ? { sourceDraftRevision: revision.sourceDraftRevision, effectiveFrom: revision.effectiveFrom } : {}),
      categories: categories.map(({ id }) => id),
      groups: groups.map(({ id, categoryId, itemId, dishBank, weeks, rules }) => ({
        id, categoryId, itemId, dishBank, weeks, legacyRuleHash: contentHash(rules),
      })),
    };
  });

  if (source.destinationBindings === undefined) {
    report("review", "DESTINATION_BINDINGS_UNCHECKED", "source-export", source.projectId);
  } else {
    const target = indexBy(source.destinationBindings, dishKey, "destination-binding", report);
    for (const [key, binding] of target) {
      const dish = dishSources.get(key);
      if (dish && dish.sourceHash !== binding.sourceHash) report("blocker", "DESTINATION_SOURCE_HASH_CONFLICT", "dish-source", key);
    }
  }

  const issues = [...issueSet.entries()].sort(([a], [b]) => compare(a, b)).map(([, issue]) => issue);
  const plan = {
    source: { projectId: source.projectId, capturedAt: source.capturedAt, inventoryDate: eventDate, headVersion: head.version },
    legacyActivationManifest: head.activations,
    ...(head.draftRevision ? { draftRevision: head.draftRevision } : {}),
    ...(relevantRevision ? { effectiveLegacyRevision: relevantRevision } : {}),
    rotationRevisions,
    designatedLinks,
    dishSources: [...dishSources.values()].sort((a, b) => compare(dishKey(a), dishKey(b))),
    issues,
  };
  return {
    schema: "hospitality-menu-studio-migration-report.v1",
    status: issues.some(issue => issue.severity === "blocker") ? "BLOCKED" : "REVIEW_REQUIRED",
    activatable: false,
    planHash: contentHash(plan),
    ...plan,
  };
}
