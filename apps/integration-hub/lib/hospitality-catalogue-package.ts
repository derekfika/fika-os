import { layoutPackageFromDocuments, readStoredServiceLayouts, type StoredServiceLayout } from "./hospitality-service-layout";
import { bookingPolicyFor } from "@fika/server-shared/hospitality-effective-offering";
/**
 * Published Hospitality catalogue package.
 *
 *   Firestore canonical catalogue (authoritative, administrative)
 *     -> compact resolved package (Items once, company defaults once, SPARSE exceptions; never the Item x OPLOC matrix)
 *     -> gzip, content-addressed immutable object  integration-hub/hospitality-catalogue/v<n>-<sha256(gzip bytes)>.json.gz
 *     -> tiny mutable manifest (schemaVersion, contentHash, generatedAt, object identity, sizes)
 *     -> browser IndexedDB cache -> the SAME effective-offering resolver.
 *
 * Reuses the platform read-package machinery (hash over the compressed bytes, raw-byte storage reads, manifest + immutable object).
 * Rebuilds are explicit and mutation-triggered (never a synchronous side effect of a GET), coalesced, and deterministic: an unchanged
 * catalogue yields the same content hash, so no new object or package version is created.
 */
import { encodeReadPackage, publishReadPackage, retrieveReadPackage, type ReadPackageManifest, type ReadPackageStore } from "@fika/server-shared/read-package";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { db } from "./firebase-admin";
import { listCanonicalRecordsByTypes, } from "./canonical-oplocs";
import { oplocPackageStore } from "./oploc-read-package";
import type { CanonicalRecord } from "./types";
import { CATALOGUE_PACKAGE_CONTRACT, CATALOGUE_PACKAGE_SCHEMA_VERSION, isRedundantException, type CataloguePackage, type PackageException, type PackageItem, type PricePeriod } from "./hospitality-effective-offering";
import { routingStateOf } from "./hospitality-catalogue-read-model";
import { isActiveOplocRecord } from "./hospitality-catalogue-oploc";
import type { RoutingDoc } from "./hospitality-catalogue-canonicalisation";

export const CATALOGUE_DATASET = "integration-hub/hospitality-catalogue";
export const CATALOGUE_MANIFEST_KEY = "integration-hub/hospitality-catalogue";
export const PUBLIC_CATALOGUE_DATASET = "hospitality-booking/catalogue";
export const PUBLIC_CATALOGUE_MANIFEST_KEY = "hospitality-booking/catalogue";
const text = (value: unknown) => (typeof value === "string" ? value : "");
const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const published = (record: CanonicalRecord) => record.lifecycleStatus === "published" && record.publicationStatus === "published";
const live = (record: CanonicalRecord) => published(record) && record.record.lifecycleState === "active";
const period = (price: CanonicalRecord): PricePeriod => ({ amount: typeof price.record.amount === "number" ? price.record.amount : Number.NaN, vatRate: typeof price.record.vatRate === "number" ? price.record.vatRate : Number.NaN, from: text(price.record.effectiveFrom), ...(text(price.record.effectiveTo) ? { to: text(price.record.effectiveTo) } : {}) });
const byPeriod = (a: PricePeriod, b: PricePeriod) => a.from.localeCompare(b.from) || a.amount - b.amount;
const strings = (value: unknown) => (Array.isArray(value) ? value.map(String) : []);

function allowedScope(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.length || value.some(id => typeof id !== "string" || !id.startsWith("oploc:"))) throw new Error("Invalid governed catalogue site scope.");
  return [...new Set(value as string[])].sort();
}

export type PackageSource = { items: CanonicalRecord[]; offerings: CanonicalRecord[]; prices: CanonicalRecord[]; oplocs: CanonicalRecord[]; routing: RoutingDoc[]; /** Stored service layout documents; when present the package carries the effective layout (seed when none are stored). */ serviceLayout?: StoredServiceLayout[] };

