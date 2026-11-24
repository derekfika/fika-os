import { mirrorEnabled } from "../../shared/cpux-calendar/google";
import { londonServiceDate } from "../../shared/cpux-calendar/contract";
import { DELIVERED_IN_MIRROR_EVENT } from "./cpux-mirror/source";
import { menuDestination, menuDestinationKey, type MenuDestination } from "@fika/server-shared/menu-destination";
import type { ExplicitRowReview, NoKeyDeclarationRecord } from "../../shared/allergen-declaration";
import { hospitalityArchiveBase } from "./hospitality-archive-url";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CANONICAL_ALLERGEN_KEYS, type CanonicalAllergenMap } from "./fika-contracts";
import type {
  RollingDay,
  RollingEntry,
  RollingSnapshot,
  RollingWeek,
} from "./rolling-menu-types";
import {
  getWeek,
  listWeeks,
  normaliseRollingSnapshotDestinations,
  replaceSnapshotInStored,
  saveSnapshot,
  snapshotFromStored,
  slotsForWeek,
  validateWeek,
  activeCanonicalDishIdsFor,
  type Stored as RollingMenuStored,
} from "./rolling-menu";
import type { GovernedOploc } from "./oploc-authority";
import { menuSiteIdentity, menuSiteKey, type SitePax } from "./site-pax";
import { CANONICAL_MENU_SLOTS, canonicalMenuSlotIdFor, MENU_ORDER_VERSION, orderMenuEntries } from "../../shared/menu-section-order";
import { renderPdfLocally } from "./local-pdf";
import { resolveAllergenSnapshot } from "./allergen-resolution";
import type { MenuItem } from "./domain";
import { listCanonicalMenuItemsByIds } from "./canonical-menu-repository";
import {
  publishedAllergenMatrixHtml,
  createDomainEvent,
  markEventDelivered,
  markEventFailed,
  type DurableDomainEvent,
  type FulfilmentRequirement,
} from "./fika-contracts";
import {
  claimNextMenuPlanningEvent,
  getPublicationById,
  getPublishedSnapshot,
  claimMenuPlanningEventById,
  getMenuPlanningEvent,
  listPublicationState,
  readPublicationState,
  readPublicationStateForDateRange,
  readPublicationStateForWeek,
  updateMenuPlanningEvent,
  resetMenuPlanningEvent,
  withMenuPlanningTransaction,
} from "./operational-store";
import {
  decodeWeeklyPublicationPacket,
  encodeWeeklyPublicationPacket,
  type RetainedMenuSiteLineage,
  type WeeklyPublicationPacket,
} from "@fika/server-shared/weekly-publication-packet";

export const PUBLICATION_ATTESTATION =
  "I confirm that I have reviewed the allergen information shown for this day's published menu and that it reflects the approved information available at the time of publication.";
export type MenuPublicationSignature = {
  printedName: string;
  signatureDataUrl?: string;
  signedAt: string;
  actor: string;
  attestation: string;
};
export type MenuPublicationSignoff = {
  date?: string;
  productionChef?: MenuPublicationSignature;
  headChefSiteManager?: MenuPublicationSignature;
  dayContentHash?: string;
};
export type MenuPublicationWeekPublishInput = { weekContentHash?: string };
export type PublishedMenuEntry = {
  sourceEntryId: string;
  slot: string;
  /** Present on newly generated revisions; absent on immutable legacy evidence. */
  menuOrderVersion?: typeof MENU_ORDER_VERSION;
  canonicalSlotId?: string;
  canonicalOrderIndex?: number;
  canonicalDishId?: string;
  /** Manual placement marker; legacy publications omit it and are not Core. */
  isCoreSalad?: boolean;
  dishName: string;
  portions: number;
  allocations: Array<{
    destinationId?: string;
    destination?: MenuDestination;
    destinationLabel: string;
    destinationAddress?: string;
    quantity: number;
  }>;
  allergens: CanonicalAllergenMap;
  allergenReview?: import("../../shared/allergen-review").AllergenRowReview | ExplicitRowReview;
  noKeyDeclaration?: NoKeyDeclarationRecord;
  /** Legacy snapshots may omit this; all newly published entries write it. */
  allergenEvidenceStatus?: "confirmed" | "unreviewed" | "missing" | "conflicting";
  allergenEvidenceReason?: string;
  /** Stable semantic fingerprint of canonical ingredients, recipe inputs and complete allergen evidence. */
  allergenEvidenceHash?: string;
  /** Hash of the authoritative canonical ingredient/yield revision used in the evidence fingerprint. */
  canonicalIngredientRecipeHash?: string;
  /** False/absent means equivalence cannot be proven and an amendment requires fresh review. */
  allergenEvidenceComplete?: boolean;
  mayContainNotes?: string; allergenDetailNotes?: string;
};
export type CompiledPublishedWeekSnapshot = {
  schemaVersion: 1;
  /** Absent for legacy publications that predate canonical slot metadata. */
  menuOrderVersion?: typeof MENU_ORDER_VERSION;
  snapshotId: string;
  publicationId: string;
  sourceWeekId: string;
  sourceWeekVersion: number;
  publicationVersion: number;
  publishedAt: string;
  publishedBy: string;
  contentHash: string;
  sourceLineage: {
    sourceDomain: "menu-planning";
    sourceEntityId: string;
    publicationId: string;
    sourceWeekVersion: number;
    publicationVersion: number;
    sourceContentHash: string;
  };
  week: { weekCommencing: string; weekEnding: string };
  days: Array<{
    publicationDayId: string;
    sourceDayId: string;
    date: string;
    dayName: string;
    serviceMenu?: { id: string; name: string; serviceType: string; serviceTime?: string; kitchenNotes?: string };
    version: number;
    destinationPax?: SitePax;
    retainedSiteLineage?: RetainedMenuSiteLineage;
    entries: PublishedMenuEntry[];
  }>;
};
export type DriveArchive = {
  status: "saved" | "not_configured" | "failed";
  fileId?: string;
  driveUrl?: string;
  account: string;
  fileName: string;
  archivedAt: string;
  pdfStatus: "saved" | "not_configured" | "failed" | "unavailable";
  pdfFileId?: string;
  pdfDriveUrl?: string;
  pdfFileName: string;
};
export type PublishedMenuDay = {
  publicationDayId: string;
  sourceDayId: string;
  date: string;
  dayName: string;
  serviceMenu?: { id: string; name: string; serviceType: string; serviceTime?: string; kitchenNotes?: string };
  version: number;
  status: "published" | "superseded" | "withdrawn";
  contentHash: string;
  publishedAt: string;
  publishedBy: string;
  destinationPax?: SitePax;
  retainedSiteLineage?: RetainedMenuSiteLineage;
  entries: PublishedMenuEntry[];
  allergenSignoff?: MenuPublicationSignoff;
  driveArchive?: DriveArchive;
  withdrawal?: { actor: string; at: string; reason: string };
};
export type MenuPublication = {
  publicationId: string;
  sourceWeekId: string;
  weekCommencing: string;
  weekEnding: string;
  publicationVersion?: number;
  publicationStatus?: "published" | "withdrawn";
  compiledSnapshotId?: string;
  /** Current one-document downstream handoff. */ weekPacket?: WeeklyPublicationPacket<CompiledPublishedWeekSnapshot>;
  days: PublishedMenuDay[];
  audit: Array<{
    action: string;
    at: string;
    by: string;
    publicationDayId?: string;
    requestId?: string;
    changeSetHash?: string;
    impactSummary?: PublishedWeekAmendmentImpactSummary;
    sourceWeekVersion?: number;
    handoffEventIds?: string[];
  }>;
};
export type MenuPublicationCommandResult = MenuPublication & { readonly handoffEventIds?: readonly string[] };
type StoredPublications = {
  version: 2;
  publications: MenuPublication[];
  events: DurableDomainEvent[];
  snapshots?: Record<string, CompiledPublishedWeekSnapshot>;
  /** Legacy migration field; central Integration Hub is authoritative. */ fulfilmentRequirements?: FulfilmentRequirement[];
};
const now = () => new Date().toISOString();
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
};
export const contentHash = (value: unknown) =>
  createHash("sha256").update(stable(value)).digest("hex");
export function serviceDaysForWeek(snapshot: RollingSnapshot) {
  const menu = snapshot.week.supplementaryMenu;
  if (!menu) return snapshot.days.slice(0, 5);
  if (menu.serviceDate) return snapshot.days.filter(day => day.date === menu.serviceDate);
  if (menu.recurrenceWeekdays?.length) return snapshot.days.filter(day => menu.recurrenceWeekdays!.includes(new Date(`${day.date}T00:00:00Z`).getUTCDay() || 7));
  return [];
}
/** True only when a server-stamped working draft still targets the current publication lineage. */
export function hasCurrentPublishedWorkingDraft(week: Pick<RollingWeek, "audit">, publication: Pick<MenuPublication, "days"> | undefined, sourceDayId?: string) {
  if (!publication) return false;
  const current = new Map(publication.days.filter(day => day.status === "published").map(day => [day.sourceDayId, day.publicationDayId]));
  return week.audit.some(event => {
    if (event.action !== "week-draft-saved") return false;
    const lineages = (event as typeof event & { workingDraftLineage?: Array<{ dayId: string; publicationDayId: string }> }).workingDraftLineage;
    return Array.isArray(lineages) && lineages.some(lineage => (!sourceDayId || lineage.dayId === sourceDayId) && current.get(lineage.dayId) === lineage.publicationDayId);
  });
}
const read = async (): Promise<StoredPublications> => {
  const value = await readPublicationState<Partial<StoredPublications>>();
  if (!Array.isArray(value.publications))
    throw Object.assign(
      new Error(
        "Menu publication data is unavailable; no publication list was loaded.",
      ),
      { status: 503 },
    );
  return {
    version: 2,
    publications: value.publications,
    events: Array.isArray(value.events) ? value.events : [],
    snapshots: value.snapshots || {},
  };
};
const clone = <T>(value: T): T => structuredClone(value);
/** Normalize only publication/event graphs before hashing or persistence. */
const normalizePublicationValue = <T>(value: T): T => {
  if (Array.isArray(value))
    return value.map((item) => normalizePublicationValue(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, normalizePublicationValue(item)]),
    ) as T;
  }
  return value;
};
export const publishedDayMatrixHtml = publishedAllergenMatrixHtml;
const populatedWeekdays = (snapshot: RollingSnapshot) =>
  serviceDaysForWeek(snapshot)
    .filter((day) =>
      snapshot.entries.some(
        (entry) => entry.dayId === day.id && entry.itemLabel.trim(),
      ),
    );
