import crypto from "node:crypto";
import { db } from "./firebase-admin";
import type { Actor } from "./auth";
import type { CanonicalRecord } from "./types";
import { generateCanonicalId } from "./canonical-identities";
import { stableDocumentId } from "./canonical-editor";
import { sha256 } from "./profiler";
import { parseCanonical } from "./schemas";
import {
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
  bookingNotificationRecord,
  type BookingNotificationKind,
} from "./booking-notifications";
import {
  createProductionFromApprovedBooking,
  type ProductionOrder as ProductionOrderV1,
} from "./production-domain";
import { notifyCpuProjection } from "./cpu-projection-client";
import { localBookingFixtures } from "./local-booking-fixtures";
import { capGallagherMinimum, GALLAGHER_MINIMUM_GUESTS, isGallagherBooking } from "./gallagher-rules";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";

export const MNK_BOOKING_INGESTION_CONTRACT_VERSION =
  "fika.booking-ingestion.mnk.v1";
export const HOSPITALITY_MENU_READ_CONTRACT_VERSION =
  "fika.hospitality-menu-read.v1";

export type MnkBookingPayload = {
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
    provider: "mnk-booking-platform";
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
  quoteState?: { currentRevisionId?: string; revisions: QuoteRevision[] };
  dashboardWorkflow?: DashboardWorkflow;
  deliveryChargeRequired?: boolean;
};