/** Pure: canonical records -> compact package. Redundant legacy Offerings (no effect beyond the defaults) are omitted: they are not exceptions. */
export function buildCataloguePackage(source: PackageSource, today: string): CataloguePackage {
  const itemPrices = new Map<string, PricePeriod[]>(), offeringPrices = new Map<string, PricePeriod[]>();
  for (const price of source.prices.filter(live)) {
    const itemId = text(price.record.hospitalityMenuItemId), offeringId = text(price.record.hospitalityMenuOfferingId);
    if (itemId) itemPrices.set(itemId, [...(itemPrices.get(itemId) || []), period(price)]);
    if (offeringId) offeringPrices.set(offeringId, [...(offeringPrices.get(offeringId) || []), period(price)]);
  }
  const routing = new Map(source.routing.map(row => [row.menuItemId, row]));
  const items: PackageItem[] = source.items.filter(live).map(item => ({
    ...(item.record.allowedOplocIds !== undefined ? { allowedOplocIds: allowedScope(item.record.allowedOplocIds) } : {}),
    id: item.canonicalId, name: text(item.record.name), category: text(item.record.category), ...(text(item.record.description) ? { description: text(item.record.description) } : {}),
    defaultPrices: (itemPrices.get(item.canonicalId) || []).sort(byPeriod), ...(number(item.record.defaultMinimumQuantity) !== undefined ? { defaultMinimumQuantity: number(item.record.defaultMinimumQuantity) } : {}),
    ...(item.record.defaultOfferingMode === "quote_only" ? { defaultMode: "quote_only" as const } : {}), ...(number(item.record.defaultNoticeRequiredDays) !== undefined ? { defaultNoticeRequiredDays: number(item.record.defaultNoticeRequiredDays) } : {}), ...(number(item.record.defaultMinimumGuests) !== undefined ? { defaultMinimumGuests: number(item.record.defaultMinimumGuests) } : {}),
    ...(item.record.configuration && Object.keys(item.record.configuration as object).length ? { configuration: item.record.configuration as Record<string, unknown> } : {}),
    bookingPolicy: bookingPolicyFor(item.canonicalId, routingStateOf(routing.get(item.canonicalId)).state, Array.isArray(item.record.providerMappings) ? item.record.providerMappings.flatMap(raw => typeof (raw as { sourceItemId?: unknown })?.sourceItemId === "string" ? [(raw as { sourceItemId: string }).sourceItemId] : []) : []),
    dietaryInformation: strings(item.record.dietaryInformation), allergenInformation: strings(item.record.allergenInformation), routing: routingStateOf(routing.get(item.canonicalId)).state,
  })).sort((a, b) => a.id.localeCompare(b.id));
  const itemById = new Map(items.map(item => [item.id, item]));
  const exceptions: PackageException[] = [];
  for (const offering of source.offerings.filter(live)) {
    const item = itemById.get(text(offering.record.hospitalityMenuItemId)); if (!item) continue; // archived/unknown Item: nothing to resolve
    const configuration = offering.record.configuration && Object.keys(offering.record.configuration as object).length ? offering.record.configuration as Record<string, unknown> : undefined;
    const displayName = text(configuration?.displayName) || undefined, description = text(configuration?.description) || undefined;
    const entry: PackageException = {
      id: offering.canonicalId, itemId: item.id, oplocId: text(offering.record.oplocId), ...(text(offering.record.operationalAreaId) ? { operationalAreaId: text(offering.record.operationalAreaId) } : {}),
      mode: offering.record.offeringMode === "quote_only" ? "quote_only" : "standard", available: offering.record.available !== false,
      prices: (offeringPrices.get(offering.canonicalId) || []).sort(byPeriod),
      ...(number(offering.record.minimumQuantity) !== undefined ? { minimumQuantity: number(offering.record.minimumQuantity) } : {}), ...(number(offering.record.minimumGuests) !== undefined ? { minimumGuests: number(offering.record.minimumGuests) } : {}),
      ...(number(offering.record.noticeRequiredDays) !== undefined ? { noticeRequiredDays: number(offering.record.noticeRequiredDays) } : {}),
      ...(displayName ? { displayName } : {}), ...(description ? { description } : {}), ...(configuration ? { configuration } : {}),
    };
    // Item-level configuration is the company default: an identical site configuration states nothing new.
    const sameConfiguration = !configuration || JSON.stringify(configuration) === JSON.stringify(item.configuration);
    if (!isRedundantException({ ...entry, ...(sameConfiguration ? { configuration: undefined } : {}) }, item, today)) exceptions.push(entry);
  }
  exceptions.sort((a, b) => a.id.localeCompare(b.id));
  const oplocs = source.oplocs.filter(isActiveOplocRecord).map(oploc => ({ id: oploc.canonicalId, label: text(oploc.record.approvedName) || "Unnamed location" })).sort((a, b) => a.id.localeCompare(b.id));
  return { schemaVersion: CATALOGUE_PACKAGE_SCHEMA_VERSION, contract: CATALOGUE_PACKAGE_CONTRACT, items, exceptions, oplocs, ...(source.serviceLayout ? { serviceLayout: layoutPackageFromDocuments(source.serviceLayout) } : {}) };
}

export type PublishOutcome = { status: "published" | "unchanged"; manifest: ReadPackageManifest };
const inflight = { current: undefined as Promise<PublishOutcome> | undefined };

export async function publishCataloguePackage(pkg: CataloguePackage, store: ReadPackageStore = oplocPackageStore()): Promise<PublishOutcome> {
  const previous = await store.getManifest(CATALOGUE_MANIFEST_KEY);
  const candidate = encodeReadPackage(CATALOGUE_DATASET, (previous?.packageVersion || 0) + 1, pkg, pkg.items.length + pkg.exceptions.length, { schemaVersion: CATALOGUE_PACKAGE_SCHEMA_VERSION, contractVersion: CATALOGUE_PACKAGE_CONTRACT });
  if (previous && previous.contentHash === candidate.manifest.contentHash && previous.schemaVersion === CATALOGUE_PACKAGE_SCHEMA_VERSION && (await store.has(previous.objectName))) return { status: "unchanged", manifest: previous };
  return { status: "published", manifest: await publishReadPackage<CataloguePackage>(store, CATALOGUE_MANIFEST_KEY, candidate) };
}