export type PublicationBuildOptions = { requireAuthoritativeCatalogue?: boolean; allowExplicitReviewWithoutCatalogue?: boolean };
const hostedPublication = () => ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");
const canonicalDishFor = (canonicalDishes: readonly MenuItem[], itemId?: string) => itemId ? canonicalDishes.find(item => item.canonicalId === itemId) : undefined;
// Canonical validation covers every named working row, including zero-allocation dishes.
// Production/packet entries remain separately limited to positive allocations below.
export const referencedCanonicalDishIds = (snapshot: RollingSnapshot, dayId?: string) => [...new Set(snapshot.entries.filter(entry => (!dayId || entry.dayId === dayId) && entry.itemLabel.trim()).map(entry => entry.itemId?.trim()).filter((id): id is string => Boolean(id)))];
async function authoritativeDishesFor(snapshot: RollingSnapshot, dayId?: string) {
  // Local/test mode has an explicit entry-review fixture path. Hosted
  // publication is always bound to the Firestore targeted lookup below.
  return hostedPublication() ? listCanonicalMenuItemsByIds(referencedCanonicalDishIds(snapshot, dayId)) : [];
}
const publishedEntry = (
  entry: RollingEntry,
  canonicalDish?: MenuItem,
  options: PublicationBuildOptions = {},
  day?: RollingDay,
): PublishedMenuEntry => {
  const activeAllocations = entry.allocations.filter(
    (allocation) =>
      Number.isFinite(allocation.quantity) && allocation.quantity > 0,
  );
  const allowExplicitFixture = options.allowExplicitReviewWithoutCatalogue ?? !options.requireAuthoritativeCatalogue;
  const hasExplicitReview = entry.allergenReviewInvalidated === false || Object.values(entry.allergens || {}).some(value => value === "contains" || value === "may_contain");
  const resolved = allowExplicitFixture && hasExplicitReview && !canonicalDish
    ? resolveAllergenSnapshot({ ...entry, itemId: undefined }, undefined)
    : resolveAllergenSnapshot(entry, canonicalDish);
  if (options.requireAuthoritativeCatalogue && resolved.structuralIssue) {
    throw Object.assign(new Error(`${day?.dayName || "Menu day"}: ${entry.itemLabel || entry.slot} cannot be published because governed allergen evidence is unresolved (${resolved.unresolved.join(", ")}).`), { status: 422, code: "PUBLICATION_ALLERGEN_UNRESOLVED" });
  }
  const mayContainNotes = entry.mayContainNotes ?? resolved.mayContainNotes;
  const allergenEvidenceComplete = Boolean(
    canonicalDish && canonicalDish.ingredients?.length && canonicalDish.allergenEvidence.length > 0 && canonicalDish.mayContainReviewed &&
    canonicalDish.allergenEvidence.every(evidence => evidence.value === "contains" || evidence.value === "free_from" || evidence.value === "may_contain") &&
    resolved.evidenceStatus === "confirmed" && CANONICAL_ALLERGEN_KEYS.every(key => ["clear", "contains", "may_contain"].includes(resolved.allergens[key] || "")),
  );
  const canonicalIngredientRecipeHash = canonicalDish ? contentHash({
    canonicalDishId: canonicalDish.canonicalId,
    ingredients: (canonicalDish.ingredients || []).map(ingredient => ({
      name: ingredient.name.trim().normalize("NFKC").toLocaleLowerCase("en-GB"),
      ...(ingredient.quantity !== undefined ? { quantity: ingredient.quantity } : {}),
      ...(ingredient.unit ? { unit: ingredient.unit.trim().normalize("NFKC").toLocaleLowerCase("en-GB") } : {}),
      ...(ingredient.rawText ? { rawText: ingredient.rawText.trim().normalize("NFKC").toLocaleLowerCase("en-GB") } : {}),
    })),
    yield: canonicalDish.yield ?? null,
    yieldUnit: canonicalDish.yieldUnit?.trim().normalize("NFKC").toLocaleLowerCase("en-GB") || null,
  }) : undefined;
  const allergenEvidenceHash = canonicalDish ? contentHash({
    canonicalIngredientRecipeHash,
    evidence: canonicalDish.allergenEvidence.map(evidence => ({
      allergen: evidence.allergen.trim().normalize("NFKC").toLocaleLowerCase("en-GB"),
      value: evidence.value,
      source: evidence.source.trim().normalize("NFKC"),
      notes: evidence.notes?.trim().normalize("NFKC") || "",
    })).sort((left, right) => compareStableText(left.allergen, right.allergen) || compareStableText(left.value, right.value) || compareStableText(left.source, right.source)),
    mayContainReviewed: canonicalDish.mayContainReviewed,
    operationalAllergens: resolved.allergens,
    mayContainNotes: mayContainNotes?.trim().normalize("NFKC") || "",
    allergenDetailNotes: entry.allergenDetailNotes?.trim().normalize("NFKC") || "",
    allergenEvidenceStatus: resolved.evidenceStatus,
  }) : undefined;
  const canonicalSlotId = canonicalMenuSlotIdFor(entry.slot);
  const canonicalOrderIndex = canonicalSlotId
    ? CANONICAL_MENU_SLOTS.findIndex(item => item.id === canonicalSlotId)
    : -1;
  return normalizePublicationValue({
    sourceEntryId: entry.id,
    slot: entry.slot,
    menuOrderVersion: MENU_ORDER_VERSION,
    ...(entry.isCoreSalad && /^SALAD [1-6]$/i.test(entry.slot) ? { isCoreSalad: true } : {}),
    ...(canonicalSlotId && canonicalOrderIndex >= 0 ? { canonicalSlotId, canonicalOrderIndex } : {}),
    ...(canonicalDish?.canonicalId
      ? { canonicalDishId: canonicalDish.canonicalId }
      : {}),
    dishName: entry.itemLabel,
    portions: activeAllocations.reduce(
      (sum, allocation) => sum + allocation.quantity,
      0,
    ),
    allocations: activeAllocations.map(allocation => {
      const destination = menuDestination(allocation, entry.dayId, day?.oneOffDestinations || []);
      return {
        destination,
        ...(destination.kind === "governed" ? { destinationId: destination.id } : {}),
        destinationLabel: destination.label,
        ...(destination.kind === "one-off" ? (destination.address ? { destinationAddress: destination.address } : {}) : allocation.destinationAddress ? { destinationAddress: allocation.destinationAddress } : {}),
        quantity: allocation.quantity,
      };
    }),
    allergens: clone(resolved.allergens),
    ...(entry.allergenReview ? { allergenReview: clone(entry.allergenReview) } : {}),
    ...(entry.noKeyDeclaration ? { noKeyDeclaration: clone(entry.noKeyDeclaration) } : {}),
    allergenEvidenceStatus: resolved.evidenceStatus,
    ...(allergenEvidenceHash ? { allergenEvidenceHash, allergenEvidenceComplete, canonicalIngredientRecipeHash } : {}),
    ...(resolved.evidenceReason ? { allergenEvidenceReason: resolved.evidenceReason } : {}),
    ...(mayContainNotes !== undefined ? { mayContainNotes } : {}),
    ...(entry.allergenDetailNotes !== undefined ? { allergenDetailNotes: entry.allergenDetailNotes } : {}),
  });
};
const compareStableText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const allocationIdentity = (allocation: RollingEntry["allocations"][number]) =>
  menuDestinationKey(allocation)?.trim() ||
  `unresolved:${allocation.destinationLabel.trim().toLowerCase()}|${(allocation.destinationAddress || "").trim().toLowerCase()}`;
