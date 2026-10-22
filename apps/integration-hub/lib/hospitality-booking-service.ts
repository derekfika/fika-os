import { groupCommercialState, groupHash, validateBookingGroup, MAX_GROUP_SERVICES } from "./hospitality-group-commercial";
import { groupAmendmentCommand, groupChargesCommand, type GroupAmendmentCommand, type GroupChargesCommand } from "./hospitality-group-amendment";
import crypto from "node:crypto";
import { groupEventKey, groupNotificationRecord, groupSubmittedNotification } from "./booking-group-notifications";
import { hospitalityGroupProjection } from "./hospitality-group-projection";
import { explicitMenuProductionRouting } from "./connections-service";
import { LEGACY_HOSPITALITY_MENU_ROUTING } from "./hospitality-routing-suggestions";
import { BOOKING_LABELS, hospitalityPlatformOf, isGovernedRoutingPlatform, LINE_LABELS, planHospitalityCpuRouting, routingKeys } from "./hospitality-cpu-routing";
import { assertHospitalityBookingDate } from "./hospitality-booking-cutoffs";
import { trustedPublicOrder } from "./hospitality-price-trust";
import { angelCourtBookingConstraintRecords, loadAngelCourtBookingCatalogue, loadMnkBookingCatalogue, loadRcoaBookingCatalogue, mnkBookingPricingRecords, rcoaBookingConstraintRecords } from "./mnk-booking-catalogue";
import { hospitalityMenuDate } from "../../shared/hospitality-menu-date";
import { db } from "./firebase-admin";
import type { Actor } from "./auth";
import type { CanonicalRecord } from "./types";
import { generateCanonicalId } from "./canonical-identities";
import { stableDocumentId } from "./canonical-editor";
import { sha256 } from "./profiler";
import { parseCanonical } from "./schemas";
import {
  applyBookingAdditionalCharges,
  hospitalityCancellationRequiresCpuReview,
  assertBookingExpectedVersion,
  assertWorkflowCommand,
  applyQuotePdfPersistence,
  type DashboardWorkflow,
  type QuoteRevision,
  type WorkflowCommand,
} from "./booking-workflow";
import {
  calculateQuoteSnapshot,
  defaultDashboardQuoteSettings,
  type DashboardQuoteSettings,
} from "./quote-engine";
import {
  normalizeBookingAdditionalCharges,
  validateLabourRates,
  type BookingAdditionalCharge,
} from "./hospitality-additional-charges";
import {
  bookingNotificationRecord,
  cancellationNotificationKind,
  type CancellationEvent,
  type BookingNotificationKind,
  type BookingNotificationRecord,
} from "./booking-notifications";
import {
  createProductionFromApprovedBooking,
  type ProductionOrder as ProductionOrderV1,
} from "./production-domain";
import { notifyCpuProjection } from "./cpu-projection-client";
import { deliverLogisticsProjectionForProductionOrder } from "./logistics-projection-outbox";
import { localBookingFixtures } from "./local-booking-fixtures";
import { catalogueMinimums, bookingPolicyFor, type RuleItem } from "@fika/server-shared/hospitality-effective-offering";
import { capGallagherMinimum, GALLAGHER_MINIMUM_GUESTS, isGallagherBooking } from "./gallagher-rules";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import type { Transaction } from "firebase-admin/firestore";
import { createDomainEvent } from "../../shared/domain-events";
import { stageDomainEvent } from "./domain-event-outbox";
import { prepareFulfilmentEvent } from "./fulfilment-projection";
import { cancellationDeliveryStatus, deliverHospitalityCancellation, ensureHospitalityCancellationEvent, hospitalityCancellationEventId, stageHospitalityCancellation } from "./hospitality-cancellation-outbox";

export const MNK_BOOKING_INGESTION_CONTRACT_VERSION =
  "fika.booking-ingestion.mnk.v1";
export const RCOA_BOOKING_INGESTION_CONTRACT_VERSION =
  "fika.booking-ingestion.rcoa.v1";
export const HOSPITALITY_MENU_READ_CONTRACT_VERSION =
  "fika.hospitality-menu-read.v1";

export type BookingGroupLink = { id: string; sequence: number; size: number };

export type MnkBookingPayload = {
  bookingGroup?: BookingGroupLink;
  bookingId: string;
  submittedAt: string;
  status?: string;
  site?: string;
  siteId?: string;
  client: {
    name: string;
    email: string;
    phone?: string;
    companyName: string;
    requester?: {
      name: string;
      email: string;
      phone?: string;
      companyName: string;
    };
    clientName?: string;
    clientCompany?: string;
    invoiceReference?: string;
  };
  event: {
    eventDate: string;
    startTime: string;
    endTime?: string;
    guestCount: number;
    floorLevel?: string;
    roomOrArea?: string;
    deliveryPoint?: string;
    onsiteContactName?: string;
    onsiteContactPhone?: string;
  };
  order: {
    eventType?: string;
    items: Array<{
      itemId: string;
      itemName?: string;
      category?: string;
      description?: string;
      servingInfo?: string;
      unitPrice: number;
      quantity: number;
      lineTotal: number;
      productionConversion?: { multiplier: number; unit: string };
      choices?: unknown[];
      comments?: string;
    }>;
    netTotal: number;
    vatNote?: string;
  };
  dietaries?: Record<string, unknown>;
  acknowledgements?: Record<string, unknown>;
  specialInstructions?: string;
};

export type CanonicalBooking = {
  canonicalId: string;
  entityType: "Booking";
  schemaVersion: "0.1.0";
  version: number;
  lifecycleStatus:
    | "New"
    | "Reviewed"
    | "Quoted"
    | "Sent to CPU"
    | "Approved"
    | "Completed"
    | "Cancelled";
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  source: {
    provider: "mnk-booking-platform" | "rcoa-booking-platform";
    sourceBookingId: string;
    submissionTimestamp: string;
    contractVersion: string;
    originalPayload: MnkBookingPayload;
  };
  client: MnkBookingPayload["client"];
  service: MnkBookingPayload["event"] & {
    portalSiteId?: string;
    portalSiteLabel?: string;
    oplocId?: string;
    operationalAreaId?: string;
    serviceArrangementId?: string;
  };
  order: {
    eventType?: string;
    items: Array<
      MnkBookingPayload["order"]["items"][number] & { menuItemId?: string }
    >;
    netTotal: number;
    vatNote?: string;
    currency: "GBP";
    vatTotal: number;
    grossTotal: number;
  };
  dietaries: Record<string, unknown>;
  acknowledgements: Record<string, unknown>;
  bookingGroup?: BookingGroupLink;
  notes?: string;
  attachments: string[];
  statusHistory: Array<{
    status: CanonicalBooking["lifecycleStatus"];
    changedAt: string;
    changedBy: string;
    reason: string;
  }>;
  audit: Array<{ action: string; at: string; by: string; reason: string }>;
  commercialVersion?: number;
  additionalCharges?: BookingAdditionalCharge[];
  quoteState?: { currentRevisionId?: string; revisions: QuoteRevision[] };
  dashboardWorkflow?: DashboardWorkflow;
  deliveryChargeRequired?: boolean;
};

export type ProductionOrder = {
  canonicalId: string;
  bookingId: string;
  version?: number;
  state: "Requested" | "Planned" | "Cancelled" | "Uncertain";
  updatedAt?: string;
  createdAt: string;
  createdBy: string;
  attempts: Array<{
    at: string;
    by: string;
    outcome: "created" | "uncertain" | "cancel_requested";
    reason: string;
  }>;
  sourceReferences: {
    bookingId: string;
    quoteRevisionId: string;
    bookingJsonReference: string;
    sourceBookingReference: string;
  };
};

type IngestionResult = {
  booking: CanonicalBooking;
  created: boolean;
  validationWarnings: string[];
};
const bookings = () => db.collection("fikaBookings");

/**
 * Gallagher dashboard candidate rule. Must stay a SUPERSET of (or equal to) the
 * Hospitality dashboard's final gate so the Hub never withholds a record the
 * dashboard should show: a booking is included when EITHER the requester email
 * domain is exactly `redington.co.uk` OR the BOOKING (requester) company is
 * Gallagher. The company condition is applied only when the payload explicitly
 * separates the requester's company from the end client (`clientCompany` /
 * `clientName`); an end-client name alone never matches, and a company that
 * cannot be verified as the booking company is ignored. Mirrors
 * apps/hospitality-booking/lib/gallagher-dashboard.ts (`isVisibleToGallagher`).
 */