/** Public booking projection. Production routing and Hub-only metadata never leave the private package. */
export async function publishPublicCataloguePackage(pkg: CataloguePackage, store: ReadPackageStore = oplocPackageStore()): Promise<PublishOutcome> {
  const previous = await store.getManifest(PUBLIC_CATALOGUE_MANIFEST_KEY);
  const publicPackage = { ...pkg, items: pkg.items.map(({ routing, ...item }) => ({ ...item, bookingPolicy: { sandwich: bookingPolicyFor(item.id, routing).sandwich || item.bookingPolicy?.sandwich || false, fridayUnavailable: bookingPolicyFor(item.id).fridayUnavailable || item.bookingPolicy?.fridayUnavailable || false } })) };
  const candidate = encodeReadPackage(PUBLIC_CATALOGUE_DATASET, (previous?.packageVersion || 0) + 1, publicPackage, pkg.items.length + pkg.exceptions.length, { schemaVersion: CATALOGUE_PACKAGE_SCHEMA_VERSION, contractVersion: CATALOGUE_PACKAGE_CONTRACT });
  // Hash-only object names let an already-issued immutable URL continue to work
  // after the mutable manifest advances to a newer package.
  candidate.manifest.objectName = `${PUBLIC_CATALOGUE_DATASET}/${candidate.manifest.contentHash}.json.gz`;
  if (previous && previous.contentHash === candidate.manifest.contentHash && previous.schemaVersion === CATALOGUE_PACKAGE_SCHEMA_VERSION && await store.has(previous.objectName)) return { status: "unchanged", manifest: previous };
  return { status: "published", manifest: await publishReadPackage(store, PUBLIC_CATALOGUE_MANIFEST_KEY, candidate) };
}

/** Bounded rebuild: 4 entityType queries + routing. Coalesced so concurrent mutations share one rebuild. */
export async function rebuildCataloguePackage(store?: ReadPackageStore): Promise<PublishOutcome> {
  if (inflight.current) return inflight.current;
  inflight.current = (async () => {
    const [records, routing, layouts] = await Promise.all([
      listCanonicalRecordsByTypes(["Hospitality Menu Item", "Hospitality Menu Offering", "Hospitality Menu Price", "OPLOC"], 1000) as Promise<CanonicalRecord[]>,
      db.collection("integrationHubHospitalityMenuProductionRouting").limit(2001).get(),
      readStoredServiceLayouts(),
    ]);
    recordDataAccess({ app: "integration-hub", operation: "hospitality-catalogue.package.rebuild", source: "FIRESTORE", documents: records.length + routing.size + layouts.length });
    const of = (type: string) => records.filter(record => record.entityType === type);
    const pkg = buildCataloguePackage({ items: of("Hospitality Menu Item"), offerings: of("Hospitality Menu Offering"), prices: of("Hospitality Menu Price"), oplocs: of("OPLOC"), routing: routing.docs.map(doc => doc.data() as RoutingDoc), serviceLayout: layouts }, new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
    const internal = await publishCataloguePackage(pkg, store);
    await publishPublicCataloguePackage(pkg, store);
    return internal;
  })().finally(() => { inflight.current = undefined; });
  return inflight.current;
}

/** Cheap read path: the manifest only (no Firestore). */
export async function getCataloguePackageManifest(store: ReadPackageStore = oplocPackageStore()) { return store.getManifest(CATALOGUE_MANIFEST_KEY); }
/** Integrity-checked package (the same function the server-side resolver paths use). */
export async function getCataloguePackage(store: ReadPackageStore = oplocPackageStore()) { return retrieveReadPackage<CataloguePackage>(store, CATALOGUE_MANIFEST_KEY); }
/** Raw gzip bytes of the CURRENT package, for the browser to hash-verify and cache. */
export async function getCataloguePackageBytes(contentHash: string, store: ReadPackageStore = oplocPackageStore()) {
  const manifest = await store.getManifest(CATALOGUE_MANIFEST_KEY);
  if (!manifest || manifest.contentHash !== contentHash) return undefined;
  const bytes = await store.get(manifest.objectName);
  return bytes ? { manifest, bytes } : undefined;
}

/** Raw gzip bytes for the public package, including prior immutable hash URLs. */
export async function getPublicCataloguePackageManifest(store: ReadPackageStore = oplocPackageStore()) { return store.getManifest(PUBLIC_CATALOGUE_MANIFEST_KEY); }
export async function getPublicCataloguePackageBytes(contentHash: string, store: ReadPackageStore = oplocPackageStore()) {
  if (!/^[0-9a-f]{64}$/.test(contentHash)) return undefined;
  const bytes = await store.get(`${PUBLIC_CATALOGUE_DATASET}/${contentHash}.json.gz`);
  return bytes ? { bytes } : undefined;
}

/** Best-effort invalidation after a catalogue mutation: never fails the mutation, always reports freshness explicitly. */
export async function republishAfterMutation(store?: ReadPackageStore): Promise<"published" | "unchanged" | "stale"> {
  try { return (await rebuildCataloguePackage(store)).status; } catch (error) { console.error("Hospitality catalogue package rebuild failed", { message: (error as Error).message }); return "stale"; }
}