function orderedEntriesForDay(snapshot: RollingSnapshot, day: RollingDay) {
  const position = new Map((day.entryIds || []).map((id, index) => [id, index]));
  const slotPosition = new Map(
    [...slotsForWeek(snapshot.week), ...(snapshot.week.customSlots || [])].map((slot, index) => [slot, index]),
  );
  const entries = snapshot.entries
    .filter((entry) => entry.dayId === day.id && entry.itemLabel.trim() && entry.allocations.some((allocation) => Number.isFinite(allocation.quantity) && allocation.quantity > 0))
    .slice();
  return orderMenuEntries(entries.map((entry, index) => ({
    entry,
    slot: entry.slot,
    originalIndex: position.get(entry.id) ?? slotPosition.get(entry.slot) ?? index,
    sourceEntryId: entry.id,
  }))).map(({ entry }) => entry);
}
function historicalDayMatchesWorkingOrder(current: PublishedMenuDay, day: RollingDay, snapshot: RollingSnapshot, workingHash: string) {
  const { sourceDayId, date, dayName, destinationPax } = current;
  const originalContent = normalizePublicationValue({ sourceDayId, date, dayName, entries: current.entries, destinationPax });
  if (contentHash(originalContent) !== current.contentHash) return false;
  const entryPosition = new Map((day.entryIds || []).map((id, index) => [id, index]));
  const slotPosition = new Map([...slotsForWeek(snapshot.week), ...(snapshot.week.customSlots || [])].map((slot, index) => [slot, index]));
  const entries = current.entries.map(entry => ({ ...entry, allocations: entry.allocations.slice().sort((left, right) => compareStableText(allocationIdentity(left), allocationIdentity(right)) || compareStableText(left.destinationLabel, right.destinationLabel) || compareStableText(left.destinationAddress || "", right.destinationAddress || "") || left.quantity - right.quantity) })).sort((left, right) => {
    const leftPosition = entryPosition.get(left.sourceEntryId);
    const rightPosition = entryPosition.get(right.sourceEntryId);
    if (leftPosition !== undefined || rightPosition !== undefined)
      return (leftPosition ?? Number.MAX_SAFE_INTEGER) - (rightPosition ?? Number.MAX_SAFE_INTEGER) || compareStableText(left.sourceEntryId, right.sourceEntryId);
    const slotDifference = (slotPosition.get(left.slot) ?? Number.MAX_SAFE_INTEGER) - (slotPosition.get(right.slot) ?? Number.MAX_SAFE_INTEGER);
    return slotDifference || compareStableText(left.slot, right.slot) || compareStableText(left.sourceEntryId, right.sourceEntryId);
  });
  return contentHash(normalizePublicationValue({ sourceDayId, date, dayName, entries, destinationPax })) === workingHash;
}
export function buildPublishedDay(snapshot: RollingSnapshot, day: RollingDay, canonicalDishes: readonly MenuItem[] = [], options: PublicationBuildOptions = {}) {
  if (snapshot.week.menuOccurrenceStatus === "skipped") throw Object.assign(new Error("This recurring menu occurrence is skipped and cannot be published."), { status: 409 });
  const entries = orderedEntriesForDay(snapshot, day).map((entry) => {
    const allocations = entry.allocations.slice().sort((left, right) =>
      compareStableText(allocationIdentity(left), allocationIdentity(right)) ||
      compareStableText(left.destinationLabel, right.destinationLabel) ||
      compareStableText(left.destinationAddress || "", right.destinationAddress || "") ||
      left.quantity - right.quantity,
    );
    return publishedEntry({ ...entry, allocations }, canonicalDishFor(canonicalDishes, entry.itemId), options, day);
  });
  const stableDay = normalizePublicationValue({
    sourceDayId: day.id,
    date: day.date,
    dayName: day.dayName,
    ...(snapshot.week.supplementaryMenu ? { serviceMenu: {
      id: snapshot.week.supplementaryMenu.id,
      name: snapshot.week.supplementaryMenu.name,
      serviceType: snapshot.week.supplementaryMenu.serviceType,
      ...(snapshot.week.supplementaryMenu.serviceTime ? { serviceTime: snapshot.week.supplementaryMenu.serviceTime } : {}),
      kitchenNotes: snapshot.week.supplementaryMenu.kitchenNotes || "",
    } } : {}),
    destinationPax: day.destinationPax,
    entries,
  });
  return { ...stableDay, contentHash: contentHash(stableDay) };
}
const snapshotBytes = (value: unknown) => {
  const serialized = JSON.stringify(value);
  return typeof Buffer !== "undefined"
    ? Buffer.byteLength(serialized, "utf8")
    : new TextEncoder().encode(serialized).length;
};
export const MAX_COMPILED_SNAPSHOT_BYTES = 900 * 1024;
export function buildCompiledPublicationSnapshot(
  publication: MenuPublication,
  sourceWeekVersion: number,
): CompiledPublishedWeekSnapshot {
  const publicationVersion = publication.publicationVersion || 1;
  const publishedAt =
    publication.days
      .filter((day) => day.status === "published")
      .map((day) => day.publishedAt)
      .sort()
      .at(-1) || now();
  const publishedBy =
    publication.days
      .filter((day) => day.status === "published")
      .map((day) => day.publishedBy)
      .at(-1) || "";
  const publishedDays = publication.days.filter((day) => day.status === "published");
  const hasCanonicalOrder = publishedDays.length > 0
    && publishedDays.every(day => day.entries.every(entry => entry.menuOrderVersion === MENU_ORDER_VERSION));
  const base = normalizePublicationValue({
    schemaVersion: 1 as const,
    ...(hasCanonicalOrder ? { menuOrderVersion: MENU_ORDER_VERSION } : {}),
    snapshotId: `${publication.publicationId}:snapshot:v${publicationVersion}`,
    publicationId: publication.publicationId,
    sourceWeekId: publication.sourceWeekId,
    sourceWeekVersion,
    publicationVersion,
    publishedAt,
    publishedBy,
    sourceLineage: {
      sourceDomain: "menu-planning" as const,
      sourceEntityId: publication.sourceWeekId,
      publicationId: publication.publicationId,
      sourceWeekVersion,
      publicationVersion,
      sourceContentHash: "pending",
    },
    week: {
      weekCommencing: publication.weekCommencing,
      weekEnding: publication.weekEnding,
    },
    days: publishedDays
      .sort((a, b) => a.date.localeCompare(b.date))
    .map((day) => ({
        publicationDayId: day.publicationDayId,
        sourceDayId: day.sourceDayId,
        date: day.date,
        dayName: day.dayName,
        serviceMenu: day.serviceMenu,
        version: day.version,
        contentHash: day.contentHash,
        destinationPax: day.destinationPax,
        retainedSiteLineage: day.retainedSiteLineage,
        entries: clone(day.entries),
      })),
  });
  base.sourceLineage.sourceContentHash = contentHash({
    ...base,
    sourceLineage: { ...base.sourceLineage, sourceContentHash: "pending" },
  });
  const snapshot = {
    ...base,
    contentHash: contentHash(base),
  } as CompiledPublishedWeekSnapshot;
  if (snapshotBytes(snapshot) > MAX_COMPILED_SNAPSHOT_BYTES)
    throw Object.assign(
      new Error(
        `The compiled publication snapshot exceeds the ${MAX_COMPILED_SNAPSHOT_BYTES} byte safety limit.`,
      ),
      { status: 413 },
    );
  return snapshot;
}
export function publicationPreview(snapshot: RollingSnapshot, dayId?: string, canonicalDishes: readonly MenuItem[] = [], options: PublicationBuildOptions = {}) {
  return (
    dayId
      ? snapshot.days.filter((day) => day.id === dayId)
      : populatedWeekdays(snapshot)
  ).map((day) => buildPublishedDay(snapshot, day, canonicalDishes, options));
}
function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}
function validateDay(
  snapshot: RollingSnapshot,
  dayId: string,
  governedOplocIds?: Set<string>,
  activeCanonicalDishIds?: Set<string>,
) {
  const entries = snapshot.entries.filter(
    (entry) => entry.dayId === dayId && entry.itemLabel.trim(),
  );
  if (!entries.length) return entries;
  const errors = validateWeek(
    { ...snapshot, entries },
    { governedOplocIds, requireCanonicalDishId: Boolean(governedOplocIds), activeCanonicalDishIds },
  );
  if (errors.length)
    throw Object.assign(new Error(errors.join(" ")), { status: 422 });
  return entries;
}
export function publicationDayBlockers(
  snapshot: RollingSnapshot,
  dayId: string,
  governedOplocIds?: Set<string>,
  activeCanonicalDishIds?: Set<string>,
) {
  if (snapshot.week.menuOccurrenceStatus === "skipped") return ["This recurring menu occurrence is skipped."];
  try {
    validateDay(snapshot, dayId, governedOplocIds, activeCanonicalDishIds);
    return [];
  } catch (error) {
    return [
      error instanceof Error
        ? error.message
        : "This menu day is not ready for publication.",
    ];
  }
}
export function publicationWeekBlockers(
  snapshot: RollingSnapshot,
  governedOplocIds?: Set<string>,
  activeCanonicalDishIds?: Set<string>,
) {
  const blockers: string[] = [];
  const weekdays = serviceDaysForWeek(snapshot);
  if (weekdays.length < 5)
    blockers.push("The menu week must contain five service days.");
  if (
    !weekdays.some((day) =>
      snapshot.entries.some(
        (entry) => entry.dayId === day.id && entry.itemLabel.trim(),
      ),
    )
  )
    blockers.push(
      "The menu week must contain at least one populated service day.",
    );
  for (const day of weekdays)
    for (const blocker of publicationDayBlockers(
      snapshot,
      day.id,
      governedOplocIds,
      activeCanonicalDishIds,
    ))
      blockers.push(`${day.dayName}: ${blocker}`);
  return [...new Set(blockers)];
}
export function validatePublicationSignoff(
  snapshot: RollingSnapshot,
  dayId: string,
  signoff: MenuPublicationSignoff = {},
  governedOplocIds?: Set<string>,
  canonicalDishes: readonly MenuItem[] = [],
) {
  validateDay(snapshot, dayId, governedOplocIds);
  const day = publicationPreview(snapshot, dayId, canonicalDishes, { requireAuthoritativeCatalogue: true })[0];
  if (!day)
    throw Object.assign(new Error("Menu day was not found."), { status: 404 });
  return day;
}
function appendPublicationEvents(
  stored: StoredPublications,
  publication: MenuPublication,
  day: PublishedMenuDay,
  action: "published" | "amended" | "withdrawn",
  actor: string,
  options: { repair?: true; siteIdentities?: ReadonlySet<string> } = {},
) {
  stored.events ||= [];
  const eventIds: string[] = [];
  const occurredAt =
    action === "withdrawn" ? day.withdrawal?.at || now() : day.publishedAt;
  const addEvent = (event: DurableDomainEvent) => {
    if (!stored.events.some((existing) => existing.eventId === event.eventId))
      stored.events.push(event);
    eventIds.push(event.eventId);
  };
  addEvent(
    createDomainEvent({
      eventType: `menu.day.${action}`,
      sourceAggregateId: `${publication.publicationId}:${day.publicationDayId}:${action}`,
      sourceVersion: day.version,
      occurredAt,
      payload: {
        publicationId: publication.publicationId,
        publicationDayId: day.publicationDayId,
        sourceDayId: day.sourceDayId,
        serviceDate: day.date,
        version: day.version,
        contentHash: day.contentHash,
        status: day.status,
        actor,
      },
    }),
  );
  const today = !options.repair && mirrorEnabled() ? londonServiceDate(new Date(occurredAt)) : undefined;
  if (today && day.date >= today) {
    addEvent(createDomainEvent({
      eventType: DELIVERED_IN_MIRROR_EVENT,
      sourceAggregateId: `${publication.publicationId}:${day.publicationDayId}:${action}`,
      sourceVersion: day.version,
      occurredAt,
      payload: { publicationId: publication.publicationId, publicationDayId: day.publicationDayId, serviceDate: day.date, actor },
    }));
  }
  const currentDestinations = [
    ...new Set(
      day.entries.flatMap((entry) =>
        entry.allocations
          .map((allocation) => menuDestinationKey(allocation))
          .filter((id): id is string => Boolean(id)),
      ),
    ),
  ];
  const previousDestinations = publication.days
    .filter((candidate) => candidate.sourceDayId === day.sourceDayId)
    .flatMap((candidate) =>
      candidate.entries.flatMap((entry) =>
        entry.allocations.map((allocation) => menuDestinationKey(allocation)),
      ),
    )
    .filter((id): id is string => Boolean(id));
  const allDestinations = [
    ...new Set([...currentDestinations, ...previousDestinations]),
  ];
  const destinations = options.siteIdentities
    ? allDestinations.filter(destinationId => {
        const allocation = [day, ...publication.days.filter(candidate => candidate.sourceDayId === day.sourceDayId)]
          .flatMap(candidate => candidate.entries.flatMap(entry => entry.allocations))
          .find(candidate => menuDestinationKey(candidate) === destinationId);
        return allocation ? options.siteIdentities!.has(publishedSiteIdentity(allocation)) : false;
      })
    : allDestinations;
  for (const destinationOplocId of destinations) {
    const active = currentDestinations.includes(destinationOplocId);
    const allocation = day.entries.flatMap(entry => entry.allocations).find(allocation => menuDestinationKey(allocation) === destinationOplocId);
    const guestCount = allocation && action !== "withdrawn" ? day.destinationPax?.[publishedSiteIdentity(allocation)] : undefined;
    const lineage = action === "withdrawn" || !active ? day : day.retainedSiteLineage?.[destinationOplocId] || day;
    addEvent(
      createDomainEvent({
        eventType: "production.materialise",
        // Publication occurrence is downstream identity. Content version is
        // retained in the payload and may remain unchanged across releases.
        sourceAggregateId: `${publication.publicationId}:${day.publicationDayId}:${action}:${destinationOplocId}`,
        sourceVersion: day.version,
        occurredAt,
        payload: normalizePublicationValue({
          sourceDomain: "menu-planning",
          sourceEntityId: day.sourceDayId,
          publicationId: publication.publicationId,
          sourcePublicationDayId: lineage.publicationDayId,
          ...(day.serviceMenu ? {
            menuId: day.serviceMenu.id,
            menuName: day.serviceMenu.name,
            serviceType: day.serviceMenu.serviceType,
            ...(day.serviceMenu.serviceTime ? { serviceTime: day.serviceMenu.serviceTime } : {}),
            kitchenNotes: day.serviceMenu.kitchenNotes || "",
          } : {}),
          sourceVersion: lineage.version,
          sourceContentHash: lineage.contentHash,
          destinationOplocId,
          destination: allocation?.destination || publication.days.flatMap(previous => previous.entries.flatMap(entry => entry.allocations)).find(allocation => menuDestinationKey(allocation) === destinationOplocId)?.destination,
          destinationLabel: allocation?.destinationLabel || destinationOplocId,
          guestCount,
          serviceDate: day.date,
          status: active
            ? action === "withdrawn"
              ? "withdrawn"
              : action === "amended"
                ? "amended"
                : "published"
            : "withdrawn",
          lines: active
            ? day.entries.flatMap((entry) =>
                entry.allocations
                  .filter(
                    (allocation) =>
                      menuDestinationKey(allocation) === destinationOplocId,
                  )
                  .map((allocation) =>
                    normalizePublicationValue({
                      sourceLineId: entry.sourceEntryId,
                      ...(entry.canonicalDishId !== undefined
                        ? { canonicalItemId: entry.canonicalDishId }
                        : {}),
                      ...(entry.menuOrderVersion ? { menuOrderVersion: entry.menuOrderVersion } : {}),
                      ...(entry.slot ? { slot: entry.slot } : {}),
                      ...(entry.canonicalSlotId ? { canonicalSlotId: entry.canonicalSlotId } : {}),
                      ...(entry.isCoreSalad ? { isCoreSalad: true } : {}),
                      ...(entry.canonicalOrderIndex !== undefined ? { canonicalOrderIndex: entry.canonicalOrderIndex } : {}),
                      itemName: entry.dishName,
                      quantity: allocation.quantity,
                      unit: "portion",
                      workstream: "delivered_in" as const,
                      approvedAllergenSnapshot: normalizePublicationValue({
                        allergens: entry.allergens,
                        allergenReview: entry.allergenReview,
                        noKeyDeclaration: entry.noKeyDeclaration,
                        allergenDetailNotes: entry.allergenDetailNotes,
                        allergenEvidenceStatus: entry.allergenEvidenceStatus,
                        ...(entry.allergenEvidenceHash ? { allergenEvidenceHash: entry.allergenEvidenceHash } : {}),
                        ...(entry.canonicalIngredientRecipeHash ? { canonicalIngredientRecipeHash: entry.canonicalIngredientRecipeHash } : {}),
                        ...(entry.allergenEvidenceComplete !== undefined ? { allergenEvidenceComplete: entry.allergenEvidenceComplete } : {}),
                        ...(entry.mayContainNotes !== undefined
                          ? { mayContainNotes: entry.mayContainNotes }
                          : {}),
                        sourcePublicationDayId: lineage.publicationDayId,
                        sourceVersion: lineage.version,
                        sourceContentHash: lineage.contentHash,
                      }),
                    }),
                  ),
              )
            : [
                {
                  sourceLineId: `${day.sourceDayId}:withdrawn`,
                  itemName: "Withdrawn Delivered-In menu",
                  quantity: 0,
                  unit: "portion",
                  workstream: "delivered_in" as const,
                },
              ],
        }),
        causationId: `${publication.publicationId}:${day.sourceDayId}:v${day.version}`,
      }),
    );
  }
  return eventIds;
}
function commandResult(publication: MenuPublication, eventIds: readonly string[]): MenuPublicationCommandResult {
  const result = clone(publication) as MenuPublicationCommandResult;
  Object.defineProperty(result, "handoffEventIds", { value: [...new Set(eventIds)], enumerable: false });
  return result;
}
export async function listMenuPublications(limit = 16) {
  return (
    (await listPublicationState<StoredPublications>(limit)).publications || []
  ).map(clone);
}
export async function listMenuPublicationsForDateRange(
  fromWeek: string,
  toWeekExclusive: string,
) {
  const stored = await readPublicationStateForDateRange<StoredPublications>(
    fromWeek,
    toWeekExclusive,
  );
  return stored.publications.map(clone);
}
export async function getMenuPublication(publicationId: string) {
  const publication = await getPublicationById<MenuPublication>(publicationId);
  return publication ? clone(publication) : undefined;
}
export async function getCompiledPublicationSnapshot(
  publicationId: string,
  version?: number,
) {
  const publication = await getMenuPublication(publicationId);
  if (!publication) return undefined;
  if (
    !version &&
    publication.weekPacket &&
    publication.publicationStatus !== "withdrawn" &&
    publication.days.some((day) => day.status === "published")
  )
    return clone(
      decodeWeeklyPublicationPacket<CompiledPublishedWeekSnapshot>(
        publication.weekPacket,
      ),
    );
  const storedSnapshot =
    await getPublishedSnapshot<CompiledPublishedWeekSnapshot>(
      publicationId,
      version,
    );
  if (storedSnapshot) return clone(storedSnapshot);
  if (version) return undefined;
  return publication.days.some((day) => day.status === "published")
    ? buildCompiledPublicationSnapshot(publication, 0)
    : undefined;
}
export type PublicationDayState = {
  currentPublicationId?: string;
  currentPublicationDayId?: string;
  currentVersion?: number;
  currentContentHash?: string;
  hasCurrentPublication: boolean;
  hasUnpublishedChanges: boolean;
  legacy: boolean;
  status: "published" | "draft" | "legacy";
};
export type WorkingPublicationComparison = {
  hasUnpublishedChanges: boolean;
  dayHasUnpublishedChanges: Record<string, boolean>;
  changeSet: PublishedWeekDemandChangeSet;
  impactSummary: PublishedWeekAmendmentImpactSummary;
};
export type PublishedDemandEvidence = Pick<PublishedMenuEntry,
  "sourceEntryId" | "canonicalDishId" | "dishName" | "allergens" | "allergenReview" |
  "noKeyDeclaration" | "allergenEvidenceStatus" | "allergenEvidenceReason" |
  "mayContainNotes" | "allergenDetailNotes" | "allergenEvidenceHash" | "canonicalIngredientRecipeHash" | "allergenEvidenceComplete"