function isGallagherDashboardBooking(booking: CanonicalBooking) {
  const client = booking.client;
  const email = String(client?.requester?.email || client?.email || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
  const at = email.lastIndexOf("@");
  const domain = at > 0 && at < email.length - 1 && email.indexOf("@") === at && !/[\s,;<>]/.test(email) ? email.slice(at + 1) : "";
  if (domain === "redington.co.uk") return true;
  const distinguished = client?.clientCompany !== undefined || client?.clientName !== undefined;
  const bookingCompany = distinguished ? String(client?.requester?.companyName || client?.companyName || "") : "";
  return bookingCompany.toLocaleLowerCase("en-GB").replace(/[^a-z0-9]/g, "") === "gallagher";
}

/**
 * Customer-safe projection: only the fields the Gallagher ledger renders.
 * Audit trail, status history, actors, attachments, dietary/acknowledgement
 * records and routing state never leave the Hub through this contract.
 */
export function projectGallagherDashboardBookings(documents: CanonicalBooking[]) {
  return documents.filter(isGallagherDashboardBooking).map((booking) => ({
    canonicalId: booking.canonicalId,
    lifecycleStatus: booking.lifecycleStatus,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
    source: {
      sourceBookingId: booking.source.sourceBookingId,
      provider: booking.source.provider,
      originalPayload: {
        legacyBookingId: (booking as CanonicalBooking & { legacyBookingId?: string }).legacyBookingId,
        legacyBookingReference: (booking.source.originalPayload as unknown as Record<string, unknown>)?.legacyBookingReference,
      },
    },
    client: {
      name: booking.client?.name, email: booking.client?.email, companyName: booking.client?.companyName, invoiceReference: booking.client?.invoiceReference,
      // End-client fields let the dashboard tell the requester's company from the client the meeting is for.
      clientName: booking.client?.clientName, clientCompany: booking.client?.clientCompany,
      requester: booking.client?.requester ? { name: booking.client.requester.name, email: booking.client.requester.email, companyName: booking.client.requester.companyName } : undefined,
    },
    service: {
      eventDate: booking.service?.eventDate, startTime: booking.service?.startTime, endTime: booking.service?.endTime, guestCount: booking.service?.guestCount,
      roomOrArea: booking.service?.roomOrArea, floorLevel: booking.service?.floorLevel, deliveryPoint: booking.service?.deliveryPoint,
      portalSiteId: booking.service?.portalSiteId, portalSiteLabel: booking.service?.portalSiteLabel,
    },
    // Stored totals only: no unit prices or line pricing leave the Hub through this contract.
    order: {
      items: (booking.order?.items || []).map((item) => ({ itemId: item.itemId, itemName: item.itemName, description: item.description, quantity: item.quantity, comments: item.comments })),
      grossTotal: booking.order?.grossTotal,
    },
    quoteState: {
      currentRevisionId: booking.quoteState?.currentRevisionId,
      revisions: (booking.quoteState?.revisions || []).map((revision) => ({ id: revision.id, snapshot: { totals: { gross: { amount: (revision.snapshot as { totals?: { gross?: { amount?: number } } } | undefined)?.totals?.gross?.amount } } } })),
    },
    notes: booking.notes,
    legacyBookingId: (booking as CanonicalBooking & { legacyBookingId?: string }).legacyBookingId,
  }));
}

/** Narrow, read-only service contract for the PIN-gated Gallagher customer ledger. */
export async function gallagherDashboardBookings() {
  const snapshot = await bookings()
    .where("service.portalSiteId", "==", "angel-court")
    .limit(501)
    .get();
  recordDataAccess({ app: "integration-hub", operation: "hospitality.gallagher-dashboard.bookings", source: "FIRESTORE", dataset: "fikaBookings", documents: snapshot.size, estimatedBillableReads: snapshot.size, firestoreReadKind: "query" });
  if (snapshot.size > 500) throw Object.assign(new Error("The Gallagher booking result exceeds the safe display limit."), { status: 503 });
  return projectGallagherDashboardBookings(snapshot.docs.map((document) => document.data() as CanonicalBooking));
}

export async function getBookingByCanonicalId(canonicalId: string) {
  const snapshot = await bookings().doc(canonicalId).get();
  recordDataAccess({ app: "integration-hub", operation: "hospitality.booking.by-id", source: "FIRESTORE", dataset: "fikaBookings", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "document" });
  if (!snapshot.exists) throw conflict("Booking was not found.");
  return snapshot.data() as CanonicalBooking;
}

export async function getDashboardQuoteSettingsForBooking(booking: Pick<CanonicalBooking, "service">) {
  return getDashboardQuoteSettings(dashboardIdForSite(booking.service.portalSiteId));
}
const sourceMappings = () => db.collection("integrationHubSourceMappings");
const bookingAudit = () => db.collection("fikaBookingAudit");
const productionOrders = () => db.collection("fikaProductionOrders");
const productionOrderV1s = () => db.collection("fikaProductionOrdersV1");
const dashboardQuoteSettings = () =>
  db.collection("fikaDashboardQuoteSettings");
const canonical = () => db.collection("integrationHubCanonical");

export function menuForMnkPortal(records: CanonicalRecord[]) {
  const menu = records
    .filter(
      (record) =>
        record.entityType === "Hospitality Menu Item" &&
        record.lifecycleStatus !== "archived" &&
        record.record.lifecycleState === "active",
    )
    .map((record) => {
      const mapping = Array.isArray(record.record.providerMappings)
        ? (record.record.providerMappings.find((value) =>
            isMnkMapping(value),
          ) as Record<string, unknown> | undefined)
        : undefined;
      if (!mapping) return null;
      return {
        canonicalId: record.canonicalId,
        id: String(mapping.sourceItemId),
        name: String(record.record.name),
        description: optional(record.record.description),
        category: String(record.record.category),
        unitPrice: Number(record.record.unitPrice),
        vatRate: Number(record.record.vatRate),
        dietaryInformation: stringArray(record.record.dietaryInformation),
        allergenInformation: stringArray(record.record.allergenInformation),
        minimumQuantity: numberOrUndefined(record.record.minimumQuantity),
        minimumGuests: numberOrUndefined(record.record.minimumGuests),
        noticeRequiredDays: numberOrUndefined(record.record.noticeRequiredDays),
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  return {
    contractVersion: HOSPITALITY_MENU_READ_CONTRACT_VERSION,
    source: "canonical",
    menu,
  };
}

export async function mnkMenuReadContract() {
  // Keep the MNK contract bounded to menu-item lifecycle states. The ordinary
  // GET must not reconstruct it by scanning unrelated canonical entities.
  const snapshot = await canonical()
    .where("entityType", "==", "Hospitality Menu Item")
    .where("lifecycleStatus", "in", ["draft", "published"])
    .get();
  recordDataAccess({ app: "integration-hub", operation: "hospitality-menu.read", source: "FIRESTORE", dataset: "integrationHubCanonical", documents: snapshot.size, firestoreReadKind: "query" });
  return menuForMnkPortal(
    snapshot.docs.map((document) => document.data() as CanonicalRecord),
  );
}

export type MenuCatalogueCommand = {
  canonicalId?: string;
  expectedVersion?: number;
  name: string;
  description?: string;
  category: string;
  dietaryInformation?: string[];
  allergenInformation?: string[];
  providerMappings: Array<{
    provider: string;
    sourceItemId: string;
    sourceVersion?: string;
  }>;
  lifecycleState: "active" | "archived";
};
export async function saveHospitalityMenuItem(
  actor: Actor,
  command: MenuCatalogueCommand,
) {
  const canonicalId =
    command.canonicalId || generateCanonicalId("Hospitality Menu Item");
  return db.runTransaction(async (transaction) => {
    const ref = canonical().doc(stableDocumentId(canonicalId));
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists
      ? (snapshot.data() as CanonicalRecord)
      : undefined;
    if (current && current.entityType !== "Hospitality Menu Item")
      throw conflict("Canonical ID belongs to another entity type.");
    if (
      current &&
      Number(current.record.version) !== Number(command.expectedVersion)
    )
      throw conflict("Menu item changed elsewhere. Refresh and try again.");
    const now = new Date().toISOString();
    const base = current
      ? {
          ...structuredClone(current.record),
          version: Number(current.record.version) + 1,
          updatedAt: now,
          updatedBy: actor.uid,
        }
      : {
          schemaVersion: "0.1.0",
          version: 1,
          createdAt: now,
          createdBy: actor.uid,
          updatedAt: now,
          updatedBy: actor.uid,
          active: true,
          externalIdentities: [],
          provenanceIds: [],
          ownership: { providerOwned: {}, fikaOwned: {} },
        };
    const record = {
      ...base,
      entityType: "Hospitality Menu Item" as const,
      canonicalId,
      name: command.name.trim(),
      ...(optional(command.description)
        ? { description: optional(command.description) }
        : {}),
      category: command.category.trim(),
      lifecycleState: command.lifecycleState,
      dietaryInformation: command.dietaryInformation || [],
      allergenInformation: command.allergenInformation || [],
      providerMappings: command.providerMappings,
    };
    const parsed = parseCanonical("Hospitality Menu Item", record);
    if (!parsed.success)
      throw conflict(
        `Hospitality Menu Item validation failed: ${parsed.error.issues[0]?.message || "Review the values."}`,
      );
    const next: CanonicalRecord = {
      canonicalId,
      entityType: "Hospitality Menu Item",
      record,
      dataHash: sha256(JSON.stringify(record)),
      lifecycleStatus: current?.lifecycleStatus || "published",
      publicationStatus: current?.publicationStatus || "published",
      publishedAt: current?.publishedAt || now,
    };
    transaction.set(ref, next);
    transaction.set(
      db
        .collection("integrationHubCanonicalRevisions")
        .doc(stableDocumentId(`${canonicalId}:${record.version}`)),
      {
        canonicalId,
        entityType: next.entityType,
        version: record.version,
        previous: current || null,
        current: next,
        actorId: actor.uid,
        recordedAt: now,
        reason: current
          ? "Hospitality Menu Item updated."
          : "Hospitality Menu Item created and published.",
      },
    );
    transaction.set(
      db.collection("integrationHubGovernanceAudit").doc(crypto.randomUUID()),
      {
        action: current
          ? "Hospitality Menu Item updated"
          : "Hospitality Menu Item created",
        entityReference: canonicalId,
        actorId: actor.uid,
        actorName: actor.name,
        timestamp: now,
        reason: "Governed Hospitality Menu Catalogue action.",
      },
    );
    return next;
  });
}

export function canonicalBookingId(sourceBookingId: string, portalSiteId?: string) {
  const isRcoa = portalSiteId === "rcoa";
  const provider = isRcoa ? "rcoa-booking-platform" : "mnk-booking-platform";
  const digest = crypto
    .createHash("sha256")
    .update(`${provider}:${sourceBookingId.trim()}`)
    .digest("hex")
    .slice(0, 32);
  return `booking:${isRcoa ? "rcoa" : "mnk"}:${digest}`;
}

/** Resolve a portal site through governed source mapping; labels are not identity. */
export function resolveHospitalityDestinationOploc(
  payload: Pick<MnkBookingPayload, "siteId" | "site">,
  mappings: Array<Record<string, unknown>>,
  canonicalRecords: CanonicalRecord[],
) {
  const destination = resolveHospitalityDestinationId(payload, mappings);
  const target = canonicalRecords.find(record => record.entityType === "OPLOC" && record.canonicalId === destination && record.lifecycleStatus !== "archived" && record.publicationStatus !== "withdrawn" && record.record.lifecycleState === "active");
  return target?.canonicalId;
}
export function resolveHospitalityDestinationId(payload: Pick<MnkBookingPayload, "siteId" | "site">, mappings: Array<Record<string, unknown>>) {
  const sourceIdentifiers = portalSourceIdentifiers(payload);
  const portalSiteId = portalSiteKeyForPayload(payload);
  const candidates = mappings.filter(candidate => sourceIdentifiers.includes(String(candidate.sourceIdentifier || "").trim().toLowerCase()) && String(candidate.mappingStatus || "") === "confirmed" && (portalSiteId === "rcoa" ? String(candidate.sourceEntityType || "") === "provider-location" : Boolean(String(candidate.sourceEntityType || ""))));
  const mapping = portalSiteId === "rcoa" ? (candidates.length === 1 ? candidates[0] : undefined) : candidates[0];
  return String(mapping?.oplocId || mapping?.targetCanonicalId || "").trim() || undefined;
}

export function assertExpectedRcoaOploc(
  expectedOplocId: string | undefined,
  mappedOplocId: string | undefined,
  activeOplocId?: string,
) {
  const expected = String(expectedOplocId || "").trim();
  if (!expected)
    throw Object.assign(new Error("RCoA booking is unavailable because FIKA_RCOA_OPLOC_ID is not configured."), { status: 503 });
  if (!mappedOplocId)
    throw conflict("RCoA requires one confirmed Hub provider-location mapping for sourceIdentifier 'rcoa'.");
  if (mappedOplocId !== expected)
    throw conflict(`RCoA configuration mismatch: FIKA_RCOA_OPLOC_ID is '${expected}', but the confirmed Hub destination for sourceIdentifier 'rcoa' is '${mappedOplocId}'.`);
  if (activeOplocId !== expected)
    throw conflict(`RCoA configured OPLOC '${expected}' is not an active canonical destination.`);
  return expected;
}

function portalSourceIdentifiers(payload: Pick<MnkBookingPayload, "siteId" | "site">) {
  const portalSiteId = portalSiteKeyForPayload(payload);
  // RCoA dashboard access and booking handoff must be joined by its stable
  // portal key; a display label is never a governed site identity.
  if (portalSiteId === "rcoa")
    return String(payload.siteId || "").trim().toLowerCase() === "rcoa"
      ? [portalSiteId]
      : [];
  return [...new Set([portalSiteId, payload.site].map(value => String(value || "").trim().toLowerCase()).filter(Boolean))];
}
export function productionOrderId(bookingId: string) {
  return `production-order:${bookingId}`;
}

export function buildMnkCanonicalBooking(
  payload: MnkBookingPayload,
  menuRecords: CanonicalRecord[],
  now = new Date().toISOString(),
): IngestionResult {
  validatePayload(payload);
  const originalPayload = structuredClone(payload);
  const activeMenuItems = menuRecords.filter(
    (record) =>
      record.entityType === "Hospitality Menu Item" &&
      record.lifecycleStatus !== "archived" &&
      record.record.lifecycleState === "active",
  );
  const portalSiteId = portalSiteKeyForPayload(payload);
  payload = { ...payload, order: trustedPublicOrder(payload, menuRecords, portalSiteId || "mnk", now) };
  const expectedProvider = providerForSite(portalSiteId);
  const menuByItemId = new Map(
    activeMenuItems.flatMap((record) => [
      [record.canonicalId, record] as const,
      ...(Array.isArray(record.record.providerMappings)
        ? record.record.providerMappings
            .filter((mapping) => isPortalMapping(mapping, expectedProvider))
            .map(
              (mapping) =>
                [
                  String((mapping as Record<string, unknown>).sourceItemId),
                  record,
                ] as const,
            )
        : []),
    ]),
  );
  const warnings: string[] = [];
  if (originalPayload.order.netTotal !== payload.order.netTotal || originalPayload.order.items.some((item, index) => item.unitPrice !== payload.order.items[index].unitPrice || item.lineTotal !== payload.order.items[index].lineTotal)) warnings.push("Client price values differed from the server catalogue; server prices and recalculated totals were used.");
  // Angel Court and the other new portals currently retain their brochure
  // catalogue locally while those records are being promoted into the Hub.
  // Use those server-owned brochure catalogues during that transition;
  // MNK remains strict because its canonical catalogue is already governed.
  const siteCompatibilityMode = Boolean(
    portalSiteId !== "mnk",
  );
  const items = payload.order.items.map((item) => {
    const menuItem = menuByItemId.get(item.itemId);
    if (
      !menuRecords.some(
        (record) => record.entityType === "Hospitality Menu Item",
      )
    )
      warnings.push(
        "Hospitality Menu Catalogue has no MNK mappings yet; server brochure price used as compatibility evidence.",
      );
    else if (!menuItem && siteCompatibilityMode)
      warnings.push(
        `${payload.site || portalSiteId} menu item '${item.itemId}' is retained as site-scoped compatibility evidence until its canonical Menu Item mapping is promoted.`,
      );
    else if (!menuItem)
      throw conflict(
        `${payload.site || "MNK"} menu item '${item.itemId}' is not mapped to an active canonical Hospitality Menu Item.`,
      );
    if (menuItem || item.servingInfo) {
      const gallagher = isGallagherBooking({
        companyName: payload.client.clientCompany || payload.client.companyName,
        email: payload.client.email || payload.client.requester?.email,
      });
      const governedConstraintsResolved = menuItem?.record.governedConstraintsResolved === true;
      const minimumQuantity = capGallagherMinimum(Math.max(
        Number(menuItem?.record.minimumQuantity || 1),
        governedConstraintsResolved ? 1 : Number(String(item.servingInfo || "").match(/minimum\s+(\d+)/i)?.[1] || 1),
        governedConstraintsResolved ? 1 : (/rice paper rolls?/i.test(String(item.itemName || menuItem?.record.name)) ? 3 : 1),
      ), gallagher);
      if (
        Number.isFinite(minimumQuantity) &&
        minimumQuantity > 1 &&
        item.quantity < minimumQuantity
      )
        throw conflict(
          `${item.itemName || item.itemId} requires at least ${minimumQuantity} boxes.`,
        );
      const minimumGuests = catalogueMinimums({ id: item.itemId, name: item.itemName || item.itemId, minimumGuests: numberOrUndefined(menuItem?.record.minimumGuests), configuration: menuItem?.record.configuration as RuleItem["configuration"] }, gallagher).guests;
      if (minimumGuests !== undefined && payload.event.guestCount < minimumGuests)
        throw conflict(
          `${item.itemName || item.itemId} requires at least ${minimumGuests} guests.`,
        );
    }
    return {
      ...structuredClone(item),
      ...(menuItem ? { menuItemId: menuItem.canonicalId } : {}),
    };
  });
  const isRcoa = portalSiteId === "rcoa";
  const sourceProvider = isRcoa ? "rcoa-booking-platform" : "mnk-booking-platform";
  const bridgeActor = `bridge:${sourceProvider}`;
  const status: CanonicalBooking["lifecycleStatus"] = "New";
  const vatTotal = 0; // The portal's current snapshot is net-only; do not manufacture VAT line detail.
  return {
    booking: {
      canonicalId: canonicalBookingId(payload.bookingId, portalSiteId),
      entityType: "Booking",
      schemaVersion: "0.1.0",
      version: 1,
      lifecycleStatus: status,
      createdAt: now,
      createdBy: bridgeActor,
      updatedAt: now,
      updatedBy: bridgeActor,
      source: {
        provider: sourceProvider,
        sourceBookingId: payload.bookingId.trim(),
        submissionTimestamp: payload.submittedAt,
        contractVersion: isRcoa ? RCOA_BOOKING_INGESTION_CONTRACT_VERSION : MNK_BOOKING_INGESTION_CONTRACT_VERSION,
        originalPayload,
      },
      client: structuredClone(payload.client),
      service: {
        ...structuredClone(payload.event),
        ...(portalSiteId ? { portalSiteId } : {}),
        ...(payload.site ? { portalSiteLabel: payload.site } : {}),
      },
      order: {
        eventType: payload.order.eventType,
        items,
        netTotal: payload.order.netTotal,
        ...(payload.order.vatNote ? { vatNote: payload.order.vatNote } : {}),
        currency: "GBP",
        vatTotal,
        grossTotal: payload.order.netTotal + vatTotal,
      },
      dietaries: structuredClone(payload.dietaries || {}),
      acknowledgements: structuredClone(payload.acknowledgements || {}),
      ...(payload.bookingGroup ? { bookingGroup: structuredClone(payload.bookingGroup) } : {}),
      ...(optional(payload.specialInstructions)
        ? { notes: optional(payload.specialInstructions) }
        : {}),
      attachments: [],
      commercialVersion: 1,
      quoteState: { revisions: [] },
      dashboardWorkflow: {},
      deliveryChargeRequired: true,
      statusHistory: [
        {
          status,
          changedAt: now,
          changedBy: bridgeActor,
          reason: isRcoa ? "Submitted through RCoA Hospitality Booking Portal." : "Submitted through MNK Hospitality Booking Portal.",
        },
      ],
      audit: [
        {
          action: "booking-ingested",
          at: now,
          by: bridgeActor,
          reason: isRcoa
            ? "Canonical bridge accepted the structured RCoA portal booking."
            : "Canonical bridge accepted the structured MNK portal booking.",
        },
      ],
    },
    created: true,
    validationWarnings: [...new Set(warnings)],
  };
}

/** Pure idempotency decision used before the Firestore transaction writes. */
export function ingestMnkBookingFromExisting(
  existing: CanonicalBooking | undefined,
  payload: MnkBookingPayload,
  menuRecords: CanonicalRecord[],
  now?: string,
  destinationOplocId?: string,
): IngestionResult {
  if (existing)
    return { booking: existing, created: false, validationWarnings: [] };
  const portalSiteId = portalSiteKeyForPayload(payload);
  const resolvedRecords = portalSiteId === "angel-court" && destinationOplocId
    ? angelCourtBookingConstraintRecords(menuRecords, payload, destinationOplocId, now)
    : portalSiteId === "rcoa" && destinationOplocId
      ? rcoaBookingConstraintRecords(menuRecords, payload, destinationOplocId, now)
      : menuRecords;
  const result = buildMnkCanonicalBooking(payload, resolvedRecords, now);
  if (destinationOplocId) result.booking.service.oplocId = destinationOplocId;
  return result;
}

export async function ingestMnkBooking(
  payload: MnkBookingPayload,
  expectedRcoaOplocId?: string,
): Promise<IngestionResult> {
  const portalSiteId = portalSiteKeyForPayload(payload);
  const isRcoa = portalSiteId === "rcoa";
  if (isRcoa && !String(expectedRcoaOplocId || "").trim())
    assertExpectedRcoaOploc(undefined, undefined);
  const bookingId = canonicalBookingId(payload.bookingId, portalSiteId);
  const now = new Date().toISOString();
  const result = await db.runTransaction(async (transaction) => {
    const existingSnapshot = await transaction.get(bookings().doc(bookingId));
    if (existingSnapshot.exists) {
      recordDataAccess({ app: "integration-hub", operation: "hospitality.ingest.transaction-reads", source: "FIRESTORE", dataset: "hospitality-ingest", documents: 1, estimatedBillableReads: 1, firestoreReadKind: "transaction" });
      return ingestMnkBookingFromExisting(existingSnapshot.data() as CanonicalBooking, payload, []);
    }
    const mappingIdentifiers = portalSourceIdentifiers(payload);
    if (!mappingIdentifiers.length) mappingIdentifiers.push("__missing__");
    const [menusSnapshot, mappingsSnapshot] = await Promise.all([
      transaction.get(canonical().where("entityType", "==", "Hospitality Menu Item").where("lifecycleStatus", "in", ["draft", "published", "archived"]).limit(501)),
      transaction.get(sourceMappings().where("sourceIdentifier", "in", mappingIdentifiers)),
    ]);
    if (menusSnapshot.size > 500) throw conflict("Hospitality catalogue exceeds the bounded ingestion limit.");
    const canonicalRecords = menusSnapshot.docs.map((document) => document.data() as CanonicalRecord);
    const mappings = mappingsSnapshot.docs.map(document => document.data() as Record<string, unknown>);
    const destinationId = resolveHospitalityDestinationId(payload, mappings);
    if (isRcoa && destinationId !== expectedRcoaOplocId)
      assertExpectedRcoaOploc(expectedRcoaOplocId, destinationId);
    const destinationSnapshot = destinationId ? await transaction.get(canonical().doc(stableDocumentId(destinationId))) : undefined;
    const destinationOplocId = destinationSnapshot?.exists ? resolveHospitalityDestinationOploc(payload, mappings, [...canonicalRecords, destinationSnapshot.data() as CanonicalRecord]) : undefined;
    recordDataAccess({ app: "integration-hub", operation: "hospitality.ingest.transaction-reads", source: "FIRESTORE", dataset: "hospitality-ingest", documents: menusSnapshot.size + mappingsSnapshot.size + (destinationSnapshot?.exists ? 1 : 0), estimatedBillableReads: menusSnapshot.size + mappingsSnapshot.size + (destinationSnapshot?.exists ? 1 : 0), firestoreReadKind: "transaction" });
    if (isRcoa) assertExpectedRcoaOploc(expectedRcoaOplocId, destinationId, destinationOplocId);
    if (!destinationOplocId) throw conflict(portalSiteId === "rcoa"
      ? "RCoA has no confirmed canonical destination OPLOC. Configure the governed source mapping for rcoa before submission."
      : "This delivery-requiring Hospitality Booking has no confirmed canonical destination OPLOC; resolve the governed site mapping before submission.");
    let pricingRecords = canonicalRecords;
    if (portalSiteId === "mnk") {
      const catalogue = await loadMnkBookingCatalogue(canonicalRecords, payload, destinationOplocId, async (field, ids) => {
        const snapshot = await transaction.get(canonical().where(field, "in", ids).limit(501));
        if (snapshot.size > 500) throw conflict("MNK catalogue relations exceed the bounded ingestion limit.");
        recordDataAccess({ app: "integration-hub", operation: "hospitality.ingest.catalogue-relations", source: "FIRESTORE", dataset: "hospitality-ingest", documents: snapshot.size, estimatedBillableReads: snapshot.size, firestoreReadKind: "transaction" });
        return snapshot.docs.map(document => document.data() as CanonicalRecord);
      });
      pricingRecords = mnkBookingPricingRecords(catalogue, { oplocId: destinationOplocId, serviceDate: hospitalityMenuDate(new Date(now)) });
    } else if (portalSiteId === "angel-court") {
      const catalogue = await loadAngelCourtBookingCatalogue(canonicalRecords, payload, destinationOplocId, async (field, ids) => {
        const snapshot = await transaction.get(canonical().where(field, "in", ids).limit(501));
        if (snapshot.size > 500) throw conflict("Angel Court catalogue relations exceed the bounded ingestion limit.");
        recordDataAccess({ app: "integration-hub", operation: "hospitality.ingest.catalogue-relations", source: "FIRESTORE", dataset: "hospitality-ingest", documents: snapshot.size, estimatedBillableReads: snapshot.size, firestoreReadKind: "transaction" });
        return snapshot.docs.map(document => document.data() as CanonicalRecord);
      });
      pricingRecords = catalogue;
    } else if (isRcoa && payload.order.items.some(item => String(item.itemId).startsWith("hospitality-menu-item:"))) {
      // The RCoA portal offers governed Items; relations are read only when governed IDs are submitted (legacy source IDs keep the established path).
      pricingRecords = await loadRcoaBookingCatalogue(canonicalRecords, payload, destinationOplocId, async (field, ids) => {
        const snapshot = await transaction.get(canonical().where(field, "in", ids).limit(501));
        if (snapshot.size > 500) throw conflict("RCoA catalogue relations exceed the bounded ingestion limit.");
        recordDataAccess({ app: "integration-hub", operation: "hospitality.ingest.catalogue-relations", source: "FIRESTORE", dataset: "hospitality-ingest", documents: snapshot.size, estimatedBillableReads: snapshot.size, firestoreReadKind: "transaction" });
        return snapshot.docs.map(document => document.data() as CanonicalRecord);
      });
    }
    // Old short-hour defaults must not override the noon policy for opaque canonical sandwich IDs.
    // Annotate only requested short-notice candidates from authoritative routing, never from client policy flags.
    const shortNoticeItems = pricingRecords.filter(record => {
      const hours = (record.record.configuration as { rules?: { noticeHours?: number } } | undefined)?.rules?.noticeHours;
      return record.entityType === "Hospitality Menu Item" && hours !== undefined && hours > 0 && hours <= 72 && payload.order.items.some(line => line.itemId === record.canonicalId || (Array.isArray(record.record.providerMappings) && record.record.providerMappings.some(raw => (raw as { sourceItemId?: string }).sourceItemId === line.itemId)));
    });
    if (shortNoticeItems.length) {
      const routing = await explicitMenuProductionRouting(shortNoticeItems.map(record => record.canonicalId), transaction);
      pricingRecords = pricingRecords.map(record => shortNoticeItems.includes(record) ? { ...record, record: { ...record.record, bookingPolicy: bookingPolicyFor(record.canonicalId, routing[record.canonicalId]?.includes("sandwiches") ? "sandwiches" : undefined, Array.isArray(record.record.providerMappings) ? record.record.providerMappings.flatMap(raw => typeof (raw as { sourceItemId?: unknown })?.sourceItemId === "string" ? [(raw as { sourceItemId: string }).sourceItemId] : []) : []) } } : record);
    }
    const result = ingestMnkBookingFromExisting(
      existingSnapshot.exists
        ? (existingSnapshot.data() as CanonicalBooking)
        : undefined,
      payload,
      pricingRecords,
      now,
      destinationOplocId,
    );
    if (!result.created) return result;
    await assertHospitalityBookingDate(transaction, result.booking, now, canonicalRecords);
    // Grouped services are ingested one by one: the customer gets ONE request-received email, created in the same
    // transaction that commits the last service. Single-service bookings keep their per-booking notification.
    const groupLink = result.booking.bookingGroup;
    let groupSubmitted: BookingNotificationRecord | undefined;
    if (groupLink && groupLink.size > 1) {
      const siblings = await transaction.get(bookings().where("bookingGroup.id", "==", groupLink.id).limit(MAX_GROUP_SERVICES + 1));
      try { groupSubmitted = groupSubmittedNotification(result.booking, siblings.docs.map(document => document.data() as CanonicalBooking)); }
      catch (error) { console.error("hospitality.group-email.submitted-skipped", { bookingGroupId: groupLink.id, message: error instanceof Error ? error.message : String(error) }); }
    }
    transaction.create(
      bookings().doc(result.booking.canonicalId),
      result.booking,
    );
    transaction.create(
      bookingAudit().doc(
        `${result.booking.canonicalId.replace(/[^A-Za-z0-9_-]/g, "_")}:1`,
      ),
      {
        canonicalId: result.booking.canonicalId,
        action: "booking-ingested",
        at: result.booking.createdAt,
        source: result.booking.source.provider,
        status: result.booking.lifecycleStatus,
      },
    );
    if (!groupLink || groupLink.size <= 1) {
      transaction.create(
        db
          .collection("fikaBookingNotifications")
          .doc(
            bookingNotificationRecord(
              result.booking,
              "submitted",
              result.booking.version,
              result.booking.createdAt,
            ).notificationId,
          ),
        bookingNotificationRecord(
          result.booking,
          "submitted",
          result.booking.version,
          result.booking.createdAt,
        ),
      );
    } else if (groupSubmitted) {
      transaction.create(db.collection("fikaBookingNotifications").doc(groupSubmitted.notificationId), groupSubmitted);
    }
    return result;
  });
  return result;
}

/**
 * Dispatch the confirmation for a production order's source Booking. This is
 * intentionally idempotent: approval may already have queued/sent the same
 * confirmation before CPU accepts the order.
 */
export async function notifyBookingConfirmedForProductionOrder(
  sourceBookingId: string,
) {
  if (!sourceBookingId.startsWith("booking:"))
    return {
      status: "skipped" as const,
      reason: "The order has no canonical Booking source.",
    };
  const snapshot = await bookings().doc(sourceBookingId).get();
  recordDataAccess({ app: "integration-hub", operation: "hospitality.booking.confirmation-source", source: "FIRESTORE", dataset: "fikaBookings", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "document" });
  if (!snapshot.exists)
    return {
      status: "skipped" as const,
      reason: "The source Booking was not found.",
    };
  return dispatchBookingNotification(
    snapshot.data() as CanonicalBooking,
    "confirmed",
    (snapshot.data() as CanonicalBooking).version,
  );
}

export async function getDashboardQuoteSettings(
  dashboardId = "mnk-hospitality",
) {
  const snapshot = await dashboardQuoteSettings()
    .doc(stableDocumentId(dashboardId))
    .get();
  recordDataAccess({ app: "integration-hub", operation: "hospitality.quote-settings.by-dashboard", source: "FIRESTORE", dataset: "fikaDashboardQuoteSettings", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "document" });
  const settings = snapshot.exists
    ? (snapshot.data() as DashboardQuoteSettings)
    : defaultDashboardQuoteSettings(dashboardId);
  return {
    ...settings,
    labourRates: settings.labourRates ?? defaultDashboardQuoteSettings(dashboardId).labourRates,
  };
}

function dashboardIdForSite(siteId?: string) {
  return siteId === "angel-court"
    ? "angel-court-hospitality"
    : siteId
      ? `${siteId}-hospitality`
      : "mnk-hospitality";
}

async function getQuoteSettingsInTransaction(
  transaction: FirebaseFirestore.Transaction,
  dashboardId: string,
) {
  const snapshot = await transaction.get(
    dashboardQuoteSettings().doc(stableDocumentId(dashboardId)),
  );
  recordDataAccess({ app: "integration-hub", operation: "hospitality.quote-settings.transaction-read", source: "FIRESTORE", dataset: "fikaDashboardQuoteSettings", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "transaction" });
  const settings = snapshot.exists
    ? (snapshot.data() as DashboardQuoteSettings)
    : defaultDashboardQuoteSettings(dashboardId);
  return {
    ...settings,
    labourRates: settings.labourRates ?? defaultDashboardQuoteSettings(dashboardId).labourRates,
  };
}

export async function saveDashboardQuoteSettings(
  actor: Actor,
  input: Omit<DashboardQuoteSettings, "version" | "updatedAt" | "updatedBy">,
) {
  return db.runTransaction(async (transaction) => {
    const ref = dashboardQuoteSettings().doc(
      stableDocumentId(input.dashboardId),
    );
    const current = await transaction.get(ref);
    recordDataAccess({ app: "integration-hub", operation: "hospitality.quote-settings.transaction-read", source: "FIRESTORE", dataset: "fikaDashboardQuoteSettings", documents: current.exists ? 1 : 0, firestoreReadKind: "transaction" });
    const existing = current.exists
      ? (current.data() as DashboardQuoteSettings)
      : defaultDashboardQuoteSettings(input.dashboardId);
    if (
      input.managementFee.value < 0 ||
      input.deliveryCharge.amount < 0 ||
      input.vatRate < 0 ||
      input.vatRate > 1
    )
      throw conflict(
        "Quote settings must contain valid non-negative charges and a VAT rate between 0 and 1.",
      );
    const labourRates = validateLabourRates(
      input.labourRates ?? existing.labourRates ?? defaultDashboardQuoteSettings(input.dashboardId).labourRates ?? [],
    );
    const next: DashboardQuoteSettings = {
      ...input,
      labourRates,
      version: existing.version + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.uid,
    };
    transaction.set(ref, next);
    return next;
  });
}

const WORKSPACE_BOOKING_LIMIT = 200;
const WORKSPACE_FUTURE_DAYS = 366;
const WORKSPACE_ARCHIVE_LOOKBACK_DAYS = 365;
const FIRESTORE_IN_LIMIT = 30;
type ProductionProjectionChange = { order: ProductionOrderV1; changeType: "created" | "amended" | "withdrawn"; idempotencyKey: string };

export async function prepareHospitalityProductionChanges(transaction: Transaction, changes: ProductionProjectionChange[], actorId: string, bookingId: string, occurredAt: string, reason: string) {
  const events = changes.map(change => createDomainEvent({ eventType: change.changeType === "withdrawn" ? "production.order.cancelled" : "production.order.amended", sourceAggregateId: change.order.canonicalId, sourceVersion: change.order.version, occurredAt, correlationId: bookingId, causationId: change.idempotencyKey, payload: { productionOrder: change.order, actorId, reason } }));
  const prepared = await Promise.all(events.map(event => prepareFulfilmentEvent(transaction, event)));
  return () => {
    for (let index = 0; index < events.length; index += 1) {
      const result = prepared[index]();
      if ("error" in result && result.error) throw new Error(result.error);
      stageDomainEvent(transaction, events[index]);
    }
  };
}

/** Reconcile every Hub Production Order for an already-cancelled booking. */
async function reconcileCancelledBookingOrders(bookingId: string) {
  return db.runTransaction(async transaction => {
    const bookingRef = bookings().doc(bookingId);
    const bookingSnapshot = await transaction.get(bookingRef);
    if (!bookingSnapshot.exists || (bookingSnapshot.data() as CanonicalBooking).lifecycleStatus !== "Cancelled") throw new Error("Authoritative cancelled Booking state is unavailable.");
    const [orderSnapshot, requirementSnapshot] = await Promise.all([
      transaction.get(productionOrderV1s().where("sourceBookingId", "==", bookingId)),
      transaction.get(db.collection("fikaProductionRequirements").where("sourceBookingId", "==", bookingId)),
    ]);
    const orders = orderSnapshot.docs.map(document => ({ ref: document.ref, order: document.data() as ProductionOrderV1 }));
    const active = orders.filter(({ order }) => !["cancelled", "amended"].includes(order.status));
    const safeToWithdraw = active.filter(({ order }) => !hospitalityCancellationRequiresCpuReview([order.status]));
    const requiresCpuReview = active.some(({ order }) => hospitalityCancellationRequiresCpuReview([order.status]));
    const now = new Date().toISOString();
    const reason = (bookingSnapshot.data() as CanonicalBooking).dashboardWorkflow?.cancellation?.reason || "Legacy Hospitality cancellation reconciliation";
    const changes: ProductionProjectionChange[] = safeToWithdraw.map(({ order }) => ({
      order: { ...order, status: "cancelled", workflowStatus: "cancelled", version: Number(order.version || 1) + 1, updatedAt: now },
      changeType: "withdrawn",
      idempotencyKey: `hospitality-withdrawal:${order.canonicalId}:v${Number(order.version || 1) + 1}`,
    }));
    const stageChanges = await prepareHospitalityProductionChanges(transaction, changes, "integration-hub", bookingId, now, reason);
    stageChanges();
    for (const change of changes) stageHospitalityCancellation(transaction, bookingId, change.order, now);
    for (const { ref, order } of safeToWithdraw) transaction.set(ref, {
      status: "cancelled", workflowStatus: "cancelled", updatedAt: now,
      cancellationNotice: `Booking cancelled: ${reason}`, version: Number(order.version || 1) + 1,
      cancelledAt: now, cancelledBy: "integration-hub",
      audit: [...(order.audit || []), { action: "production-order-cancelled-by-legacy-booking-reconciliation", at: now, by: "integration-hub", previousState: order.status, newState: "cancelled", reason }],
    }, { merge: true });
    for (const requirementDoc of requiresCpuReview ? [] : requirementSnapshot.docs) {
      const requirement = requirementDoc.data() as { status?: string; audit?: unknown[] };
      if (requirement.status === "cancelled") continue;
      transaction.set(requirementDoc.ref, { status: "cancelled", updatedAt: now, updatedBy: "integration-hub", audit: [...(requirement.audit || []), { action: "production-requirement-cancelled-by-legacy-booking-reconciliation", at: now, by: "integration-hub", previousState: requirement.status, newState: "cancelled", reason }] }, { merge: true });
    }
    const reconciledOrders = orders.map(({ order }) => safeToWithdraw.some(item => item.order.canonicalId === order.canonicalId) ? changes.find(change => change.order.canonicalId === order.canonicalId)!.order : order);
    return { orders: reconciledOrders, requiresCpuReview };
  });
}

function addCalendarDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function propagateProductionChanges(changes: ProductionProjectionChange[], cancellationEventIds: Map<string, string> = new Map()) {
  const results = [];
  for (const change of changes) {
    try {
      const cancellationEventId = cancellationEventIds.get(change.order.canonicalId);
      const [cpuProjection, logisticsProjection] = await Promise.all([cancellationEventId ? deliverHospitalityCancellation(cancellationEventId) : notifyCpuProjection(change.order, change.changeType, change.idempotencyKey), change.changeType === "created" ? Promise.resolve(undefined) : deliverLogisticsProjectionForProductionOrder(change.order)]);
      const cpuStatus = cancellationEventId && cpuProjection && "delivery" in cpuProjection ? cpuProjection.delivery.status : "delivered";
      const logisticsRequired = Boolean(cancellationEventId && change.order.requiresDelivery !== false && change.order.serviceDate && change.order.destinationOplocId);
      results.push({ canonicalId: change.order.canonicalId, ...(cancellationEventId ? { cpuOutbox: cpuProjection } : cpuProjection), ...(logisticsProjection ? { logisticsProjection } : {}), status: cpuStatus !== "delivered" || logisticsRequired && logisticsProjection?.outboxStatus !== "delivered" || logisticsProjection && logisticsProjection.outboxStatus !== "delivered" ? "pending" as const : "delivered" as const });
    } catch (error) {
      results.push({ canonicalId: change.order.canonicalId, status: "pending" as const, reason: error instanceof Error ? error.message : "CPU projection handoff failed." });
    }
  }
  return { status: results.some((result) => result.status === "pending") ? "pending" as const : "delivered" as const, results };
}

async function productionOrdersForBookings(bookingIds: string[]) {
  const ids = [...new Set(bookingIds)];
  const modern = new Map<string, ProductionOrderV1[]>();
  for (let offset = 0; offset < ids.length; offset += FIRESTORE_IN_LIMIT) {
    const chunk = ids.slice(offset, offset + FIRESTORE_IN_LIMIT);
    const snapshot = await productionOrderV1s().where("sourceBookingId", "in", chunk).limit(WORKSPACE_BOOKING_LIMIT + 1).get();
    recordDataAccess({ app: "integration-hub", operation: "hospitality.production-orders.by-bookings", source: "FIRESTORE", dataset: "fikaProductionOrdersV1", documents: snapshot.size, estimatedBillableReads: snapshot.size, firestoreReadKind: "query" });
    for (const document of snapshot.docs) {
      const order = document.data() as ProductionOrderV1;
      const existing = modern.get(order.sourceBookingId) || [];
      existing.push(order);
      modern.set(order.sourceBookingId, existing);
    }
  }
  const legacySnapshots = ids.length ? await db.getAll(...ids.map((id) => productionOrders().doc(stableDocumentId(`production-order:${id}`)))) : [];
  if (ids.length) recordDataAccess({ app: "integration-hub", operation: "hospitality.production-orders.legacy-by-bookings", source: "FIRESTORE", dataset: "fikaProductionOrders", documents: legacySnapshots.filter(snapshot => snapshot.exists).length, estimatedBillableReads: legacySnapshots.length, firestoreReadKind: "document" });
  const latest = new Map<string, ProductionOrderV1>();
  for (const [bookingId, candidates] of modern) {
    const order = candidates.filter((candidate) => !candidate.supersededBy && candidate.status !== "amended").sort((a, b) => (b.version - a.version) || b.createdAt.localeCompare(a.createdAt))[0];
    if (order) latest.set(bookingId, order);
  }
  legacySnapshots.forEach((snapshot, index) => {
    const bookingId = ids[index];
    if (snapshot.exists && bookingId && !latest.has(bookingId)) latest.set(bookingId, snapshot.data() as ProductionOrderV1);
  });
  return latest;
}

export async function bookingWorkspace(siteId?: string, authorisedOplocId?: string, includeArchive = false) {
  const today = londonBusinessDate();
  if (siteId && authorisedOplocId) {
    const portalSourceIdentifiers = new Set([siteId.trim().toLowerCase(), siteId.trim().toLowerCase().replace(/-/g, " ")]);
    const mappingSnapshot = await sourceMappings().where("sourceIdentifier", "in", [...portalSourceIdentifiers]).get();
    recordDataAccess({ app: "integration-hub", operation: "hospitality-booking.authorisation-mapping", source: "FIRESTORE", dataset: "integrationHubSourceMappings", documents: mappingSnapshot.size, firestoreReadKind: "query" });
    const mapped = mappingSnapshot.docs.some(document => {
      const mapping = document.data() as Record<string, unknown>;
      return portalSourceIdentifiers.has(String(mapping.sourceIdentifier || "").trim().toLowerCase()) &&
        String(mapping.oplocId || mapping.targetCanonicalId || "").trim() === authorisedOplocId &&
        String(mapping.mappingStatus || "") === "confirmed" &&
        Boolean(String(mapping.sourceEntityType || ""));
    });
    if (!mapped) throw Object.assign(new Error("The requested Hospitality portal is not governed by the authorised OPLOC."), { status: 403 });
  }
  const fromDate = includeArchive ? addCalendarDays(today, -WORKSPACE_ARCHIVE_LOOKBACK_DAYS) : today;
  const toDate = addCalendarDays(today, WORKSPACE_FUTURE_DAYS);
  const snapshot = await bookings()
    .where("service.eventDate", ">=", fromDate)
    .where("service.eventDate", "<", toDate)
    .orderBy("service.eventDate", "asc")
    .limit(WORKSPACE_BOOKING_LIMIT + 1)
    .get();
  recordDataAccess({ app: "integration-hub", operation: "hospitality.workspace.bookings", source: "FIRESTORE", dataset: "fikaBookings", documents: snapshot.size, estimatedBillableReads: snapshot.size, firestoreReadKind: "query" });
  const truncated = snapshot.size > WORKSPACE_BOOKING_LIMIT;
  const storedRows = snapshot.docs
    .slice(0, WORKSPACE_BOOKING_LIMIT)
    .map((document) => document.data() as CanonicalBooking)
    .map((booking) => {
      // Preserve stored legacy Approved values as-is. Do not promote active
      // Quoted bookings into an approval-era state merely because a revision
      // exists; PDF persistence is now the operational readiness boundary.
      return booking;
    })
    .filter((booking) => includeArchive || booking.service.eventDate >= today)
    .filter((booking) => !siteId || (authorisedOplocId && booking.service.oplocId === authorisedOplocId) || (booking.service.portalSiteId === siteId && !booking.service.oplocId));
  // Development fixtures exercise the same canonical Booking contract as a
  // submitted portal booking, but are never written to Firestore.  Stored
  // records win on ID so a local fixture can never mask real emulator data.
    const includeLocalFixtures = process.env.NODE_ENV !== "production" &&
      process.env.FIKA_ENABLE_LOCAL_BOOKING_FIXTURES === "true";
    const rows = includeLocalFixtures
      ? [...storedRows, ...localBookingFixtures.filter((fixture) =>
          (includeArchive || fixture.service.eventDate >= today) &&
          (!siteId || (authorisedOplocId && fixture.service.oplocId === authorisedOplocId) || (fixture.service.portalSiteId === siteId && !fixture.service.oplocId)) &&
          !storedRows.some((stored) => stored.canonicalId === fixture.canonicalId),
        )].sort((a, b) => a.service.eventDate.localeCompare(b.service.eventDate))
      : storedRows;
  const ordersByBooking = await productionOrdersForBookings(rows.filter((booking) => booking.deliveryChargeRequired !== false).map((booking) => booking.canonicalId));
  const orders = rows.map((booking) => {
      const modern = booking.deliveryChargeRequired === false
        ? undefined
        : ordersByBooking.get(booking.canonicalId);
      if (modern) {
        const state: ProductionOrder["state"] =
          modern.status === "cancelled"
            ? "Cancelled"
            : [
                  "needs_review",
                  "blocked",
                  "failed",
                  "reconciliation_required",
                ].includes(modern.status)
              ? "Uncertain"
              : modern.status === "planned" || modern.status === "menu_available"
                ? "Planned"
              : "Requested";
        return [
          booking.canonicalId,
          {
            canonicalId: modern.canonicalId,
            bookingId: modern.sourceBookingId,
            version: modern.version,
            state,
            updatedAt: modern.updatedAt,
            createdAt: modern.createdAt,
            createdBy: modern.createdBy,
            attempts: [
              {
                at: modern.createdAt,
                by: modern.createdBy,
                outcome: "created",
                reason: "Governed Production Order hand-off.",
              },
            ],
            sourceReferences: {
              bookingId: modern.sourceBookingId,
              quoteRevisionId: modern.sourceQuoteRevisionId,
              bookingJsonReference: modern.sourceBookingId,
              sourceBookingReference: booking.source.sourceBookingId,
            },
          } satisfies ProductionOrder,
        ] as const;
      }
      return [booking.canonicalId, undefined] as const;
    });
  // Every Hospitality platform shows the same per-line / booking-level CPU state, derived from the platform's own governed Production visibility records
  // (never from deliveryChargeRequired). Platforms not yet governed fall back to the legacy map for display only (`enforced: false`). Direct reads by id, de-duplicated.
  const routed = rows.flatMap((booking) => { const platform = hospitalityPlatformOf(booking); return platform ? [{ booking, platform }] : []; });
  const explicitRouting = routed.length ? await explicitMenuProductionRouting(routed.flatMap(({ booking, platform }) => booking.order.items.flatMap((item) => routingKeys(item, platform)))) : {};
  const cpuRouting = Object.fromEntries(routed.map(({ booking, platform }) => {
    const enforced = isGovernedRoutingPlatform(platform);
    const plan = planHospitalityCpuRouting(booking.order.items, platform, explicitRouting, enforced ? undefined : LEGACY_HOSPITALITY_MENU_ROUTING);
    return [booking.canonicalId, { status: plan.status, statusLabel: BOOKING_LABELS[plan.status], platform, enforced, lines: plan.lines.map((line) => ({ index: line.index, state: line.state, label: LINE_LABELS[line.state], source: line.source })) }];
  }));
  return {
    bookings: rows,
    ...await hospitalityGroupProjection(rows, cpuRouting, Object.fromEntries(rows.flatMap(booking => {
      const order = ordersByBooking.get(booking.canonicalId);
      if (!order) return [];
      const quote = booking.quoteState?.revisions.find(q => q.id === booking.quoteState?.currentRevisionId);
      return [[booking.canonicalId, { orderId: order.canonicalId, version: order.version, sourceRevision: order.currentRevision || order.sourceVersion || order.version, status: order.status, quoteRevisionId: order.sourceQuoteRevisionId, quoteCurrent: Boolean(quote && !quote.stale && quote.commercialVersion === (booking.commercialVersion || 1) && (quote.id === order.sourceQuoteRevisionId || booking.quoteState?.revisions.some(previous => previous.id === order.sourceQuoteRevisionId && (booking.lifecycleStatus === "Completed" || previous.commercialVersion === (booking.commercialVersion || 1))))) }]];
    }))),
    ...(routed.length ? { cpuRouting } : {}),
    productionOrders: Object.fromEntries(orders),
    quoteSettings: await getDashboardQuoteSettings(dashboardIdForSite(siteId)),
    ...(truncated ? { truncated: true } : {}),
  };
}

/** Prepare all affected reads before applying writes; shared by single and atomic group amendments. */
async function prepareBookingAmendment(transaction: Transaction, actor: Actor, canonicalId: string, current: CanonicalBooking, next: CanonicalBooking, command: Extract<WorkflowCommand, { action: "amend" }>, now: string, projectionChanges: ProductionProjectionChange[], grouped = false) {
  const patch = command.patch;
  const items = patch.order.items
    .filter((item) => item.quantity > 0)
    .map((item) => ({
      ...structuredClone(item),
      lineTotal:
        Math.round(
          (item.unitPrice * item.quantity + Number.EPSILON) * 100,
        ) / 100,
    }));
  if (!items.length && current.order.items.length > 0)
    throw conflict("Keep at least one menu line on the Booking.");
  const ricePaperLine = items.find((item) => /rice paper rolls?/i.test(String(item.itemName || "")) && item.quantity < 3);
  if (ricePaperLine) throw conflict("Rice paper rolls require a minimum quantity of 3 boxes.");
  next.client = structuredClone(patch.client);
  next.service = { ...next.service, ...structuredClone(patch.service) };
  if (
    next.service.portalSiteId === "angel-court" &&
    next.service.guestCount >= 100 &&
    !next.service.endTime
  )
    throw conflict(
      "An end time is required for Angel Court bookings of 100 guests or more.",
    );
  next.order = {
    ...next.order,
    ...(patch.order.eventType ? { eventType: patch.order.eventType } : {}),
    items,
    netTotal: items.reduce((total, item) => total + item.lineTotal, 0),
    vatTotal: 0,
    grossTotal: items.reduce((total, item) => total + item.lineTotal, 0),
  };
  const cutoffChanged = current.order.eventType !== next.order.eventType ||
    (["eventDate", "startTime", "endTime", "guestCount", "oplocId", "floorLevel", "roomOrArea", "deliveryPoint"] as const).some(key => (current.service[key] ?? "") !== (next.service[key] ?? "")) ||
    groupHash(current.order.items.map(i => [i.itemId, i.quantity, i.choices])) !== groupHash(items.map(i => [i.itemId, i.quantity, i.choices]));
  if (cutoffChanged) await assertHospitalityBookingDate(transaction, next, now);
  next.notes = optional(patch.notes);
  next.deliveryChargeRequired = patch.deliveryChargeRequired ?? current.deliveryChargeRequired ?? true;
  next.commercialVersion = (current.commercialVersion || 1) + 1;
  next.quoteState = {
    ...next.quoteState!,
    revisions: next.quoteState!.revisions.map((item) => ({
      ...item,
      stale: true,
    })),
  };
  // The existing hand-off is a snapshot of the previous Booking and must
  // never be reused after an amendment. Retain it for audit/history, but
  // move it to an explicit amended state so the next approved quote gets
  // a replacement Production Order.
  const priorOrderQuery = productionOrderV1s().where("sourceBookingId", "==", canonicalId);
  const priorOrders = await transaction.get(grouped ? priorOrderQuery.limit(51) : priorOrderQuery);
  const priorRequirementQuery = db.collection("fikaProductionRequirements").where("sourceBookingId", "==", canonicalId);
  const priorRequirements = await transaction.get(grouped ? priorRequirementQuery.limit(51) : priorRequirementQuery);
  if (grouped && (priorOrders.size > 50 || priorRequirements.size > 50)) throw conflict("Booking history exceeds the safe amendment limit; reconciliation is required.");
  const retiringOrders = priorOrders.docs.filter(prior => !["cancelled", "amended"].includes((prior.data() as ProductionOrderV1).status));
  if (grouped && (retiringOrders.length > 3 || priorRequirements.docs.filter(d => d.data().status !== "cancelled").length > 3)) throw conflict("Multiple active handoffs require reconciliation before amendment.");
  for (const prior of retiringOrders) {
    const order = prior.data() as ProductionOrderV1;
    projectionChanges.push({ order: { ...order, status: "amended", workflowStatus: "amended", version: Number(order.version || 1) + 1, updatedAt: now }, changeType: "amended", idempotencyKey: `hospitality-projection:${canonicalId}:amended:v${next.version}` });
  }
  const stageChanges = await prepareHospitalityProductionChanges(transaction, projectionChanges, actor.uid, canonicalId, now, command.reason);
  next.dietaries = command.patch.dietaries ? structuredClone(command.patch.dietaries) : current.dietaries;
  next.lifecycleStatus = "Reviewed";
  return () => {
    stageChanges();
    for (const prior of retiringOrders) {
      const order = prior.data() as ProductionOrderV1;
      transaction.set(
        prior.ref,
        {
          status: "amended",
          workflowStatus: "amended",
          updatedAt: now,
          version: Number(order.version || 1) + 1,
          amendedAt: now,
          amendedBy: actor.uid,
          audit: [
            ...(order.audit || []),
            {
              action: "production-order-amended",
              at: now,
              by: actor.uid,
              previousState: order.status,
              newState: "amended",
              reason: command.reason,
            },
          ],
        },
        { merge: true },
      );
    }
    for (const prior of priorRequirements.docs) {
      const requirement = prior.data() as { status?: string; audit?: unknown[] };
      if (requirement.status === "cancelled") continue;
      transaction.set(
        prior.ref,
        {
          status: "cancelled",
          updatedAt: now,
          updatedBy: actor.uid,
          audit: [
            ...(requirement.audit || []),
            {
              action: "production-requirement-cancelled-by-booking-amendment",
              at: now,
              by: actor.uid,
              previousState: requirement.status,
              newState: "cancelled",
              reason: command.reason,
            },
          ],
        },
        { merge: true },
      );
    }
  };
}

export async function executeBookingWorkflow(
  actor: Actor,
  canonicalId: string,
  expectedVersion: number,
  command: WorkflowCommand,
  cancellationEvent: CancellationEvent = "internal-reconciliation",
) {
  const result = await db.runTransaction(async (transaction) => {
    const ref = bookings().doc(canonicalId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw conflict("Booking was not found.");
    const current = snapshot.data() as CanonicalBooking;
    // Retrying a cancellation after the Hub committed it is a safe no-op.
    if (command.action === "cancel" && current.lifecycleStatus === "Cancelled") {
      return { booking: current, notificationKind: undefined, projectionChanges: [], idempotent: true as const };
    }
    assertBookingExpectedVersion(current.version, expectedVersion, command.action);
    if (current.bookingGroup?.id && ["amend", "cancel"].includes(command.action)) throw conflict("Amend this booking from its grouped booking action.");
    if (current.bookingGroup?.id && command.action === "quote") throw conflict("Generate the consolidated quote from the booking group.");
    if (command.action === "quote-pdf-status" && current.quoteState?.revisions.find(q => q.id === command.revisionId)?.groupQuoteId) throw conflict("Group quote artifacts are owned by the group quote workflow.");
    assertWorkflowCommand(current, command);
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    const next: CanonicalBooking = {
      ...current,
      version: nextVersion,
      updatedAt: now,
      updatedBy: actor.uid,
      commercialVersion: current.commercialVersion || 1,
      quoteState: current.quoteState || { revisions: [] },
      dashboardWorkflow: current.dashboardWorkflow || {},
    };
    const projectionChanges: ProductionProjectionChange[] = [];
    if (command.action === "review") {
      next.lifecycleStatus = "Reviewed";
      next.dashboardWorkflow = {
        ...next.dashboardWorkflow,
        review: {
          checks: {
            commercialIntent: command.checks.commercialIntent ?? true,
            serviceTiming: command.checks.serviceTiming ?? true,
            deliveryContext: command.checks.deliveryContext ?? true,
            dietaryRequirements: command.checks.dietaryRequirements ?? true,
          },
          reviewedAt: now,
          reviewedBy: actor.uid,
          ...(optional(command.notes)
            ? { notes: optional(command.notes) }
            : {}),
        },
      };
    }
    if (command.action === "amend") {
      const stage = await prepareBookingAmendment(transaction, actor, canonicalId, current, next, command, now, projectionChanges);
      stage();
    }
    if (command.action === "set-additional-charges") {
      const settings = await getQuoteSettingsInTransaction(
        transaction,
        dashboardIdForSite(next.service.portalSiteId),
      );
      const normalizedCharges = normalizeBookingAdditionalCharges(
        command.charges,
        current.additionalCharges || [],
        settings.labourRates ?? defaultDashboardQuoteSettings(settings.dashboardId).labourRates ?? [],
        actor.uid,
        now,
      );
      Object.assign(next, applyBookingAdditionalCharges(current, normalizedCharges));
    }
    if (command.action === "quote") {
      const revisions = next.quoteState!.revisions;
      const revision = revisions.length + 1;
      const id = `quote:${canonicalId}:r${revision}`;
      const settings = await getQuoteSettingsInTransaction(
        transaction,
        dashboardIdForSite(next.service.portalSiteId),
      );
      const snapshotData = calculateQuoteSnapshot(
        {
          canonicalId: current.canonicalId,
          client: next.client,
          service: next.service,
          order: next.order,
          dietaries: next.dietaries,
          notes: next.notes,
          deliveryChargeRequired: next.deliveryChargeRequired !== false,
          additionalCharges: next.additionalCharges || [],
        },
        settings,
      );
      const quote: QuoteRevision = {
        id,
        revision,
        createdAt: now,
        createdBy: actor.uid,
        commercialVersion: next.commercialVersion!,
        snapshot: snapshotData,
        documentReference: id,
        stale: false,
        pdfStatus: "pending",
      };
      next.order = {
        ...next.order,
        netTotal: snapshotData.totals.net.amount,
        vatTotal: snapshotData.totals.vat.amount,
        grossTotal: snapshotData.totals.gross.amount,
      };
      next.quoteState = {
        currentRevisionId: id,
        revisions: [
          ...revisions.map((item) => ({ ...item, stale: true })),
          quote,
        ],
      };
      // A quote is not ready for CPU hand-off until its PDF has been persisted.
      // Keep the active workflow in Quoted; Approved remains a legacy read value.
      next.lifecycleStatus = current.lifecycleStatus === "Completed" ? "Completed" : "Quoted";
    }
    if (command.action === "quote-pdf-status") {
      next.quoteState = {
        ...next.quoteState!,
        revisions: applyQuotePdfPersistence(next.quoteState!.revisions, next.quoteState!.currentRevisionId, command.revisionId, command.status, command.driveFileId, command.driveUrl, command.error),
      };
    }
    let notificationKind: BookingNotificationKind | undefined;
    if (command.action === "amend") notificationKind = "amended";
    if (command.action === "approve") {
      next.lifecycleStatus = "Approved";
      notificationKind = "confirmed";
    }
    if (command.action === "complete") {
      next.lifecycleStatus = "Completed";
      next.dashboardWorkflow = {
        ...next.dashboardWorkflow,
        completion: {
          completedAt: now,
          completedBy: actor.uid,
          ...(optional(command.notes)
            ? { notes: optional(command.notes) }
            : {}),
        },
      };
    }
    if (command.action === "cancel") {
      next.lifecycleStatus = "Cancelled";
      // CPU owns progress after handoff. Always cancel the Booking; when any
      // order has advanced, preserve all downstream work and flag CPU review.
      const priorOrders = await transaction.get(productionOrderV1s().where("sourceBookingId", "==", canonicalId));
      const priorRequirements = await transaction.get(db.collection("fikaProductionRequirements").where("sourceBookingId", "==", canonicalId));
      const activeOrders = priorOrders.docs.filter((prior) => {
        const order = prior.data() as ProductionOrderV1;
        return !["cancelled", "amended"].includes(order.status);
      });
      const requiresCpuReview = hospitalityCancellationRequiresCpuReview(activeOrders.map(prior => (prior.data() as ProductionOrderV1).status));
      if (!requiresCpuReview) {
        for (const prior of activeOrders) {
          const order = prior.data() as ProductionOrderV1;
          projectionChanges.push({ order: { ...order, status: "cancelled", workflowStatus: "cancelled", version: Number(order.version || 1) + 1, updatedAt: now }, changeType: "withdrawn", idempotencyKey: `hospitality-projection:${canonicalId}:cancelled:v${next.version}` });
        }
        const stageChanges = await prepareHospitalityProductionChanges(transaction, projectionChanges, actor.uid, canonicalId, now, command.reason);
        stageChanges();
        for (const change of projectionChanges) stageHospitalityCancellation(transaction, canonicalId, change.order, now);
        for (const prior of activeOrders) {
          const order = prior.data() as ProductionOrderV1;
          transaction.set(prior.ref, { status: "cancelled", workflowStatus: "cancelled", updatedAt: now, cancellationNotice: `Booking cancelled: ${command.reason}`, version: Number(order.version || 1) + 1, cancelledAt: now, cancelledBy: actor.uid, audit: [...(order.audit || []), { action: "production-order-cancelled-by-booking", at: now, by: actor.uid, previousState: order.status, newState: "cancelled", reason: command.reason }] }, { merge: true });
        }
        for (const prior of priorRequirements.docs) {
          const requirement = prior.data() as { status?: string; audit?: unknown[] };
          if (requirement.status === "cancelled") continue;
          transaction.set(prior.ref, { status: "cancelled", updatedAt: now, updatedBy: actor.uid, audit: [...(requirement.audit || []), { action: "production-requirement-cancelled-by-booking", at: now, by: actor.uid, previousState: requirement.status, newState: "cancelled", reason: command.reason }] }, { merge: true });
        }
      }
      // A real customer cancellation queues once with the Booking transaction;
      // notify is a legacy UI option and cannot opt in/out of this server policy.
      notificationKind = cancellationNotificationKind(next, cancellationEvent);
      next.dashboardWorkflow = {
        ...next.dashboardWorkflow,
        cancellation: {
          reason: command.reason,
          calendarOutcome: command.removeCalendar
            ? "not_configured"
            : "not_requested",
          productionOutcome: requiresCpuReview ? "review_required" : activeOrders.length ? "cancel_requested" : "no_active_production_order",
          downstreamPropagation: requiresCpuReview ? "review_required" : activeOrders.length ? "pending" : "delivered",
          notificationOutcome: notificationKind ? "queued" : "not_requested",
        },
      };
    }
    const reason =
      command.action === "cancel" || command.action === "amend"
        ? command.reason
        : command.action === "quote-pdf-status"
          ? `${command.status === "saved" ? "Quote PDF saved to Drive" : "Quote PDF persistence failed"}${command.error ? `: ${command.error}` : ""}`
          : `${command.action} workflow command`;
    next.statusHistory = [
      ...current.statusHistory,
      {
        status: next.lifecycleStatus,
        changedAt: now,
        changedBy: actor.uid,
        reason,
      },
    ];
    next.audit = [
      ...current.audit,
      { action: `workflow-${command.action}`, at: now, by: actor.uid, reason },
    ];
    transaction.set(ref, next);
    transaction.set(
      bookingAudit().doc(
        `${canonicalId.replace(/[^A-Za-z0-9_-]/g, "_")}:${next.version}`,
      ),
      {
        canonicalId,
        action: `workflow-${command.action}`,
        at: now,
        actorId: actor.uid,
        command,
        ...(command.action === "cancel" ? { cancellationEvent } : {}),
      },
    );
    if (notificationKind) {
      const notification = bookingNotificationRecord(
        next,
        notificationKind,
        next.version,
        now,
      );
      transaction.create(
        db
          .collection("fikaBookingNotifications")
          .doc(notification.notificationId),
        notification,
      );
    }
    return { booking: next, notificationKind, projectionChanges, idempotent: false as const };
  });
  if (result.idempotent) {
    try {
    const reconciliation = await reconcileCancelledBookingOrders(canonicalId);
    const allOrders = reconciliation.orders;
    const cancelledOrders = allOrders.filter(order => order.status === "cancelled");
    const requirements = await Promise.all(cancelledOrders.map(order => db.collection("fikaFulfilmentRequirementsV1").where("sourceEntityId", "==", order.canonicalId).limit(20).get()));
    const unresolvedFulfilment = cancelledOrders.some((order, index) => order.requiresDelivery !== false && order.destinationOplocId && (!requirements[index].size || requirements[index].docs.some(document => document.data().status !== "withdrawn" && document.data().status !== "cancelled")));
    if (!cancelledOrders.length && result.booking.dashboardWorkflow?.cancellation?.productionOutcome !== "no_active_production_order" && !reconciliation.requiresCpuReview) {
      const unresolvedStatus = result.booking.dashboardWorkflow?.cancellation?.productionOutcome === "review_required" ? "review_required" as const : "pending" as const;
      const booking = await recordCancellationPropagation(result.booking, unresolvedStatus);
      return { booking, idempotent: true, projectionPropagation: { status: unresolvedStatus, results: [{ reason: unresolvedStatus === "review_required" ? "CPU review remains unresolved; no authoritative safe-to-withdraw order is available." : "Legacy cancellation downstream state is unresolved; no authoritative safe-to-withdraw production order was found." }] } };
    }
    if (!cancelledOrders.length && reconciliation.requiresCpuReview) {
      const booking = await recordCancellationPropagation(result.booking, "review_required");
      return { booking, idempotent: true, projectionPropagation: { status: "review_required" as const, results: [{ reason: "Advanced Production Order remains active and requires CPU review." }] } };
    }
    const events = await Promise.all(cancelledOrders.map(order => ensureHospitalityCancellationEvent(canonicalId, order)));
    const eventIds = new Map(cancelledOrders.map(order => [order.canonicalId, hospitalityCancellationEventId(order.canonicalId, order.version)]));
    const changes = cancelledOrders.map(order => ({ order, changeType: "withdrawn" as const, idempotencyKey: `hospitality-withdrawal:${order.canonicalId}:v${order.version}` }));
    const delivery = await propagateProductionChanges(changes, eventIds);
    const eventStatus = await cancellationDeliveryStatus(events.map(event => event.eventId));
    const status = reconciliation.requiresCpuReview ? "review_required" as const : delivery.status === "delivered" && eventStatus === "delivered" && !unresolvedFulfilment ? "delivered" as const : "pending" as const;
    const booking = await recordCancellationPropagation(result.booking, status);
    return { booking, idempotent: true, projectionPropagation: { ...delivery, status, ...(reconciliation.requiresCpuReview ? { results: [...delivery.results, { reason: "Advanced Production Order remains active and requires CPU review." }] } : {}), ...(unresolvedFulfilment ? { results: [...delivery.results, { reason: "Legacy Logistics withdrawal is unresolved; fulfilment evidence is missing or still active." }] } : {}) } };
    } catch {
      return { booking: result.booking, idempotent: true, projectionPropagation: { status: "pending" as const, results: [{ reason: "Legacy cancellation reconciliation failed; downstream state remains unresolved." }] } };
    }
  }
  const notification = result.notificationKind ? { status: "queued" as const } : undefined;
  const isCancellationReview = result.booking.dashboardWorkflow?.cancellation?.downstreamPropagation === "review_required";
  const projectionPropagation = isCancellationReview
    ? { status: "review_required" as const, results: [] }
    : await propagateProductionChanges(result.projectionChanges, command.action === "cancel"
      ? new Map(result.projectionChanges.map(change => [change.order.canonicalId, hospitalityCancellationEventId(change.order.canonicalId, change.order.version)]))
      : undefined);
  const booking = result.booking.lifecycleStatus === "Cancelled" && (projectionPropagation.status === "pending" || projectionPropagation.status === "delivered")
    ? await recordCancellationPropagation(result.booking, projectionPropagation.status)
    : result.booking;
  return { booking, ...(notification ? { notification } : {}), projectionPropagation };
}

async function recordCancellationPropagation(booking: CanonicalBooking, status: "pending" | "delivered" | "review_required") {
  return db.runTransaction(async transaction => {
    const ref = bookings().doc(booking.canonicalId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return booking;
    const current = snapshot.data() as CanonicalBooking;
    if (current.version !== booking.version || current.lifecycleStatus !== "Cancelled") return current;
    const cancellation = current.dashboardWorkflow?.cancellation;
    if (!cancellation) return current;
    const next: CanonicalBooking = {
      ...current,
      dashboardWorkflow: {
        ...current.dashboardWorkflow,
        cancellation: {
          ...cancellation,
          downstreamPropagation: status,
          ...(status === "delivered" && cancellation.productionOutcome === "cancel_requested" ? { productionOutcome: "cancelled" } : {}),
        },
      },
      audit: [...current.audit, { action: `booking-cancellation-downstream-${status}`, at: new Date().toISOString(), by: "integration-hub", reason: `CPU and Logistics cancellation propagation ${status}.` }],
    };
    transaction.set(ref, next);
    transaction.set(bookingAudit().doc(`${booking.canonicalId.replace(/[^A-Za-z0-9_-]/g, "_")}:cancel-propagation:v${booking.version}:${status}`), {
      canonicalId: booking.canonicalId,
      action: `booking-cancellation-downstream-${status}`,
      at: new Date().toISOString(),
      actorId: "integration-hub",
      sourceVersion: booking.version,
    });
    return next;
  });
}

export async function dispatchBookingNotification(
  booking: CanonicalBooking,
  kind: BookingNotificationKind,
  version: number,
) {
  return db.runTransaction(async transaction => {
    const source = await transaction.get(bookings().doc(booking.canonicalId));
    if (!source.exists) return { status: "skipped" as const, reason: "Booking missing." };
    const current = source.data() as CanonicalBooking;
    if (current.version !== version || (kind === "confirmed" && !["Sent to CPU", "Approved"].includes(current.lifecycleStatus)))
      return { status: "skipped" as const, reason: "Booking transition is no longer current." };
    const notification = bookingNotificationRecord(current, kind, version, current.updatedAt);
    const ref = db.collection("fikaBookingNotifications").doc(notification.notificationId);
    const existing = await transaction.get(ref);
    if (existing.exists) return { status: String(existing.data()?.status || "queued") as "queued" | "sent" | "failed" };
    if (kind === "confirmed") return { status: "skipped" as const, reason: "No confirmation obligation was recorded by this canonical transition." };
    transaction.create(ref, notification);
    return { status: "queued" as const };
  });
}
export async function createProductionOrder(
  actor: Actor,
  canonicalId: string,
  expectedVersion: number,
) {
  const result = await createProductionFromApprovedBooking(
    actor,
    canonicalId,
    `hospitality:${canonicalId}:v${expectedVersion}`,
  );
  if (result.status === "no_cpu_production_required" || !result.order) {
    // Explicit outcome, not an error: every item is produced in house, so CPU receives no Production Order.
    return {
      created: false as const,
      status: "no_cpu_production_required" as const,
      message: "No CPU production required: every item on this booking is produced in house. The Hospitality booking is unchanged.",
      inHouseLineCount: "inHouseLineCount" in result ? result.inHouseLineCount : 0,
      productionOrder: undefined,
    };
  }
  const order = result.order;
  const projectionPropagation = await propagateProductionChanges([{ order, changeType: "created", idempotencyKey: `cpu-projection:${order.canonicalId}:v${order.version}` }]);
  const logisticsProjection = await deliverLogisticsProjectionForProductionOrder(order);
  const state: ProductionOrder["state"] =
    order.status === "cancelled"
      ? "Cancelled"
      : [
            "needs_review",
            "blocked",
            "failed",
            "reconciliation_required",
          ].includes(order.status)
        ? "Uncertain"
        : order.status === "planned" || order.status === "menu_available"
          ? "Planned"
        : "Requested";
  return {
    created: result.created,
    projectionPropagation,
    logisticsProjectionPropagation: logisticsProjection?.delivery.status === "delivered" ? { status: "delivered" as const } : { status: "pending" as const },
    productionOrder: {
      canonicalId: order.canonicalId,
      bookingId: order.sourceBookingId,
      version: order.version,
      state,
      updatedAt: order.updatedAt,
      createdAt: order.createdAt,
      createdBy: order.createdBy,
      attempts: [
        {
          at: order.createdAt,
          by: order.createdBy,
          outcome: result.created ? "created" : "uncertain",
          reason: "Governed Production Order hand-off.",
        },
      ],
      sourceReferences: {
        bookingId: order.sourceBookingId,
        quoteRevisionId: order.sourceQuoteRevisionId,
        bookingJsonReference: order.sourceBookingId,
        sourceBookingReference: order.sourceBookingId,
      },
    } satisfies ProductionOrder,
  };
}

export async function transitionBooking(
  actor: Actor,
  canonicalId: string,
  expectedVersion: number,
  status: CanonicalBooking["lifecycleStatus"],
  reason: string,
) {
  return db.runTransaction(async (transaction) => {
    const ref = bookings().doc(canonicalId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw conflict("Booking was not found.");
    const current = snapshot.data() as CanonicalBooking;
    if (current.version !== expectedVersion)
      throw conflict("Booking changed elsewhere. Refresh and try again.");
    const now = new Date().toISOString();
    const next: CanonicalBooking = {
      ...current,
      version: current.version + 1,
      lifecycleStatus: status,
      updatedAt: now,
      updatedBy: actor.uid,
      statusHistory: [
        ...current.statusHistory,
        { status, changedAt: now, changedBy: actor.uid, reason },
      ],
      audit: [
        ...current.audit,
        {
          action: `status-${status.toLowerCase()}`,
          at: now,
          by: actor.uid,
          reason,
        },
      ],
    };
    transaction.set(ref, next);
    transaction.set(
      bookingAudit().doc(
        `${canonicalId.replace(/[^A-Za-z0-9_-]/g, "_")}:${next.version}`,
      ),
      {
        canonicalId,
        action: "booking-status-changed",
        at: now,
        actorId: actor.uid,
        status,
        reason,
      },
    );
    return next;
  });
}

function validatePayload(payload: MnkBookingPayload) {
  if (!payload.bookingId?.trim())
    throw conflict("MNK source booking ID is required.");
  if (!payload.submittedAt || Number.isNaN(Date.parse(payload.submittedAt)))
    throw conflict("MNK submission timestamp is required.");
  if (
    !payload.client?.name?.trim() ||
    !payload.client.companyName?.trim() ||
    !payload.client.email?.trim()
  )
    throw conflict("MNK booking client and contact details are required.");
  if (
    !payload.event?.eventDate ||
    !payload.event.startTime ||
    !Number.isFinite(payload.event.guestCount) ||
    payload.event.guestCount < 1
  )
    throw conflict("MNK service date, time and guest count are required.");
  const gallagher = isGallagherBooking({
    companyName: payload.client.clientCompany || payload.client.companyName,
    email: payload.client.email || payload.client.requester?.email,
  });
  if (gallagher && payload.event.guestCount < GALLAGHER_MINIMUM_GUESTS)
    throw conflict(`Gallagher bookings require at least ${GALLAGHER_MINIMUM_GUESTS} guests.`);
  if (gallagher && !payload.client.invoiceReference?.trim())
    throw conflict("Gallagher bookings require an Invoice / PO reference.");
  if (
    !Array.isArray(payload.order?.items) ||
    !Number.isFinite(payload.order.netTotal)
  )
    throw conflict("MNK booking order snapshot is invalid.");
  if (
    payload.siteId === "angel-court" &&
    payload.event.guestCount >= 100 &&
    !payload.event.endTime
  )
    throw conflict(
      "An end time is required for Angel Court bookings of 100 guests or more.",
    );
  payload.order.items.forEach((item) => {
    if (
      !item.itemId ||
      !Number.isFinite(item.quantity) ||
      item.quantity < 1 ||
      !Number.isFinite(item.unitPrice) ||
      !Number.isFinite(item.lineTotal)
    )
      throw conflict("MNK order line snapshot is invalid.");
  });
}
function providerForSite(siteId?: string) {
  switch (siteId) {
    case "rcoa":
      return "rcoa-hospitality-brochure";
    case "angel-court":
      return "angel-court-hospitality-brochure";
    case "cfc":
      return "cfc-hospitality-brochure";
    case "munich-re":
      return "munich-re-generic-brochure";
    default:
      return "mnk-booking-platform";
  }
}
function portalSiteKeyForPayload(payload: Pick<MnkBookingPayload, "siteId" | "site">) {
  const value = String(payload.siteId || "").trim().toLowerCase();
  if (["mnk", "angel-court", "cfc", "munich-re", "rcoa"].includes(value)) return value;
  const label = String(payload.site || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (label === "mnk" || label === "mnk international") return "mnk";
  if (label === "angel court" || label === "one angel court") return "angel-court";
  if (label === "cfc" || label === "cfc underwriting") return "cfc";
  if (label === "munich re") return "munich-re";
  if (label === "rcoa") return "rcoa";
  return undefined;
}
function londonBusinessDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function isPortalMapping(value: unknown, provider: string) {
  return Boolean(
    value &&
      typeof value === "object" &&
      String((value as Record<string, unknown>).provider || "") === provider &&
      String((value as Record<string, unknown>).sourceItemId || ""),
  );
}
function isMnkMapping(value: unknown) {
  return isPortalMapping(value, "mnk-booking-platform");
}
function optional(value: unknown) {
  const output = String(value || "").trim();
  return output || undefined;
}
function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}
function numberOrUndefined(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
function conflict(message: string) {
  return Object.assign(new Error(message), { status: 422 });
}

/** One booking-level command, one atomic commit. Existing child and handoff identities remain authoritative. */
export async function getHospitalityBookingGroup(id: string) {
  const snapshot = await bookings().where("bookingGroup.id", "==", id).limit(MAX_GROUP_SERVICES + 1).get();
  return validateBookingGroup(id, snapshot.docs.map(d => d.data() as CanonicalBooking));
}

export async function amendHospitalityBookingGroup(actor: Actor, input: GroupAmendmentCommand, authorize: (children: CanonicalBooking[]) => Promise<void>) {
  const command = groupAmendmentCommand.parse(input);
  const result = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(bookings().where("bookingGroup.id", "==", command.bookingGroupId).limit(MAX_GROUP_SERVICES + 1));
    const children = validateBookingGroup(command.bookingGroupId, snapshot.docs.map(d => d.data() as CanonicalBooking));
    await authorize(children);
    if (children.some(child => child.lifecycleStatus === "Cancelled")) throw conflict("Cancelled services cannot be reopened through a grouped amendment.");
    if (groupCommercialState(command.bookingGroupId, children).sourceHash !== command.expectedSourceHash) throw Object.assign(new Error("Booking changed elsewhere. Refresh before amending."), { status: 409 });
    if (command.services.length !== children.length || new Set(command.services.map(s => s.bookingId)).size !== children.length || command.services.some(s => !children.some(b => b.canonicalId === s.bookingId))) throw conflict("The amendment must include exactly the current booking services.");
    const now = new Date().toISOString();
    const prepared: Array<{ next: CanonicalBooking; stage: () => void; changes: ProductionProjectionChange[] }> = [];
    const nextChildren: CanonicalBooking[] = [];
    for (const child of children) {
      const service = command.services.find(s => s.bookingId === child.canonicalId)!;
      if (child.version !== service.expectedVersion) throw Object.assign(new Error("A service changed elsewhere. Refresh before amending."), { status: 409 });
      const patch = service.patch;
      const comparable = (b: CanonicalBooking) => groupHash({ client: b.client, service: Object.fromEntries(Object.keys(patch.service).map(key => [key, b.service[key as keyof typeof b.service] ?? ""])), order: { ...(b.order.eventType ? { eventType: b.order.eventType } : {}), items: b.order.items.map(item => Object.fromEntries(["itemId", "itemName", "category", "description", "servingInfo", "unitPrice", "quantity", "choices", "comments"].filter(key => item[key as keyof typeof item] !== undefined).map(key => [key, item[key as keyof typeof item]]))) }, notes: b.notes || "", dietaries: b.dietaries, deliveryChargeRequired: b.deliveryChargeRequired !== false });
      const proposed = { ...child, client: patch.client, service: { ...child.service, ...patch.service }, order: { ...child.order, ...patch.order }, notes: patch.notes || "", dietaries: patch.dietaries || child.dietaries, deliveryChargeRequired: patch.deliveryChargeRequired ?? child.deliveryChargeRequired };
      if (comparable(child) === comparable(proposed as CanonicalBooking)) { nextChildren.push(child); continue; }
      const action = { action: "amend" as const, reason: command.reason, patch };
      assertWorkflowCommand(child, action);
      const next: CanonicalBooking = structuredClone({ ...child, quoteState: child.quoteState || { revisions: [] }, version: child.version + 1, updatedAt: now, updatedBy: actor.uid });
      const changes: ProductionProjectionChange[] = [];
      const stage = await prepareBookingAmendment(transaction, actor, child.canonicalId, child, next, action, now, changes, true);
      const platform = hospitalityPlatformOf(next);
      if (platform && isGovernedRoutingPlatform(platform)) {
        const routes = await explicitMenuProductionRouting(next.order.items.flatMap(item => routingKeys(item, platform)), transaction);
        const plan = planHospitalityCpuRouting(next.order.items, platform, routes);
        if (["routing_required", "routing_conflict"].includes(plan.status)) throw conflict("Resolve production routing for all amended items before saving this booking.");
      }
      next.statusHistory = [...child.statusHistory, { status: next.lifecycleStatus, changedAt: now, changedBy: actor.uid, reason: command.reason }];
      next.audit = [...child.audit, { action: "workflow-amend", at: now, by: actor.uid, reason: command.reason }];
      prepared.push({ next, stage, changes }); nextChildren.push(next);
    }
    validateBookingGroup(command.bookingGroupId, nextChildren);
    // All authorization, membership, routing and downstream reads complete before the first write.
    for (const { next, stage } of prepared) {
      stage(); transaction.set(bookings().doc(next.canonicalId), next);
      transaction.create(bookingAudit().doc(`${next.canonicalId.replace(/[^A-Za-z0-9_-]/g, "_")}:${next.version}`), { canonicalId: next.canonicalId, bookingGroupId: command.bookingGroupId, action: "workflow-amend", actorId: actor.uid, at: now, reason: command.reason, version: next.version });
    }
    if (prepared.length) {
      const changed = prepared.map(item => item.next);
      const notification = groupNotificationRecord({ kind: "amended", children: nextChildren, affected: changed.map(child => child.canonicalId), previous: Object.fromEntries(changed.map(child => [child.canonicalId, children.find(existing => existing.canonicalId === child.canonicalId)!])), anchor: changed[0], eventKey: groupEventKey([command.bookingGroupId, changed.map(child => [child.canonicalId, child.version])]), createdAt: now });
      transaction.create(db.collection("fikaBookingNotifications").doc(notification.notificationId), notification);
    }
    if (prepared.length) transaction.create(bookingAudit().doc(`group-amend:${groupHash([command.bookingGroupId, command.expectedSourceHash, command.services.map(s => s.expectedVersion)])}`), { bookingGroupId: command.bookingGroupId, action: "group-amended", actorId: actor.uid, at: now, reason: command.reason, childBookingIds: nextChildren.map(b => b.canonicalId), changedBookingIds: prepared.map(p => p.next.canonicalId) });
    return { children: nextChildren, projectionChanges: prepared.flatMap(p => p.changes) };
  });
  const projectionPropagation = await propagateProductionChanges(result.projectionChanges);
  return { bookings: result.children, projectionPropagation };
}

export async function cancelHospitalityBookingGroup(actor: Actor, input: { bookingGroupId: string; expectedSourceHash: string; reason: string }, authorize: (children: CanonicalBooking[]) => Promise<void>, cancellationEvent: CancellationEvent = "internal-reconciliation") {
  const result = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(bookings().where("bookingGroup.id", "==", input.bookingGroupId).limit(MAX_GROUP_SERVICES + 1));
    const children = validateBookingGroup(input.bookingGroupId, snapshot.docs.map(document => document.data() as CanonicalBooking));
    await authorize(children);
    if (children.every(child => child.lifecycleStatus === "Cancelled")) return { children, plans: [], idempotent: true as const, requiresCpuReview: children.some(child => child.dashboardWorkflow?.cancellation?.downstreamPropagation === "review_required") };
    if (groupCommercialState(input.bookingGroupId, children).sourceHash !== input.expectedSourceHash) throw Object.assign(new Error("Booking changed elsewhere. Refresh before cancelling."), { status: 409 });

    const plans = await Promise.all(children.filter(child => child.lifecycleStatus !== "Cancelled").map(async child => {
      const [orders, requirements] = await Promise.all([
        transaction.get(productionOrderV1s().where("sourceBookingId", "==", child.canonicalId)),
        transaction.get(db.collection("fikaProductionRequirements").where("sourceBookingId", "==", child.canonicalId)),
      ]);
      return { child, orders: orders.docs.map(document => ({ ref: document.ref, order: document.data() as ProductionOrderV1 })).filter(({ order }) => !["cancelled", "amended"].includes(order.status)), requirements: requirements.docs };
    }));
    const requiresCpuReview = hospitalityCancellationRequiresCpuReview(plans.flatMap(plan => plan.orders.map(({ order }) => order.status)));
    const now = new Date().toISOString();
    const changes: ProductionProjectionChange[] = requiresCpuReview ? [] : plans.flatMap(plan => plan.orders.map(({ order }) => ({ order: { ...order, status: "cancelled" as const, workflowStatus: "cancelled" as const, version: Number(order.version || 1) + 1, updatedAt: now }, changeType: "withdrawn" as const, idempotencyKey: `hospitality-projection:${plan.child.canonicalId}:cancelled:v${plan.child.version + 1}` })));
    if (!requiresCpuReview) {
      const stageChanges = await prepareHospitalityProductionChanges(transaction, changes, actor.uid, input.bookingGroupId, now, input.reason);
      stageChanges();
      for (const change of changes) stageHospitalityCancellation(transaction, change.order.sourceBookingId, change.order, now);
    }
    const nextById = new Map<string, CanonicalBooking>();
    for (const child of children) {
      const plan = plans.find(item => item.child.canonicalId === child.canonicalId);
      if (!plan) { nextById.set(child.canonicalId, child); continue; }
      const next: CanonicalBooking = {
        ...child,
        lifecycleStatus: "Cancelled",
        version: child.version + 1,
        updatedAt: now,
        updatedBy: actor.uid,
        statusHistory: [...child.statusHistory, { status: "Cancelled", changedAt: now, changedBy: actor.uid, reason: input.reason }],
        audit: [...child.audit, { action: "workflow-cancel", at: now, by: actor.uid, reason: input.reason }],
        dashboardWorkflow: { ...child.dashboardWorkflow, cancellation: {
          reason: input.reason,
          calendarOutcome: "not_requested",
          productionOutcome: requiresCpuReview ? "review_required" : plan.orders.length ? "cancel_requested" : "no_active_production_order",
          downstreamPropagation: requiresCpuReview ? "review_required" : plan.orders.length ? "pending" : "delivered",
          notificationOutcome: cancellationNotificationKind(child, cancellationEvent) ? "queued" : "not_requested",
        } },
      };
      nextById.set(child.canonicalId, next);
    }
    for (const plan of plans) {
      const next = nextById.get(plan.child.canonicalId)!;
      transaction.set(bookings().doc(next.canonicalId), next);
      transaction.create(bookingAudit().doc(`${next.canonicalId.replace(/[^A-Za-z0-9_-]/g, "_")}:${next.version}`), { canonicalId: next.canonicalId, bookingGroupId: input.bookingGroupId, action: "workflow-cancel", actorId: actor.uid, at: now, reason: input.reason, version: next.version, cancellationEvent });
      if (requiresCpuReview) continue;
      for (const { ref, order } of plan.orders) transaction.set(ref, { status: "cancelled", workflowStatus: "cancelled", updatedAt: now, cancellationNotice: `Booking cancelled: ${input.reason}`, version: Number(order.version || 1) + 1, cancelledAt: now, cancelledBy: actor.uid, audit: [...(order.audit || []), { action: "production-order-cancelled-by-booking", at: now, by: actor.uid, previousState: order.status, newState: "cancelled", reason: input.reason }] }, { merge: true });
      for (const requirementRef of plan.requirements) {
        const requirement = requirementRef.data() as { status?: string; audit?: unknown[] };
        if (requirement.status === "cancelled") continue;
        transaction.set(requirementRef.ref, { status: "cancelled", updatedAt: now, updatedBy: actor.uid, audit: [...(requirement.audit || []), { action: "production-requirement-cancelled-by-booking", at: now, by: actor.uid, previousState: requirement.status, newState: "cancelled", reason: input.reason }] }, { merge: true });
      }
    }
    transaction.create(bookingAudit().doc(`group-cancel:${groupHash([input.bookingGroupId, input.expectedSourceHash])}`), { bookingGroupId: input.bookingGroupId, action: "group-cancelled", actorId: actor.uid, at: now, reason: input.reason, childBookingIds: children.map(child => child.canonicalId), requiresCpuReview, cancellationEvent });
    // ONE customer notification per cancellation event, covering every service it cancelled and naming any that remain active.
    const newlyCancelled = plans.map(plan => nextById.get(plan.child.canonicalId)!);
    if (newlyCancelled.length && cancellationNotificationKind(newlyCancelled[0], cancellationEvent)) {
      const notification = groupNotificationRecord({ kind: "cancelled", children: [...nextById.values()], affected: newlyCancelled.map(child => child.canonicalId), anchor: newlyCancelled[0], eventKey: groupEventKey([input.bookingGroupId, newlyCancelled.map(child => [child.canonicalId, child.version])]), createdAt: now });
      transaction.create(db.collection("fikaBookingNotifications").doc(notification.notificationId), notification);
    }
    return { children: [...nextById.values()], plans, changes, idempotent: false as const, requiresCpuReview };
  });
  if (result.idempotent) {
    const retryable = result.children;
    const outcomes = new Map(result.children.map(child => [child.canonicalId, child.dashboardWorkflow?.cancellation?.downstreamPropagation]));
    const allResults: Array<{ status: "pending" | "delivered" | "review_required"; results: unknown[] }> = [];
    for (const child of retryable) {
      try {
        const reconciliation = await reconcileCancelledBookingOrders(child.canonicalId);
        const requirements = await db.collection("fikaProductionRequirements").where("sourceBookingId", "==", child.canonicalId).limit(100).get();
        const orders = reconciliation.orders;
        const cancelledOrders = orders.filter(order => order.status === "cancelled");
        const fulfilment = await Promise.all(cancelledOrders.map(order => db.collection("fikaFulfilmentRequirementsV1").where("sourceEntityId", "==", order.canonicalId).limit(20).get()));
        const unresolvedFulfilment = cancelledOrders.some((order, index) => order.requiresDelivery !== false && order.destinationOplocId && (!fulfilment[index].size || fulfilment[index].docs.some(document => document.data().status !== "withdrawn" && document.data().status !== "cancelled")));
        if (!cancelledOrders.length && child.dashboardWorkflow?.cancellation?.productionOutcome !== "no_active_production_order" && !reconciliation.requiresCpuReview) {
          const unresolvedStatus = child.dashboardWorkflow?.cancellation?.productionOutcome === "review_required" ? "review_required" as const : "pending" as const;
          outcomes.set(child.canonicalId, unresolvedStatus);
          allResults.push({ status: unresolvedStatus, results: [{ bookingId: child.canonicalId, reason: unresolvedStatus === "review_required" ? "CPU review remains unresolved; no authoritative safe-to-withdraw order is available." : "Legacy cancellation downstream state is unresolved; no authoritative safe-to-withdraw production order was found." }] });
          continue;
        }
        if (!cancelledOrders.length && reconciliation.requiresCpuReview) {
          outcomes.set(child.canonicalId, "review_required");
          allResults.push({ status: "review_required", results: [{ bookingId: child.canonicalId, reason: "Advanced Production Order remains active and requires CPU review." }] });
          continue;
        }
        const events = await Promise.all(cancelledOrders.map(order => ensureHospitalityCancellationEvent(child.canonicalId, order)));
        const changes: ProductionProjectionChange[] = cancelledOrders.map(order => ({ order, changeType: "withdrawn", idempotencyKey: `hospitality-withdrawal:${order.canonicalId}:v${order.version}` }));
        const eventIds = new Map(cancelledOrders.map(order => [order.canonicalId, hospitalityCancellationEventId(order.canonicalId, order.version)]));
        const delivery = await propagateProductionChanges(changes, eventIds);
        const outboxStatus = await cancellationDeliveryStatus(events.map(event => event.eventId));
        const status = reconciliation.requiresCpuReview ? "review_required" as const : delivery.status === "delivered" && outboxStatus === "delivered" && !unresolvedFulfilment && requirements.docs.every(document => document.data().status === "cancelled") ? "delivered" as const : "pending" as const;
        outcomes.set(child.canonicalId, status);
        allResults.push(reconciliation.requiresCpuReview || unresolvedFulfilment || requirements.docs.some(document => document.data().status !== "cancelled") ? { ...delivery, results: [...delivery.results, ...(reconciliation.requiresCpuReview ? [{ bookingId: child.canonicalId, reason: "Advanced Production Order remains active and requires CPU review." }] : []), ...(unresolvedFulfilment || requirements.docs.some(document => document.data().status !== "cancelled") ? [{ bookingId: child.canonicalId, reason: "Legacy Logistics or production requirement withdrawal is unresolved; authoritative records remain active or incomplete." }] : [])] } : delivery);
      } catch {
        outcomes.set(child.canonicalId, "pending");
        allResults.push({ status: "pending", results: [{ bookingId: child.canonicalId, reason: "Legacy cancellation reconciliation failed; downstream state remains unresolved." }] });
      }
    }
    const updated = await Promise.all(result.children.map(async child => {
      const status = outcomes.get(child.canonicalId);
      return child.lifecycleStatus === "Cancelled" && status && status !== child.dashboardWorkflow?.cancellation?.downstreamPropagation ? recordCancellationPropagation(child, status) : child;
    }));
    const status = updated.some(child => child.dashboardWorkflow?.cancellation?.downstreamPropagation === "review_required") ? "review_required" as const
      : updated.some(child => child.dashboardWorkflow?.cancellation?.downstreamPropagation !== "delivered") ? "pending" as const : "delivered" as const;
    return { bookings: updated, idempotent: true, projectionPropagation: { status, results: allResults.flatMap(item => item.results) } };
  }
  if (result.requiresCpuReview) return { bookings: result.children, projectionPropagation: { status: "review_required" as const, results: [] } };
  const projectionPropagation = await propagateProductionChanges(result.changes, new Map(result.changes.map(change => [change.order.canonicalId, hospitalityCancellationEventId(change.order.canonicalId, change.order.version)])));
  const updated = await Promise.all(result.children.map(child => child.lifecycleStatus === "Cancelled" ? recordCancellationPropagation(child, projectionPropagation.status) : child));
  return { bookings: updated, projectionPropagation };
}

/**
 * Group "Manage charges": the standalone set-additional-charges rules (server recalculation, locked labour rates, commercial-status gate,
 * commercialVersion bump, quote staling) applied to exactly one child. Siblings are read for group validation only and never written,
 * so the group source hash changes and the consolidated quote becomes stale without touching unrelated services.
 */
export async function setHospitalityGroupServiceCharges(actor: Actor, input: GroupChargesCommand, authorize: (children: CanonicalBooking[]) => Promise<void>) {
  const command = groupChargesCommand.parse(input);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(bookings().where("bookingGroup.id", "==", command.bookingGroupId).limit(MAX_GROUP_SERVICES + 1));
    const children = validateBookingGroup(command.bookingGroupId, snapshot.docs.map(d => d.data() as CanonicalBooking));
    await authorize(children);
    if (groupCommercialState(command.bookingGroupId, children).sourceHash !== command.expectedSourceHash) throw Object.assign(new Error("Booking changed elsewhere. Refresh before saving additional charges."), { status: 409 });
    const current = children.find(child => child.canonicalId === command.bookingId);
    if (!current) throw conflict("That service is not part of this booking group.");
    assertBookingExpectedVersion(current.version, command.expectedVersion, "set-additional-charges");
    assertWorkflowCommand(current, { action: "set-additional-charges", charges: command.charges });
    const settings = await getQuoteSettingsInTransaction(transaction, dashboardIdForSite(current.service.portalSiteId));
    const now = new Date().toISOString();
    const normalized = normalizeBookingAdditionalCharges(command.charges, current.additionalCharges || [], settings.labourRates ?? defaultDashboardQuoteSettings(settings.dashboardId).labourRates ?? [], actor.uid, now);
    // Replay-safe: re-submitting the saved charges changes nothing (no version, quote or audit churn).
    if (JSON.stringify(normalized) === JSON.stringify(current.additionalCharges || [])) return { booking: current, bookings: children, changed: false as const };
    const reason = "Group additional charges updated";
    const next: CanonicalBooking = { ...structuredClone(current), ...applyBookingAdditionalCharges(current, normalized), updatedAt: now, updatedBy: actor.uid };
    next.statusHistory = [...current.statusHistory, { status: next.lifecycleStatus, changedAt: now, changedBy: actor.uid, reason }];
    next.audit = [...current.audit, { action: "workflow-set-additional-charges", at: now, by: actor.uid, reason }];
    transaction.set(bookings().doc(next.canonicalId), next);
    transaction.create(bookingAudit().doc(`${next.canonicalId.replace(/[^A-Za-z0-9_-]/g, "_")}:${next.version}`), { canonicalId: next.canonicalId, bookingGroupId: command.bookingGroupId, action: "workflow-set-additional-charges", at: now, actorId: actor.uid, command: { action: "set-additional-charges", charges: command.charges }, version: next.version, chargeIds: normalized.map(c => c.id) });
    return { booking: next, bookings: children.map(child => child.canonicalId === next.canonicalId ? next : child), changed: true as const };
  });
}