export type ProductionOrder = {
  canonicalId: string;
  bookingId: string;
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
  recordDataAccess({ app: "integration-hub", operation: "hospitality.menu-contract", source: "FIRESTORE", dataset: "integrationHubCanonical", documents: snapshot.size, firestoreReadKind: "query" });
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

export function canonicalBookingId(sourceBookingId: string) {
  const digest = crypto
    .createHash("sha256")
    .update(`mnk-booking-platform:${sourceBookingId.trim()}`)
    .digest("hex")
    .slice(0, 32);
  return `booking:mnk:${digest}`;
}

/** Resolve a portal site through governed source mapping; labels are not identity. */
export function resolveHospitalityDestinationOploc(
  payload: Pick<MnkBookingPayload, "siteId" | "site">,
  mappings: Array<Record<string, unknown>>,
  canonicalRecords: CanonicalRecord[],
) {
  const portalSiteId = portalSiteKeyForPayload(payload);
  const sourceIdentifiers = [portalSiteId, payload.site].map(value => String(value || "").trim().toLowerCase()).filter(Boolean);
  if (!sourceIdentifiers.length) return undefined;
  const mapping = mappings.find(candidate =>
    sourceIdentifiers.includes(String(candidate.sourceIdentifier || "").trim().toLowerCase()) &&
    String(candidate.mappingStatus || "") === "confirmed" &&
    Boolean(String(candidate.sourceEntityType || "")),
  );
  const destination = String(mapping?.oplocId || mapping?.targetCanonicalId || "").trim();
  const target = canonicalRecords.find(record => record.entityType === "OPLOC" && record.canonicalId === destination && record.lifecycleStatus !== "archived" && record.publicationStatus !== "withdrawn" && record.record.lifecycleState === "active");
  return target?.canonicalId;
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
  const activeMenuItems = menuRecords.filter(
    (record) =>
      record.entityType === "Hospitality Menu Item" &&
      record.lifecycleStatus !== "archived" &&
      record.record.lifecycleState === "active",
  );
  const portalSiteId = portalSiteKeyForPayload(payload);
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
  // Angel Court and the other new portals currently retain their brochure
  // catalogue locally while those records are being promoted into the Hub.
  // Keep those submitted commercial snapshots intact during that transition;
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
        "Hospitality Menu Catalogue has no MNK mappings yet; portal price snapshot retained as compatibility evidence.",
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
      const minimumQuantity = capGallagherMinimum(Math.max(
        Number(menuItem?.record.minimumQuantity || 1),
        Number(String(item.servingInfo || "").match(/minimum\s+(\d+)/i)?.[1] || 1),
        /rice paper rolls?/i.test(String(item.itemName || menuItem?.record.name)) ? 3 : 1,
      ), gallagher);
      if (
        Number.isFinite(minimumQuantity) &&
        minimumQuantity > 1 &&
        item.quantity < minimumQuantity
      )
        throw conflict(
          `${item.itemName || item.itemId} requires at least ${minimumQuantity} boxes.`,
        );
    }
    return {
      ...structuredClone(item),
      ...(menuItem ? { menuItemId: menuItem.canonicalId } : {}),
    };
  });
  const id = canonicalBookingId(payload.bookingId);
  const status: CanonicalBooking["lifecycleStatus"] = "New";
  const vatTotal = 0; // The portal's current snapshot is net-only; do not manufacture VAT line detail.
  return {
    booking: {
      canonicalId: id,
      entityType: "Booking",
      schemaVersion: "0.1.0",
      version: 1,
      lifecycleStatus: status,
      createdAt: now,
      createdBy: "bridge:mnk-booking-platform",
      updatedAt: now,
      updatedBy: "bridge:mnk-booking-platform",
      source: {
        provider: "mnk-booking-platform",
        sourceBookingId: payload.bookingId.trim(),
        submissionTimestamp: payload.submittedAt,
        contractVersion: MNK_BOOKING_INGESTION_CONTRACT_VERSION,
        originalPayload: structuredClone(payload),
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
          changedBy: "bridge:mnk-booking-platform",
          reason: "Submitted through MNK Hospitality Booking Portal.",
        },
      ],
      audit: [
        {
          action: "booking-ingested",
          at: now,
          by: "bridge:mnk-booking-platform",
          reason:
            "Canonical bridge accepted the structured MNK portal booking.",
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
  const result = buildMnkCanonicalBooking(payload, menuRecords, now);
  if (destinationOplocId) result.booking.service.oplocId = destinationOplocId;
  return result;
}

export async function ingestMnkBooking(
  payload: MnkBookingPayload,
): Promise<IngestionResult> {
  const result = await db.runTransaction(async (transaction) => {
    const [existingSnapshot, menusSnapshot, mappingsSnapshot] = await Promise.all([
      transaction.get(bookings().doc(canonicalBookingId(payload.bookingId))),
      transaction.get(canonical()),
      transaction.get(sourceMappings()),
    ]);
    recordDataAccess({ app: "integration-hub", operation: "hospitality.ingest.transaction-reads", source: "FIRESTORE", dataset: "hospitality-ingest", documents: (existingSnapshot.exists ? 1 : 0) + menusSnapshot.size + mappingsSnapshot.size, estimatedBillableReads: 1 + menusSnapshot.size + mappingsSnapshot.size, firestoreReadKind: "transaction" });
    const canonicalRecords = menusSnapshot.docs.map((document) => document.data() as CanonicalRecord);
    if (existingSnapshot.exists) {
      return ingestMnkBookingFromExisting(existingSnapshot.data() as CanonicalBooking, payload, canonicalRecords);
    }
    const destinationOplocId = resolveHospitalityDestinationOploc(
      payload,
      mappingsSnapshot.docs.map(document => document.data() as Record<string, unknown>),
      canonicalRecords,
    );
    if (!destinationOplocId) throw conflict("This delivery-requiring Hospitality Booking has no confirmed canonical destination OPLOC; resolve the governed site mapping before submission.");
    const result = ingestMnkBookingFromExisting(
      existingSnapshot.exists
        ? (existingSnapshot.data() as CanonicalBooking)
        : undefined,
      payload,
      canonicalRecords,
      undefined,
      destinationOplocId,
    );
    if (!result.created) return result;
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
    return result;
  });
  if (result.created)
    await dispatchBookingNotification(
      result.booking,
      "submitted",
      result.booking.version,
    );
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
  return snapshot.exists
    ? (snapshot.data() as DashboardQuoteSettings)
    : defaultDashboardQuoteSettings(dashboardId);
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
  return snapshot.exists
    ? (snapshot.data() as DashboardQuoteSettings)
    : defaultDashboardQuoteSettings(dashboardId);
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
    const next: DashboardQuoteSettings = {
      ...input,
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

function addCalendarDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function propagateProductionChanges(changes: ProductionProjectionChange[]) {
  const results = [];
  for (const change of changes) {
    try {
      results.push({ canonicalId: change.order.canonicalId, ...(await notifyCpuProjection(change.order, change.changeType, change.idempotencyKey)), status: "delivered" as const });
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
  return {
    bookings: rows,
    productionOrders: Object.fromEntries(orders),
    quoteSettings: await getDashboardQuoteSettings(dashboardIdForSite(siteId)),
    ...(truncated ? { truncated: true } : {}),
  };
}

export async function executeBookingWorkflow(
  actor: Actor,
  canonicalId: string,
  expectedVersion: number,
  command: WorkflowCommand,
) {
  const result = await db.runTransaction(async (transaction) => {
    const ref = bookings().doc(canonicalId);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw conflict("Booking was not found.");
    const current = snapshot.data() as CanonicalBooking;
    if (current.version !== expectedVersion)
      throw conflict("Booking changed elsewhere. Refresh and try again.");
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
      if (!items.length)
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
      const priorOrders = await transaction.get(
        productionOrderV1s().where("sourceBookingId", "==", canonicalId),
      );
      const priorRequirements = await transaction.get(
        db.collection("fikaProductionRequirements").where("sourceBookingId", "==", canonicalId),
      );
      for (const prior of priorOrders.docs) {
        const order = prior.data() as ProductionOrderV1;
        if (order.status === "cancelled" || order.status === "amended") continue;
        projectionChanges.push({ order: { ...order, status: "amended", workflowStatus: "amended", version: Number(order.version || 1) + 1 }, changeType: "amended", idempotencyKey: `hospitality-projection:${canonicalId}:amended:v${next.version}` });
        transaction.set(
          prior.ref,
          {
            status: "amended",
            workflowStatus: "amended",
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
      next.lifecycleStatus = "Reviewed";
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
      next.lifecycleStatus = "Quoted";
    }
    if (command.action === "quote-pdf-status") {
      next.quoteState = {
        ...next.quoteState!,
        revisions: applyQuotePdfPersistence(next.quoteState!.revisions, next.quoteState!.currentRevisionId, command.revisionId, command.status, command.driveFileId, command.driveUrl, command.error),
      };
    }
    let notificationKind: BookingNotificationKind | undefined;
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
      // Keep the Production Order cancelled so downstream Logistics excludes
      // it. CPU retains a separate warning projection until a chef dismisses it.
      const priorOrders = command.cancelProduction
        ? await transaction.get(
            productionOrderV1s().where("sourceBookingId", "==", canonicalId),
          )
        : undefined;
      const priorRequirements = command.cancelProduction
        ? await transaction.get(
            db
              .collection("fikaProductionRequirements")
              .where("sourceBookingId", "==", canonicalId),
          )
        : undefined;
      const activeOrders = (priorOrders?.docs || []).filter((prior) => {
        const order = prior.data() as ProductionOrderV1;
        return !["cancelled", "amended"].includes(order.status);
      });
      for (const prior of activeOrders) {
        const order = prior.data() as ProductionOrderV1;
        projectionChanges.push({ order: { ...order, status: "cancelled", workflowStatus: "cancelled", version: Number(order.version || 1) + 1 }, changeType: "withdrawn", idempotencyKey: `hospitality-projection:${canonicalId}:cancelled:v${next.version}` });
        transaction.set(
          prior.ref,
          {
            status: "cancelled",
            workflowStatus: "cancelled",
            cancellationNotice: `Booking cancelled: ${command.reason}`,
            version: Number(order.version || 1) + 1,
            cancelledAt: now,
            cancelledBy: actor.uid,
            audit: [
              ...(order.audit || []),
              {
                action: "production-order-cancelled-by-booking",
                at: now,
                by: actor.uid,
                previousState: order.status,
                newState: "cancelled",
                reason: command.reason,
              },
            ],
          },
          { merge: true },
        );
      }
      for (const prior of priorRequirements?.docs || []) {
        const requirement = prior.data() as {
          status?: string;
          audit?: unknown[];
        };
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
                action: "production-requirement-cancelled-by-booking",
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
      notificationKind = "cancelled";
      next.dashboardWorkflow = {
        ...next.dashboardWorkflow,
        cancellation: {
          reason: command.reason,
          calendarOutcome: command.removeCalendar
            ? "not_configured"
            : "not_requested",
          productionOutcome: command.cancelProduction
            ? activeOrders.length
              ? "cancelled"
              : "no_active_production_order"
            : "not_requested",
          notificationOutcome: "not_configured",
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
    return { booking: next, notificationKind, projectionChanges };
  });
  const notification = result.notificationKind
    ? await dispatchBookingNotification(
        result.booking,
        result.notificationKind,
        result.booking.version,
      )
    : undefined;
  const projectionPropagation = await propagateProductionChanges(result.projectionChanges);
  return { booking: result.booking, ...(notification ? { notification } : {}), projectionPropagation };
}

export async function dispatchBookingNotification(
  booking: CanonicalBooking,
  kind: BookingNotificationKind,
  version: number,
) {
  const notification = bookingNotificationRecord(
    booking,
    kind,
    version,
    booking.updatedAt,
  );
  const existing = await db
    .collection("fikaBookingNotifications")
    .doc(notification.notificationId)
    .get();
  const existingStatus = existing.exists
    ? String(existing.data()?.status || "")
    : "";
  if (existingStatus === "sent")
    return {
      status: "sent" as const,
      reason: "Already delivered for this Booking revision.",
    };
  const endpoint = String(process.env.FIKA_EMAIL_WEBHOOK_URL || "").trim();
  if (!endpoint)
    return {
      status: "queued" as const,
      reason: "FIKA_EMAIL_WEBHOOK_URL is not configured.",
    };
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contractVersion: "fika.booking-email.v1",
        from: process.env.FIKA_EMAIL_FROM || "FIKA Hospitality",
        siteId: notification.siteId,
        siteLabel: notification.siteLabel,
        templateKey: notification.templateKey,
        to: notification.to,
        cc: notification.cc,
        subject: notification.subject,
        text: notification.text,
        html: notification.html,
      }),
    });
    if (!response.ok)
      throw new Error(`Email provider returned HTTP ${response.status}.`);
    await db
      .collection("fikaBookingNotifications")
      .doc(notification.notificationId)
      .set(
        { status: "sent", sentAt: new Date().toISOString() },
        { merge: true },
      );
    return { status: "sent" as const };
  } catch (error) {
    await db
      .collection("fikaBookingNotifications")
      .doc(notification.notificationId)
      .set(
        {
          status: "failed",
          failureReason: (error as Error).message,
          failedAt: new Date().toISOString(),
        },
        { merge: true },
      );
    return { status: "failed" as const, reason: (error as Error).message };
  }
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
  const order = result.order;
  const projectionPropagation = await propagateProductionChanges([{ order, changeType: "created", idempotencyKey: `cpu-projection:${order.canonicalId}:v${order.version}` }]);
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
    productionOrder: {
      canonicalId: order.canonicalId,
      bookingId: order.sourceBookingId,
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
  if (["mnk", "angel-court", "cfc", "munich-re"].includes(value)) return value;
  const label = String(payload.site || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (label === "mnk" || label === "mnk international") return "mnk";
  if (label === "angel court" || label === "one angel court") return "angel-court";
  if (label === "cfc" || label === "cfc underwriting") return "cfc";
  if (label === "munich re") return "munich-re";
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