>;
export type PublishedWeekDemandOperation = {
  kind: "added" | "removed" | "replaced" | "quantity_changed" | "details_changed" | "pax_changed";
  sourceDayId: string;
  date: string;
  dayName: string;
  siteId: string;
  siteLabel: string;
  slot: string;
  before?: { date: string; dayName: string; dishId: string; dishName: string; quantity: number; entries: PublishedDemandEvidence[] };
  after?: { date: string; dayName: string; dishId: string; dishName: string; quantity: number; entries: PublishedDemandEvidence[] };
  beforePax?: number;
  afterPax?: number;
};
/** A read-only, source-version-pinned description for a future scoped publisher. */
export type PublishedWeekDemandChangeSet = {
  publicationId?: string;
  publicationVersion: number;
  sourceWeekId: string;
  sourceWeekVersion: number;
  days: Array<{ sourceDayId: string; publicationDayId: string; publicationDayVersion: number; contentHash: string }>;
  operations: PublishedWeekDemandOperation[];
};
export type PublishedWeekAmendmentImpact = {
  sourceDayId: string;
  date: string;
  dayName: string;
  siteId: string;
  siteLabel: string;
  productionDemand: "unchanged" | "quantity_only" | "pax_only" | "operational_details" | "service_date_changed" | "dish_set_changed" | "new_allocation" | "withdrawal";
  allergenApproval: "preserved" | "fresh_review_required" | "withdrawn";
  reason: string;
};
export type PublishedWeekAmendmentImpactSummary = {
  destinations: PublishedWeekAmendmentImpact[];
  freshAllergenReviewCount: number;
  approvalPreservationCount: number;
  withdrawnDestinationCount: number;
};
type DemandLine = {
  sourceDayId: string; date: string; dayName: string; siteId: string; siteLabel: string;
  slot: string; dishId: string; dishName: string; quantity: number; entries: PublishedDemandEvidence[];
  destination?: MenuDestination; destinationAddress?: string;
};
const publishedDishIdentity = (entry: PublishedMenuEntry) => entry.canonicalDishId || `legacy-name:${entry.dishName.trim().toLocaleLowerCase()}`;
const publishedSiteIdentity = (entry: PublishedMenuEntry["allocations"][number]) => {
  const id = menuDestinationKey(entry);
  return id ? menuSiteKey(entry.destination?.kind || "governed", id) : `unresolved:${entry.destinationLabel.trim().toLocaleLowerCase()}|${(entry.destinationAddress || "").trim().toLocaleLowerCase()}`;
};
const demandSort = (left: DemandLine, right: DemandLine) =>
  compareStableText(left.sourceDayId, right.sourceDayId) || compareStableText(left.siteId, right.siteId) ||
  compareStableText(left.slot, right.slot) || compareStableText(left.dishId, right.dishId);
function demandLines(sourceDayId: string, date: string, dayName: string, entries: readonly PublishedMenuEntry[] = []): DemandLine[] {
  const grouped = new Map<string, DemandLine>();
  for (const entry of entries) for (const allocation of entry.allocations) {
    if (!(Number.isFinite(allocation.quantity) && allocation.quantity > 0)) continue;
    const siteId = publishedSiteIdentity(allocation);
    const dishId = publishedDishIdentity(entry);
    const key = JSON.stringify([sourceDayId, siteId, entry.slot, dishId]);
    const current = grouped.get(key);
    const evidence: PublishedDemandEvidence = normalizePublicationValue({
      sourceEntryId: entry.sourceEntryId,
      ...(entry.canonicalDishId ? { canonicalDishId: entry.canonicalDishId } : {}),
      dishName: entry.dishName, allergens: entry.allergens,
      ...(entry.allergenReview ? { allergenReview: entry.allergenReview } : {}),
      ...(entry.noKeyDeclaration ? { noKeyDeclaration: entry.noKeyDeclaration } : {}),
      ...(entry.allergenEvidenceStatus ? { allergenEvidenceStatus: entry.allergenEvidenceStatus } : {}),
      ...(entry.allergenEvidenceHash ? { allergenEvidenceHash: entry.allergenEvidenceHash } : {}),
      ...(entry.canonicalIngredientRecipeHash ? { canonicalIngredientRecipeHash: entry.canonicalIngredientRecipeHash } : {}),
      ...(entry.allergenEvidenceComplete !== undefined ? { allergenEvidenceComplete: entry.allergenEvidenceComplete } : {}),
      ...(entry.allergenEvidenceReason ? { allergenEvidenceReason: entry.allergenEvidenceReason } : {}),
      ...(entry.mayContainNotes !== undefined ? { mayContainNotes: entry.mayContainNotes } : {}),
      ...(entry.allergenDetailNotes !== undefined ? { allergenDetailNotes: entry.allergenDetailNotes } : {}),
    });
    if (current) { current.quantity += allocation.quantity; current.entries.push(evidence); }
    else grouped.set(key, { sourceDayId, date, dayName, siteId, siteLabel: allocation.destinationLabel, slot: entry.slot, dishId, dishName: entry.dishName, quantity: allocation.quantity, entries: [evidence], ...(allocation.destination ? { destination: allocation.destination } : {}), ...(allocation.destinationAddress ? { destinationAddress: allocation.destinationAddress } : {}) });
  }
  return [...grouped.values()].map(line => ({ ...line, entries: line.entries.sort((a, b) => compareStableText(a.sourceEntryId, b.sourceEntryId)) })).sort(demandSort);
}
function demandPayload(line: DemandLine) { return { date: line.date, dayName: line.dayName, dishId: line.dishId, dishName: line.dishName, quantity: line.quantity, entries: line.entries }; }
function makeDemandOperations(before: DemandLine[], after: DemandLine[]): PublishedWeekDemandOperation[] {
  const oldByKey = new Map(before.map(line => [JSON.stringify([line.sourceDayId, line.siteId, line.slot, line.dishId]), line]));
  const newByKey = new Map(after.map(line => [JSON.stringify([line.sourceDayId, line.siteId, line.slot, line.dishId]), line]));
  const removed = before.filter(line => !newByKey.has(JSON.stringify([line.sourceDayId, line.siteId, line.slot, line.dishId])));
  const added = after.filter(line => !oldByKey.has(JSON.stringify([line.sourceDayId, line.siteId, line.slot, line.dishId])));
  const replacedOld = new Set<DemandLine>();
  const replacedNew = new Set<DemandLine>();
  const operations: PublishedWeekDemandOperation[] = [];
  for (const oldLine of removed) {
    const oldSlotKey = JSON.stringify([oldLine.sourceDayId, oldLine.siteId, oldLine.slot]);
    const oldAtSlot = removed.filter(value => JSON.stringify([value.sourceDayId, value.siteId, value.slot]) === oldSlotKey);
    const newAtSlot = added.filter(value => JSON.stringify([value.sourceDayId, value.siteId, value.slot]) === oldSlotKey);
    if (oldAtSlot.length === 1 && newAtSlot.length === 1) {
      const next = newAtSlot[0];
      replacedOld.add(oldLine);
      replacedNew.add(next);
      operations.push({ kind: "replaced", sourceDayId: oldLine.sourceDayId, date: oldLine.date, dayName: oldLine.dayName, siteId: oldLine.siteId, siteLabel: next.siteLabel, slot: oldLine.slot, before: demandPayload(oldLine), after: demandPayload(next) });
    }
  }
  for (const [key, oldLine] of oldByKey) {
    const next = newByKey.get(key);
    if (next && oldLine.quantity !== next.quantity) operations.push({ kind: "quantity_changed", sourceDayId: next.sourceDayId, date: next.date, dayName: next.dayName, siteId: next.siteId, siteLabel: next.siteLabel, slot: next.slot, before: demandPayload(oldLine), after: demandPayload(next) });
    else if (next && contentHash({ date: oldLine.date, dayName: oldLine.dayName, siteLabel: oldLine.siteLabel, destination: oldLine.destination, destinationAddress: oldLine.destinationAddress, dishName: oldLine.dishName, entries: oldLine.entries }) !== contentHash({ date: next.date, dayName: next.dayName, siteLabel: next.siteLabel, destination: next.destination, destinationAddress: next.destinationAddress, dishName: next.dishName, entries: next.entries }))
      operations.push({ kind: "details_changed", sourceDayId: next.sourceDayId, date: next.date, dayName: next.dayName, siteId: next.siteId, siteLabel: next.siteLabel, slot: next.slot, before: demandPayload(oldLine), after: demandPayload(next) });
  }
  for (const line of removed) if (!replacedOld.has(line)) {
    operations.push({ kind: "removed", sourceDayId: line.sourceDayId, date: line.date, dayName: line.dayName, siteId: line.siteId, siteLabel: line.siteLabel, slot: line.slot, before: demandPayload(line) });
  }
  for (const line of added) if (!replacedNew.has(line)) operations.push({ kind: "added", sourceDayId: line.sourceDayId, date: line.date, dayName: line.dayName, siteId: line.siteId, siteLabel: line.siteLabel, slot: line.slot, after: demandPayload(line) });
  return operations.sort((a, b) => compareStableText(a.sourceDayId, b.sourceDayId) || compareStableText(a.siteId, b.siteId) || compareStableText(a.slot, b.slot) || compareStableText(a.kind, b.kind) || compareStableText(a.after?.dishId || a.before?.dishId || "", b.after?.dishId || b.before?.dishId || ""));
}
type ImpactDay = Pick<PublishedMenuDay, "sourceDayId" | "date" | "dayName" | "contentHash" | "entries" | "destinationPax" | "serviceMenu">;
export function amendmentImpactForDays(beforeDays: readonly ImpactDay[], afterDays: readonly ImpactDay[]): PublishedWeekAmendmentImpactSummary {
  const grouped = (days: readonly ImpactDay[]) => {
    type ImpactEntry = { entry: PublishedMenuEntry; quantity: number; allocation: PublishedMenuEntry["allocations"][number] };
    type SiteImpactGroup = { day: ImpactDay; siteId: string; siteLabel: string; entries: ImpactEntry[] };
    const result = new Map<string, SiteImpactGroup>();
    for (const day of days) for (const entry of day.entries || []) for (const allocation of entry.allocations || []) {
      if (!Number.isFinite(allocation.quantity) || allocation.quantity <= 0) continue;
      const siteId = publishedSiteIdentity(allocation);
      const key = JSON.stringify([day.sourceDayId, siteId]);
      const current: SiteImpactGroup = result.get(key) || { day, siteId, siteLabel: allocation.destinationLabel, entries: [] };
      current.entries.push({ entry, quantity: allocation.quantity, allocation });
      result.set(key, current);
    }
    return result;
  };
  const before = grouped(beforeDays), after = grouped(afterDays);
  const destinations: PublishedWeekAmendmentImpact[] = [];
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const prior = before.get(key), next = after.get(key);
    const current = next || prior!;
    const priorIdentities = (prior?.entries || []).map(({ entry }) => `${entry.sourceEntryId}|${entry.canonicalDishId || "legacy"}`).sort();
    const nextIdentities = (next?.entries || []).map(({ entry }) => `${entry.sourceEntryId}|${entry.canonicalDishId || "legacy"}`).sort();
    const sameDishes = JSON.stringify(priorIdentities) === JSON.stringify(nextIdentities);
    const quantityByIdentity = (value: typeof prior) => new Map((value?.entries || []).map(({ entry, quantity }) => [`${entry.sourceEntryId}|${entry.canonicalDishId || "legacy"}`, quantity]));
    const priorQuantities = quantityByIdentity(prior), nextQuantities = quantityByIdentity(next);
    const demandQuantityChanged = JSON.stringify([...priorQuantities].sort(([left], [right]) => compareStableText(left, right))) !== JSON.stringify([...nextQuantities].sort(([left], [right]) => compareStableText(left, right)));
    const demandDetails = (value: typeof prior) => ({
      date: value?.day.date, dayName: value?.day.dayName,
      serviceMenu: value?.day.serviceMenu,
      entries: (value?.entries || []).map(({ entry, allocation }) => ({
      sourceEntryId: entry.sourceEntryId, canonicalDishId: entry.canonicalDishId || "", slot: entry.slot,
      dishName: entry.dishName, destination: allocation.destination, destinationLabel: allocation.destinationLabel,
      destinationAddress: allocation.destinationAddress || "",
      })).sort((left, right) => compareStableText(left.sourceEntryId, right.sourceEntryId)),
    });
    let productionDemand: PublishedWeekAmendmentImpact["productionDemand"] = "unchanged";
    if (prior && !next) productionDemand = "withdrawal";
    else if (!prior && next) productionDemand = "new_allocation";
    else if (prior && next && !sameDishes) productionDemand = "dish_set_changed";
    else if (prior && next && prior.day.date !== next.day.date) productionDemand = "service_date_changed";
    else if (prior && next && demandQuantityChanged) productionDemand = "quantity_only";
    else if (prior && next && contentHash(demandDetails(prior)) !== contentHash(demandDetails(next))) productionDemand = "operational_details";
    else if (prior && next && prior.day.destinationPax?.[current.siteId] !== next.day.destinationPax?.[current.siteId]) productionDemand = "pax_only";

    let allergenApproval: PublishedWeekAmendmentImpact["allergenApproval"];
    let reason: string;
    if (prior && !next) {
      allergenApproval = "withdrawn";
      reason = "This destination has no positive-portion dishes in the amended publication; withdraw its current service evidence.";
    } else if (prior && next && prior.day.date !== next.day.date) {
      allergenApproval = "fresh_review_required";
      reason = "The service date changed, so prior dated approval cannot be carried forward.";
    } else {
      const beforeByIdentity = new Map((prior?.entries || []).map(value => [`${value.entry.sourceEntryId}|${value.entry.canonicalDishId || "legacy"}`, value.entry]));
      const afterByIdentity = new Map((next?.entries || []).map(value => [`${value.entry.sourceEntryId}|${value.entry.canonicalDishId || "legacy"}`, value.entry]));
      const equivalent = Boolean(prior && next && sameDishes && priorIdentities.length > 0 && priorIdentities.every(identity => {
        const previousEntry = beforeByIdentity.get(identity), nextEntry = afterByIdentity.get(identity);
        return Boolean(previousEntry?.allergenEvidenceComplete && nextEntry?.allergenEvidenceComplete && previousEntry.allergenEvidenceHash && previousEntry.allergenEvidenceHash === nextEntry.allergenEvidenceHash);
      }));
      if (equivalent) {
        allergenApproval = "preserved";
        reason = "The served dish identities and complete canonical ingredient and allergen evidence fingerprints are unchanged.";
      } else {
        allergenApproval = "fresh_review_required";
        reason = !prior ? "A new destination allocation has no prior signed allergen approval." : !sameDishes
          ? "The set of dishes served at this destination changed. Review the new matrix before signing."
          : "Complete equivalent canonical ingredient and allergen evidence could not be proven for every served dish.";
      }
    }
    if (productionDemand !== "unchanged" || allergenApproval === "fresh_review_required") {
      destinations.push({ sourceDayId: current.day.sourceDayId, date: current.day.date, dayName: current.day.dayName, siteId: current.siteId, siteLabel: current.siteLabel, productionDemand, allergenApproval, reason });
    }
  }
  return {
    destinations,
    freshAllergenReviewCount: destinations.filter(value => value.allergenApproval === "fresh_review_required").length,
    approvalPreservationCount: destinations.filter(value => value.allergenApproval === "preserved").length,
    withdrawnDestinationCount: destinations.filter(value => value.allergenApproval === "withdrawn").length,
  };
}
/** Compare the exact normalized publication preview used by both reads and writes. */
export function compareWorkingWeekToPublication(
  snapshot: RollingSnapshot,
  publication: MenuPublication | undefined,
  governedOplocs: readonly GovernedOploc[] = [],
  canonicalDishes: readonly MenuItem[] = [],
): WorkingPublicationComparison {
  const normalized = normaliseRollingSnapshotDestinations(snapshot, governedOplocs);
  const currentDays = new Map(
    publication?.days
      .filter((day) => day.status === "published")
      .map((day) => [day.sourceDayId, day]) || [],
  );
  const dayHasUnpublishedChanges = Object.fromEntries(
    serviceDaysForWeek(normalized).map((day) => {
      const current = currentDays.get(day.id);
      const working = buildPublishedDay(normalized, day, canonicalDishes);
      // An intentionally blank day is equivalent to no published day. A
      // populated working day, or a published day with a different hash, is
      // a persisted amendment.
      const changed = current
        ? current.contentHash !== working.contentHash && !historicalDayMatchesWorkingOrder(current, day, normalized, working.contentHash)
        : working.entries.length > 0;
      return [day.id, changed];
    }),
  );
  const baselineDays = (publication?.days || []).filter(day => day.status === "published").sort((a, b) => compareStableText(a.sourceDayId, b.sourceDayId));
  const candidateDays = serviceDaysForWeek(normalized).map(day => ({ day, preview: buildPublishedDay(normalized, day, canonicalDishes) }));
  const before = baselineDays.flatMap(day => demandLines(day.sourceDayId, day.date, day.dayName, day.entries || []));
  const after = candidateDays.flatMap(({ day, preview }) => demandLines(day.id, preview.date, preview.dayName, preview.entries));
  const paxOperations = candidateDays.flatMap(({ day, preview }) => {
    const previous = currentDays.get(day.id);
    const beforePax = previous?.destinationPax || {};
    const afterPax = preview.destinationPax || {};
    const labels = new Map([
      ...governedOplocs.map(oploc => [menuSiteKey("governed", oploc.canonicalId), oploc.label] as const),
      ...(day.oneOffDestinations || []).map(destination => [menuSiteKey("one-off", destination.id), destination.label] as const),
      ...[...(previous?.entries || []), ...preview.entries].flatMap(entry => entry.allocations.map(allocation => [publishedSiteIdentity(allocation), allocation.destinationLabel] as const)),
    ]);
    return [...new Set([...Object.keys(beforePax), ...Object.keys(afterPax)])].sort(compareStableText)
      .filter(siteId => beforePax[siteId] !== afterPax[siteId])
      .map(siteId => ({ kind: "pax_changed" as const, sourceDayId: day.id, date: day.date, dayName: day.dayName, siteId, siteLabel: labels.get(siteId) || siteId, slot: "PAX", beforePax: beforePax[siteId], afterPax: afterPax[siteId] }));
  });
  const changeSet: PublishedWeekDemandChangeSet = {
    ...(publication?.publicationId ? { publicationId: publication.publicationId } : {}),
    publicationVersion: publication?.publicationVersion || 0,
    sourceWeekId: normalized.week.id,
    sourceWeekVersion: normalized.week.version,
    days: baselineDays.map(day => ({ sourceDayId: day.sourceDayId, publicationDayId: day.publicationDayId, publicationDayVersion: day.version, contentHash: day.contentHash })),
    operations: [...makeDemandOperations(before, after), ...paxOperations],
  };
  const impactSummary = amendmentImpactForDays(
    baselineDays,
    candidateDays.map(({ preview }) => preview),
  );
  return {
    hasUnpublishedChanges: Object.values(dayHasUnpublishedChanges).some(Boolean),
    dayHasUnpublishedChanges,
    changeSet,
    impactSummary,
  };
}
export async function publicationState(
  snapshot: RollingSnapshot,
  governedOplocs: readonly GovernedOploc[] = [],
  canonicalDishes: readonly MenuItem[] = [],
  scopePublication?: (publication: MenuPublication) => MenuPublication,
): Promise<Record<string, PublicationDayState>> {
  const normalized = normaliseRollingSnapshotDestinations(snapshot, governedOplocs);
  const resolvedCanonicalDishes = canonicalDishes.length ? canonicalDishes : await authoritativeDishesFor(normalized);
  const storedPublication = (
    await readPublicationStateForWeek<StoredPublications>(normalized.week.id)
  ).publications.find((value) => value.sourceWeekId === snapshot.week.id);
  const publication = scopePublication && storedPublication ? scopePublication(storedPublication) : storedPublication;
  const comparison = compareWorkingWeekToPublication(normalized, publication, governedOplocs, resolvedCanonicalDishes);
  return Object.fromEntries(
    serviceDaysForWeek(normalized).map((day) => {
      const current = publication?.days
        .filter(
          (value) =>
            value.sourceDayId === day.id && value.status === "published",
        )
        .sort((a, b) => b.version - a.version)[0];
      const legacy =
        !current &&
        !publication &&
        normalized.week.status === "published" &&
        !normalized.week.dayStatuses;
      const state: PublicationDayState = current
        ? {
            currentPublicationId: publication?.publicationId,
            currentPublicationDayId: current.publicationDayId,
            currentVersion: current.version,
            currentContentHash: current.contentHash,
            hasCurrentPublication: true,
            hasUnpublishedChanges: comparison.dayHasUnpublishedChanges[day.id] === true,
            legacy: false,
            status: "published",
          }
        : {
            hasCurrentPublication: false,
            hasUnpublishedChanges: false,
            legacy,
            status: legacy ? "legacy" : "draft",
          };
      return [day.id, state];
    }),
  );
}

export type PublishedWeekAmendmentPreview = {
  changeSet: PublishedWeekDemandChangeSet;
  impactSummary: PublishedWeekAmendmentImpactSummary;
  changeSetHash: string;
  sourceWeekVersion: number;
  publicationVersion: number;
};

export function assertAmendmentPaxScope(changeSet: PublishedWeekDemandChangeSet, allowedOplocs?: ReadonlySet<string>) {
  if (!allowedOplocs) return;
  for (const change of changeSet.operations) {
    if (change.kind !== "pax_changed") continue;
    const site = menuSiteIdentity(change.siteId);
    if (site?.kind !== "governed" || !allowedOplocs.has(site.id)) {
      throw Object.assign(new Error("This amendment contains PAX outside your permitted OPLOC scope."), { status: 403 });
    }
  }
}

/** Preview a saved amendment against the current immutable publication lineage. */
export async function previewPublishedWeekAmendment(
  weekId: string,
  governedOplocs: readonly GovernedOploc[] = [],
): Promise<PublishedWeekAmendmentPreview> {
  const snapshot = normaliseRollingSnapshotDestinations(await getWeek(weekId), governedOplocs);
  const canonicalDishes = await authoritativeDishesFor(snapshot);
  const state = await readPublicationStateForWeek<StoredPublications>(weekId);
  const publication = state.publications.find(value => value.sourceWeekId === weekId);
  const currentDays = publication?.days.filter(day => day.status === "published") || [];
  if (!publication || !currentDays.length)
    throw conflict("A scoped amendment requires a current published week.");
  const comparison = compareWorkingWeekToPublication(snapshot, publication, governedOplocs, canonicalDishes);
  const changedDays = Object.entries(comparison.dayHasUnpublishedChanges).filter(([, changed]) => changed).map(([dayId]) => dayId);
  if (!changedDays.length)
    throw conflict(`This menu week is already current at publication version ${publication.publicationVersion || 1}.`);
  if (changedDays.some(dayId => !currentDays.some(day => day.sourceDayId === dayId)))
    throw conflict("Only already-published days can be amended through this workflow.");
  if (changedDays.some(dayId => !hasCurrentPublishedWorkingDraft(snapshot.week, publication, dayId)))
    throw conflict("Save the published working draft before reviewing its amendment.");
  const changeSet = comparison.changeSet;
  return { changeSet, impactSummary: comparison.impactSummary, changeSetHash: contentHash(changeSet), sourceWeekVersion: snapshot.week.version, publicationVersion: publication.publicationVersion || 1 };
}

export async function publishScopedPublishedWeekAmendment(
  weekId: string,
  input: Pick<PublishedWeekAmendmentPreview, "sourceWeekVersion" | "publicationVersion" | "changeSetHash"> & { requestId: string },
  actor = "local-menu-planner",
  governedOplocIds?: Set<string>,
  governedOplocs: readonly GovernedOploc[] = [],
  allowedPaxOplocs?: ReadonlySet<string>,
  authorize?: (snapshot: RollingSnapshot, changes: PublishedWeekDemandChangeSet) => void,
) {
  if (!input.requestId.trim() || input.requestId.length > 160 || !Number.isSafeInteger(input.sourceWeekVersion) || !Number.isSafeInteger(input.publicationVersion) || !/^[a-f0-9]{64}$/.test(input.changeSetHash))
    throw Object.assign(new Error("The amendment review request is invalid."), { status: 400 });
  const expectedSnapshot = await getWeek(weekId);
  const canonicalDishes = await authoritativeDishesFor(expectedSnapshot);
  const activeCanonicalDishIds = hostedPublication() ? new Set(canonicalDishes.filter(item => item.reviewStatus !== "archived").map(item => item.canonicalId)) : await activeCanonicalDishIdsFor(expectedSnapshot);
  return withMenuPlanningTransaction(state => {
    const rolling = state.rolling as unknown as RollingMenuStored;
    const snapshot = normaliseRollingSnapshotDestinations(snapshotFromStored(rolling, weekId), governedOplocs);
    const stored = state.publications as unknown as StoredPublications;
    const publication = stored.publications.find(value => value.sourceWeekId === weekId);
    if (!publication) throw conflict("The published week changed before amendment approval.");
    const replay = publication.audit.find(event => event.requestId === input.requestId);
    if (replay) {
      if (replay.changeSetHash !== input.changeSetHash) throw conflict("This amendment request ID was already used for different changes.");
      return commandResult(publication, replay.handoffEventIds || []);
    }
    if (snapshot.week.version !== input.sourceWeekVersion || (publication.publicationVersion || 1) !== input.publicationVersion)
      throw conflict("The published week changed after amendment review. Refresh, save and review the latest version.");
    const comparison = compareWorkingWeekToPublication(snapshot, publication, governedOplocs, canonicalDishes);
    assertAmendmentPaxScope(comparison.changeSet, allowedPaxOplocs);
    authorize?.(snapshot, comparison.changeSet);
    if (contentHash(comparison.changeSet) !== input.changeSetHash)
      throw conflict("The amendment changed after review. Refresh and review the exact current demand before publishing.");
    const changedDayIds = Object.entries(comparison.dayHasUnpublishedChanges).filter(([, changed]) => changed).map(([dayId]) => dayId);
    if (!changedDayIds.length) throw conflict("There are no published changes to approve.");
    const currentDays = new Map(publication.days.filter(day => day.status === "published").map(day => [day.sourceDayId, day]));
    if (changedDayIds.some(dayId => !currentDays.has(dayId) || !hasCurrentPublishedWorkingDraft(snapshot.week, publication, dayId)))
      throw conflict("Every amended day must retain its current publication lineage and a saved working draft.");
    const previews = new Map<string, ReturnType<typeof buildPublishedDay>>();
    for (const dayId of changedDayIds) {
      const day = snapshot.days.find(value => value.id === dayId);
      if (!day) throw conflict("An amended day is missing from the saved week.");
      const blockers = publicationDayBlockers(snapshot, dayId, governedOplocIds, activeCanonicalDishIds);
      if (blockers.length) throw Object.assign(new Error(`${day.dayName}: ${blockers.join(" ")}`), { status: 422 });
      previews.set(dayId, buildPublishedDay(snapshot, day, canonicalDishes, { requireAuthoritativeCatalogue: hostedPublication(), allowExplicitReviewWithoutCatalogue: !hostedPublication() }));
    }
    const publishedAt = now();
    const changedSites = new Map(changedDayIds.map(dayId => {
      const operations = comparison.changeSet.operations.filter(operation => operation.sourceDayId === dayId);
      const current = currentDays.get(dayId);
      const preview = previews.get(dayId);
      const sites = operations.length
        ? operations.map(operation => operation.siteId)
        : [...(current?.entries || []), ...(preview?.entries || [])].flatMap(entry => entry.allocations.map(allocation => publishedSiteIdentity(allocation)));
      return [dayId, new Set(sites)] as const;
    }));
    const changedDays: PublishedMenuDay[] = changedDayIds.map(dayId => {
      const preview = previews.get(dayId)!;
      const prior = currentDays.get(dayId)!;
      const priorLineage = { publicationDayId: prior.publicationDayId, version: prior.version, contentHash: prior.contentHash };
      const retainedSiteLineage = Object.fromEntries(preview.entries.flatMap(entry => entry.allocations).flatMap(allocation => {
        const id = menuDestinationKey(allocation);
        return id && !changedSites.get(dayId)!.has(publishedSiteIdentity(allocation)) ? [[id, prior.retainedSiteLineage?.[id] || priorLineage]] : [];
      }));
      const highest = publication!.days.filter(day => day.sourceDayId === dayId).reduce((value, day) => Math.max(value, day.version), 0);
      const publicationDayIndex = snapshot.week.dayIds.indexOf(dayId);
      if (publicationDayIndex < 0) throw conflict("An amended day is outside the published week.");
      return normalizePublicationValue({
        publicationDayId: `${publication!.publicationId}:v${(publication!.publicationVersion || 1) + 1}:day:${publicationDayIndex}`,
        sourceDayId: dayId, date: preview.date, dayName: preview.dayName,
        version: highest + 1, status: "published" as const,
        contentHash: preview.contentHash, publishedAt, publishedBy: actor,
        destinationPax: preview.destinationPax,
        ...(Object.keys(retainedSiteLineage).length ? { retainedSiteLineage } : {}),
        entries: clone(preview.entries),
      });
    });
    const impactSummary = amendmentImpactForDays(changedDayIds.map(dayId => currentDays.get(dayId)!), changedDays);
    publication.days = publication.days.map(day => changedDayIds.includes(day.sourceDayId) && day.status === "published" ? { ...day, status: "superseded" as const } : day).concat(changedDays);
    publication.publicationVersion = (publication.publicationVersion || 1) + 1;
    publication.publicationStatus = "published";
    const compiledSnapshot = buildCompiledPublicationSnapshot(publication, input.sourceWeekVersion);
    publication.compiledSnapshotId = compiledSnapshot.snapshotId;
    publication.weekPacket = encodeWeeklyPublicationPacket(compiledSnapshot, publishedAt);
    stored.snapshots ||= {};
    stored.snapshots[compiledSnapshot.snapshotId] = compiledSnapshot;
    const handoffEventIds: string[] = [];
    for (const day of changedDays) {
      handoffEventIds.push(...appendPublicationEvents(stored, publication, day, "amended", actor, { siteIdentities: changedSites.get(day.sourceDayId) }));
    }
    const uniqueHandoffIds = [...new Set(handoffEventIds)];
    publication.audit.push({ action: "menu-week-scoped-amendment-published", at: publishedAt, by: actor, requestId: input.requestId, changeSetHash: input.changeSetHash, impactSummary, sourceWeekVersion: input.sourceWeekVersion, handoffEventIds: uniqueHandoffIds });
    snapshot.week.dayStatuses = { ...(snapshot.week.dayStatuses || {}), ...Object.fromEntries(changedDayIds.map(dayId => [dayId, "published"])) };
    snapshot.week.version += 1;
    snapshot.week.audit.push({ action: "menu-week-scoped-amendment-published", at: publishedAt, by: actor });
    replaceSnapshotInStored(rolling, snapshot);
    return commandResult(publication, uniqueHandoffIds);
  }, undefined, { weekId, sourceWeekId: weekId, includeEvents: false });
}

export async function createPublishedMenuDay(
  weekId: string,
  dayId: string,
  signoff: MenuPublicationSignoff,
  actor = "local-menu-planner",
  governedOplocIds?: Set<string>,
) {
  const expectedSnapshot = await getWeek(weekId);
  const expectedWeekVersion = expectedSnapshot.week.version;
  const canonicalDishes = await authoritativeDishesFor(expectedSnapshot, dayId);
  const activeCanonicalDishIds = hostedPublication() ? new Set(canonicalDishes.filter(item => item.reviewStatus !== "archived").map(item => item.canonicalId)) : await activeCanonicalDishIdsFor(expectedSnapshot);
  return withMenuPlanningTransaction(
    (state) => {
      const rolling = state.rolling as unknown as RollingMenuStored;
      const snapshot = snapshotFromStored(rolling, weekId);
      if (snapshot.week.version !== expectedWeekVersion)
        throw conflict(
          "The working menu changed while publication was being prepared. Refresh and try again.",
        );
      const entries = snapshot.entries.filter(
        (entry) => entry.dayId === dayId && entry.itemLabel.trim(),
      );
      const day = snapshot.days.find((value) => value.id === dayId);
      if (!day)
        throw Object.assign(new Error("Menu day was not found."), {
          status: 404,
        });
      const errors = validateWeek(
        { ...snapshot, entries },
    { governedOplocIds, requireCanonicalDishId: Boolean(governedOplocIds), activeCanonicalDishIds },
      );
      if (errors.length)
        throw Object.assign(new Error(errors.join(" ")), { status: 422 });
      const preview = buildPublishedDay(snapshot, day, canonicalDishes, { requireAuthoritativeCatalogue: hostedPublication(), allowExplicitReviewWithoutCatalogue: !hostedPublication() });
      if (
        signoff.dayContentHash &&
        signoff.dayContentHash !== preview.contentHash
      )
        throw conflict(
          "The current day content changed after sign-off. Review and sign again before publishing.",
        );
      const stored = state.publications as unknown as StoredPublications;
      let publication = stored.publications.find(
        (value) => value.sourceWeekId === snapshot.week.id,
      );
      if (!publication) {
        publication = {
          publicationId: `menu-publication:${snapshot.week.id}`,
          sourceWeekId: snapshot.week.id,
          weekCommencing: snapshot.week.weekCommencing,
          weekEnding: snapshot.week.weekEnding,
          days: [],
          audit: [],
        };
        stored.publications.push(publication);
      }
      const current = publication.days.find(
        (value) => value.sourceDayId === day.id && value.status === "published",
      );
      if (current?.contentHash === preview.contentHash)
        throw conflict(
          "This menu day has no changes to publish.",
        );
      const hasWorkingDraft = current && hasCurrentPublishedWorkingDraft(snapshot.week, publication, day.id);
      if (hasWorkingDraft)
        throw conflict(
          "This published day has a saved working draft. Use the scoped day-and-site amendment workflow before publishing changes.",
        );
      const version =
        publication.days
          .filter((value) => value.sourceDayId === day.id)
          .reduce((highest, value) => Math.max(highest, value.version), 0) + 1;
      publication.days = publication.days.map((value) =>
        value.sourceDayId === day.id && value.status === "published"
          ? { ...value, status: "superseded" as const }
          : value,
      );
      const publishedAt = now();
      const publishedDay: PublishedMenuDay = normalizePublicationValue({
        publicationDayId: `${publication.publicationId}:${day.id}:v${version}`,
        sourceDayId: day.id,
        date: day.date,
        dayName: day.dayName,
        version,
        status: "published",
        contentHash: preview.contentHash,
        publishedAt,
        publishedBy: actor,
        destinationPax: preview.destinationPax,
        entries: clone(preview.entries),
        ...(Object.keys(signoff || {}).length
          ? { allergenSignoff: normalizePublicationValue(signoff) }
          : {}),
      });
      publication.days.push(publishedDay);
      publication.publicationVersion =
        (publication.publicationVersion || 0) + 1;
      const compiledSnapshot = buildCompiledPublicationSnapshot(
        publication,
        expectedWeekVersion,
      );
      publication.compiledSnapshotId = compiledSnapshot.snapshotId;
      publication.publicationStatus = "published";
      publication.weekPacket = encodeWeeklyPublicationPacket(
        compiledSnapshot,
        publishedAt,
      );
      stored.snapshots ||= {};
      stored.snapshots[compiledSnapshot.snapshotId] = compiledSnapshot;
      publication.audit.push({
        action: "menu-day-published",
        at: publishedAt,
        by: actor,
        publicationDayId: publishedDay.publicationDayId,
      });
       const handoffEventIds = appendPublicationEvents(
         stored,
         publication,
        publishedDay,
        version === 1 ? "published" : "amended",
        actor,
      );
      snapshot.week.dayStatuses = {
        ...(snapshot.week.dayStatuses || {}),
        [day.id]: "published",
      };
      const populated = populatedWeekdays(snapshot);
      const publishedCount = populated.filter(
        (value) => snapshot.week.dayStatuses?.[value.id] === "published",
      ).length;
      snapshot.week.status =
        publishedCount === populated.length && populated.length > 0
          ? "published"
          : "partially_published";
      snapshot.week.version += 1;
      snapshot.week.audit.push({
        action: "menu-day-published",
        at: publishedAt,
        by: actor,
      });
      replaceSnapshotInStored(rolling, snapshot);
       return commandResult(publication, handoffEventIds);
    },
    { weekId, weekVersion: expectedWeekVersion },
    { weekId, sourceWeekId: weekId, includeEvents: false },
  );
}
/** Publish the complete current week in one transaction. Legacy day publications remain readable. */
export async function createPublishedMenuWeek(
  weekId: string,
  input: MenuPublicationWeekPublishInput = {},
  actor = "local-menu-planner",
  governedOplocIds?: Set<string>,
  governedOplocs?: readonly GovernedOploc[],
  authorize?: (snapshot: RollingSnapshot, previousDays: PublishedMenuDay[]) => void,
) {
  const expectedSnapshot = await getWeek(weekId);
  const expectedWeekVersion = expectedSnapshot.week.version;
  const canonicalDishes = await authoritativeDishesFor(expectedSnapshot);
  const activeCanonicalDishIds = hostedPublication() ? new Set(canonicalDishes.filter(item => item.reviewStatus !== "archived").map(item => item.canonicalId)) : await activeCanonicalDishIdsFor(expectedSnapshot);
  return withMenuPlanningTransaction(
    (state) => {
      const rolling = state.rolling as unknown as RollingMenuStored;
      const snapshot = normaliseRollingSnapshotDestinations(
        snapshotFromStored(rolling, weekId),
        governedOplocs,
      );
      if (snapshot.week.version !== expectedWeekVersion)
        throw conflict(
          "The working menu changed while publication was being prepared. Refresh and try again.",
        );
      const blockers = publicationWeekBlockers(snapshot, governedOplocIds, activeCanonicalDishIds);
      if (blockers.length)
        throw Object.assign(new Error(blockers.join(" ")), { status: 422 });
      const previews = snapshot.days
        .slice(0, 5)
        .map((day) => buildPublishedDay(snapshot, day, canonicalDishes, { requireAuthoritativeCatalogue: hostedPublication(), allowExplicitReviewWithoutCatalogue: !hostedPublication() }));
      if (
        input.weekContentHash &&
        input.weekContentHash !== contentHash(previews)
      )
        throw conflict(
          "The current week content changed after the publication review. Refresh before publishing.",
        );
      const stored = state.publications as unknown as StoredPublications;
      let publication = stored.publications.find(
        (value) => value.sourceWeekId === snapshot.week.id,
      );
      authorize?.(snapshot, publication?.days.filter(day => day.status === "published") || []);
      if (!publication) {
        publication = {
          publicationId: `menu-publication:${snapshot.week.id}`,
          sourceWeekId: snapshot.week.id,
          weekCommencing: snapshot.week.weekCommencing,
          weekEnding: snapshot.week.weekEnding,
          days: [],
          audit: [],
        };
        stored.publications.push(publication);
      }
      const publishedAt = now();
      const nextVersion = (publication.publicationVersion || 0) + 1;
      const currentDays = new Map(
        publication.days
          .filter((day) => day.status === "published")
          .map((day) => [day.sourceDayId, day]),
      );
      const hasWorkingDraft = hasCurrentPublishedWorkingDraft(snapshot.week, publication);
      if (hasWorkingDraft)
        throw conflict(
          "This week has publication history. Use the scoped day-and-site amendment workflow; whole-week republishing is blocked.",
        );
      const comparison = compareWorkingWeekToPublication(snapshot, publication, governedOplocs || [], canonicalDishes);
      if (nextVersion > 1 && !comparison.hasUnpublishedChanges)
        throw conflict(
          `This menu week is already published at version ${publication.publicationVersion}.`,
        );
      const nextDays: PublishedMenuDay[] = previews.map((preview, index) => {
        const current = currentDays.get(preview.sourceDayId);
        const version =
          current?.contentHash === preview.contentHash
            ? current.version
            : publication!.days
                .filter((day) => day.sourceDayId === preview.sourceDayId)
                .reduce((highest, day) => Math.max(highest, day.version), 0) +
              1;
        return normalizePublicationValue({
          publicationDayId: `${publication!.publicationId}:v${nextVersion}:day:${index}`,
          sourceDayId: preview.sourceDayId,
          date: preview.date,
          dayName: preview.dayName,
          version,
          status: "published" as const,
          contentHash: preview.contentHash,
          publishedAt,
          publishedBy: actor,
          destinationPax: preview.destinationPax,
          entries: preview.entries,
        });
      });
      publication.days = publication.days
        .map((day) =>
          day.status === "published"
            ? { ...day, status: "superseded" as const }
            : day,
        )
        .concat(nextDays);
      publication.publicationVersion = nextVersion;
      publication.publicationStatus = "published";
      const compiledSnapshot = buildCompiledPublicationSnapshot(
        publication,
        expectedWeekVersion,
      );
      publication.compiledSnapshotId = compiledSnapshot.snapshotId;
      publication.weekPacket = encodeWeeklyPublicationPacket(
        compiledSnapshot,
        publishedAt,
      );
      stored.snapshots ||= {};
      stored.snapshots[compiledSnapshot.snapshotId] = compiledSnapshot;
      publication.audit.push({
        action: nextVersion === 1 ? "menu-week-published" : "menu-week-amended",
        at: publishedAt,
        by: actor,
      });
       const handoffEventIds: string[] = [];
       for (const day of nextDays)
         handoffEventIds.push(
           ...appendPublicationEvents(
           stored,
           publication!,
           day,
           nextVersion === 1 ? "published" : "amended",
           actor,
           ),
         );
      snapshot.week.dayStatuses = Object.fromEntries(
        nextDays.map((day) => [day.sourceDayId, "published"]),
      );
      snapshot.week.status = "published";
      snapshot.week.version += 1;
      snapshot.week.audit.push({
        action: nextVersion === 1 ? "menu-week-published" : "menu-week-amended",
        at: publishedAt,
        by: actor,
      });
      replaceSnapshotInStored(rolling, snapshot);
       return commandResult(publication!, handoffEventIds);
    },
    { weekId, weekVersion: expectedWeekVersion },
    { weekId, sourceWeekId: weekId, includeEvents: false },
  );
}
export function currentPublishedDays(publication: MenuPublication) {
  return publication.days.filter((day) => day.status === "published");
}
/** Re-queue the current immutable publication handoff without creating a new version. */
export async function repairPublishedMenuPublication(publicationId: string) {
  const publication = await getMenuPublication(publicationId);
  if (!publication)
    throw Object.assign(new Error("Menu publication was not found."), {
      status: 404,
    });
  const currentDays = currentPublishedDays(publication);
  if (!currentDays.length)
    throw Object.assign(
      new Error("Only a current published publication can be repaired."),
      { status: 409 },
    );
  const repairKey = `menu-publication-handoff-repaired:v${publication.publicationVersion || 1}`;
  return withMenuPlanningTransaction(
    (state) => {
      const stored = state.publications as unknown as StoredPublications;
      const target = stored.publications.find(
        (value) => value.publicationId === publicationId,
      );
      if (!target)
        throw Object.assign(new Error("Menu publication was not found."), {
          status: 404,
        });
       if (!target.audit.some((item) => item.action === repairKey)) {
         const handoffEventIds: string[] = [];
         for (const day of currentPublishedDays(target))
           handoffEventIds.push(
             ...appendPublicationEvents(
             stored,
             target,
             day,
             day.version > 1 ? "amended" : "published",
             target.audit.at(-1)?.by || "publication-repair",
             { repair: true },
             ),
           );
        for (const event of stored.events || [])
          if (
            event.eventType === "production.materialise" &&
            currentPublishedDays(target).some((day) => {
              const payload = event.payload as { publicationId?: string; sourcePublicationDayId?: string };
              return payload.publicationId === target.publicationId && payload.sourcePublicationDayId === day.publicationDayId;
            }) &&
            event.delivery.status === "delivered"
          )
            event.delivery = {
              status: "pending",
              attempts: event.delivery.attempts,
            };
         target.audit.push({
           action: repairKey,
           at: now(),
           by: "publication-repair",
         });
          return commandResult(target, handoffEventIds);
       }
       return commandResult(target, []);
    },
    undefined,
    {
      weekId: publication.sourceWeekId,
      sourceWeekId: publication.sourceWeekId,
      includeEvents: false,
    },
  );
}
/** Explicit historical audit/repair read; normal publication lookups never call this path. */
export async function listMenuPublicationEvents() {
  return (await read()).events.map(clone);
}
export type MenuOutboxReplayOptions = { eventIds?: readonly string[]; resetDeadLetter?: boolean; maxEvents?: number };
export async function replayMenuPublicationOutbox(
  consumer: (event: DurableDomainEvent) => Promise<void> | void,
  at = new Date(),
  options: MenuOutboxReplayOptions = {},
) {
  let delivered = 0;
  let failed = 0;
  let deadLettered = 0;
  let pending = 0;
  const targetIds = options.eventIds ? [...new Set(options.eventIds)] : undefined;
  const ids = targetIds || [];
  const processOne = async (eventId?: string) => {
    const claimId = `menu-replay:${randomUUID()}`;
    if (eventId && options.resetDeadLetter) {
      const existing = await getMenuPlanningEvent(eventId);
      if (existing?.delivery.status === "dead-letter") await resetMenuPlanningEvent(eventId, at, "manual publication handoff replay");
    }
    const claimed = eventId
      ? (await claimMenuPlanningEventById(eventId, claimId, at)).event
      : await claimNextMenuPlanningEvent(claimId, at);
    if (!claimed) {
      if (eventId) {
        const current = await getMenuPlanningEvent(eventId);
        if (current?.delivery.status === "dead-letter") deadLettered += 1;
        else pending += 1;
      }
      return Boolean(eventId);
    }
    try {
      await consumer(claimed);
      await updateMenuPlanningEvent(claimed.eventId, (event) =>
        event.delivery.claimId === claimId
          ? normalizePublicationValue(
              markEventDelivered(event, new Date().toISOString()),
            )
          : undefined,
      );
      delivered += 1;
    } catch (error) {
      const updated = await updateMenuPlanningEvent(claimed.eventId, (event) =>
        event.delivery.claimId === claimId
          ? normalizePublicationValue(
              markEventFailed(event, error, new Date().toISOString()),
            )
          : undefined,
      );
      failed += 1;
      if (updated?.delivery.status === "dead-letter") deadLettered += 1;
    }
    return true;
  };
  if (targetIds) for (const eventId of ids.slice(0, options.maxEvents ?? ids.length)) await processOne(eventId);
  else {
    const maxEvents = Math.min(Math.max(options.maxEvents ?? 25, 1), 25);
    let processed = 0;
    while (processed < maxEvents && await processOne()) processed += 1;
  }
  return { delivered, failed, deadLettered, pending };
}
export async function publicationSourceWeeks() {
  return (await listWeeks()).filter(
    (week) =>
      week.status === "published" || week.status === "partially_published",
  );
}
export async function withdrawPublishedMenuDay(
  publicationId: string,
  publicationDayId: string,
  reason: string,
  actor = "local-menu-planner",
  authorize?: (days: PublishedMenuDay[]) => void,
) {
  if (!reason.trim())
    throw Object.assign(new Error("A withdrawal reason is required."), {
      status: 422,
    });
  const weekId = publicationId.replace(/^menu-publication:/, "");
  const expectedWeekVersion = (await getWeek(weekId)).week.version;
  return withMenuPlanningTransaction(
    (state) => {
      const stored = state.publications as unknown as StoredPublications;
      const publication = stored.publications.find(
        (value) => value.publicationId === publicationId,
      );
      const day = publication?.days.find(
        (value) => value.publicationDayId === publicationDayId,
      );
      if (!publication || !day)
        throw Object.assign(new Error("Published menu day was not found."), {
          status: 404,
        });
      if (day.status !== "published")
        throw conflict("Only the current published day can be withdrawn.");
      authorize?.([day]);
      const at = now();
      day.status = "withdrawn";
      day.withdrawal = { actor, at, reason: reason.trim() };
      publication.audit.push({
        action: "menu-day-withdrawn",
        at,
        by: actor,
        publicationDayId,
      });
       const handoffEventIds = appendPublicationEvents(stored, publication, day, "withdrawn", actor);
      const currentDays = publication.days.filter(
        (candidate) => candidate.status === "published",
      );
      if (currentDays.length) {
        publication.publicationVersion =
          (publication.publicationVersion || 0) + 1;
        const compiledSnapshot = buildCompiledPublicationSnapshot(
          publication,
          expectedWeekVersion,
        );
        publication.compiledSnapshotId = compiledSnapshot.snapshotId;
        publication.weekPacket = encodeWeeklyPublicationPacket(
          compiledSnapshot,
          at,
        );
        publication.publicationStatus = "published";
        stored.snapshots ||= {};
        stored.snapshots[compiledSnapshot.snapshotId] = compiledSnapshot;
      } else {
        // Historical snapshots remain immutable, but no current pointer may
        // continue exposing a fully withdrawn publication to CPU consumers.
        delete publication.compiledSnapshotId;
        delete publication.weekPacket;
        publication.publicationStatus = "withdrawn";
      }
      const rolling = state.rolling as unknown as RollingMenuStored;
      const snapshot = snapshotFromStored(rolling, publication.sourceWeekId);
      snapshot.week.dayStatuses = {
        ...(snapshot.week.dayStatuses || {}),
        [day.sourceDayId]: "draft",
      };
      snapshot.week.status = currentDays.length
        ? "partially_published"
        : "draft";
      snapshot.week.version += 1;
      snapshot.week.audit.push({ action: "menu-day-withdrawn", at, by: actor });
      replaceSnapshotInStored(rolling, snapshot);
       return commandResult(publication, handoffEventIds);
    },
    { weekId, weekVersion: expectedWeekVersion },
    { weekId, sourceWeekId: weekId, includeEvents: false },
  );
}
export async function withdrawPublishedMenuWeek(
  publicationId: string,
  reason: string,
  actor = "local-menu-planner",
  authorize?: (days: PublishedMenuDay[]) => void,
) {
  if (!reason.trim())
    throw Object.assign(new Error("A withdrawal reason is required."), {
      status: 422,
    });
  return withMenuPlanningTransaction(
    (state) => {
      const stored = state.publications as unknown as StoredPublications;
      const publication = stored.publications.find(
        (value) => value.publicationId === publicationId,
      );
      if (!publication)
        throw Object.assign(new Error("Menu publication was not found."), {
          status: 404,
        });
      const publishedDays = publication.days.filter(
        (day) => day.status === "published",
      );
      if (!publishedDays.length)
        throw conflict(
          "This menu week has no current published days to withdraw.",
        );
      authorize?.(publishedDays);
      const at = now();
       const handoffEventIds: string[] = [];
       for (const day of publishedDays) {
         day.status = "withdrawn";
         day.withdrawal = { actor, at, reason: reason.trim() };
         handoffEventIds.push(...appendPublicationEvents(stored, publication, day, "withdrawn", actor));
      }
      const rolling = state.rolling as unknown as RollingMenuStored;
      const snapshot = snapshotFromStored(rolling, publication.sourceWeekId);
      snapshot.week.dayStatuses = Object.fromEntries(
        serviceDaysForWeek(snapshot).map((day) => [day.id, "draft"]),
      );
      snapshot.week.status = "draft";
      snapshot.week.version += 1;
      snapshot.week.audit.push({
        action: "menu-week-withdrawn",
        at,
        by: actor,
      });
      replaceSnapshotInStored(rolling, snapshot);
      publication.audit.push({ action: "menu-week-withdrawn", at, by: actor });
      publication.publicationStatus = "withdrawn";
      // Keep immutable historical snapshots for audit, but clear the live
      // pointers so CPU cannot retrieve withdrawn bytes as current evidence.
      delete publication.compiledSnapshotId;
      delete publication.weekPacket;
       return commandResult(publication, handoffEventIds);
    },
    undefined,
    {
      weekId: publicationId.replace(/^menu-publication:/, ""),
      sourceWeekId: publicationId.replace(/^menu-publication:/, ""),
      includeEvents: false,
    },
  );
}
export async function archivePublishedDayMatrix(
  publicationId: string,
  publicationDayId: string,
) {
  const publication = await getMenuPublication(publicationId);
  const day = publication?.days.find(
    (value) => value.publicationDayId === publicationDayId,
  );
  if (!publication || !day)
    throw new Error("Published menu day was not found.");
  const html = publishedDayMatrixHtml(day);
  const pdfFileName =
    `Delivered-In_${publication.weekCommencing}_${day.dayName}_v${day.version}_Allergen-Matrix.pdf`.replace(
      /[^A-Za-z0-9._-]+/g,
      "_",
    );
  let base: string | undefined;
  let archiveEndpointRejected = false;
  try {
    base = hospitalityArchiveBase();
  } catch {
    archiveEndpointRejected = true;
  }
  const archivedAt = now();
  let archive: DriveArchive = {
    status: "failed",
    account:
      process.env.MENU_PUBLICATION_DRIVE_ACCOUNT_LABEL ||
      "Configured Google Drive account",
    fileName: pdfFileName,
    pdfFileName,
    pdfStatus: "unavailable",
    archivedAt,
  };
  let pdfBase64: string | undefined;
  try {
    const outputPath = join(
      /*turbopackIgnore: true*/ process.env.TEMP || process.env.TMP || ".",
      pdfFileName,
    );
    await renderPdfLocally(html, outputPath);
    pdfBase64 = (await readFile(outputPath)).toString("base64");
  } catch {
    /* The archive remains failed until a PDF can be generated. */
  }
  if (pdfBase64 && !base) {
    const status = archiveEndpointRejected ? "failed" : "not_configured";
    archive = { ...archive, status, pdfStatus: status };
  }
  if (pdfBase64 && base)
    try {
      const response = await fetch(`${base}/api/allergen-matrix/drive`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: pdfFileName,
          html,
          pdfBase64,
          siteKey:
            process.env.MENU_PUBLICATION_DRIVE_SITE_KEY || "delivered-in",
          weekCommencing: publication.weekCommencing,
        }),
        signal: AbortSignal.timeout(8000),
      });
      const body = (await response.json()) as {
        saved?: { fileId?: string; driveUrl?: string } | null;
      };
      archive = {
        ...archive,
        status:
          response.ok && body.saved
            ? "saved"
            : response.status === 503
              ? "not_configured"
              : "failed",
        pdfStatus:
          response.ok && body.saved
            ? "saved"
            : response.status === 503
              ? "not_configured"
              : "failed",
        ...(body.saved?.fileId
          ? { fileId: body.saved.fileId, pdfFileId: body.saved.fileId }
          : {}),
        ...(body.saved?.driveUrl
          ? { driveUrl: body.saved.driveUrl, pdfDriveUrl: body.saved.driveUrl }
          : {}),
      };
    } catch {
      /* Publication remains available; the PDF archive status is retained for retry/attention. */
    }
  await withMenuPlanningTransaction(
    (state) => {
      const stored = state.publications as unknown as StoredPublications;
      const target = stored.publications
        .find((value) => value.publicationId === publicationId)
        ?.days.find((value) => value.publicationDayId === publicationDayId);
      if (target) target.driveArchive = archive;
    },
    undefined,
    { sourceWeekId: publication.sourceWeekId, includeEvents: false },
  );
  return archive;
}
