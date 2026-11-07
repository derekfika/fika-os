import { createHash } from "node:crypto";
import type { CanonicalBooking } from "../../hospitality-booking/lib/canonical-types";

export type OacLegacyPreviewItem = {
  legacyItemId: string;
  quantity: number;
};

/** A minimized source projection. It intentionally excludes customer and price fields. */
export type OacLegacyPreviewRow = {
  bookingId: string;
  sourceBookingId: string;
  status: string;
  sourceStatus: string;
  sourceSiteId: string;
  eventDate: string;
  sourceEventDate?: string;
  guestCount: number;
  sourceGuestCount?: number;
  startTime: string;
  endTime?: string;
  items: OacLegacyPreviewItem[];
  dashboardItems?: OacLegacyPreviewItem[];
  originalItems?: OacLegacyPreviewItem[];
  manuallyEdited: boolean;
  amendmentReviewed?: boolean;
  quoteReferenceId?: string;
  quoteDocumentStatus: "draft" | "unverified" | "hub-saved-pdf" | "none";
  quoteCreatedAt?: string;
  quoteRevisionId?: string;
  calendarEventId?: string;
  calendarCreatedAt?: string;
  calendarCurrentState: "verified" | "unverified" | "none";
};

export type OacLegacyAliasDecision = {
  legacyItemId: string;
  status: "approved" | "proposed" | "unapproved" | "unresolved" | "unmapped";
  canonicalItemId?: string;
};

export type OacExistingBookingIdentity = Pick<CanonicalBooking, "canonicalId" | "lifecycleStatus"> & {
  source: Pick<CanonicalBooking["source"], "sourceBookingId">;
  service: Pick<CanonicalBooking["service"], "portalSiteId">;
};

export type OacLegacyPreviewInput = {
  source: {
    spreadsheetId: string;
    sheetName: string;
    range: string;
    modifiedTime: string;
    rows: OacLegacyPreviewRow[];
  };
  aliases: OacLegacyAliasDecision[];
  existing: OacExistingBookingIdentity[];
  authority: {
    confirmedStatusMappingApproved: boolean;
  };
};

export type OacLegacyPreviewEntry = {
  bookingId: string;
  canonicalId: string;
  rowFingerprint: string;
  status: string;
  serviceDate: string;
  action: "preview_create" | "exact_existing" | "hold" | "excluded";
  reasons: string[];
  warnings: string[];
  sourceQuoteReferenceId?: string;
  sourceQuoteCreatedAt?: string;
  sourceCalendarEventId?: string;
  sourceCalendarCreatedAt?: string;
  mappedItems: Array<{ legacyItemId: string; canonicalItemId: string; quantity: number }>;
};

export type OacLegacyPreviewPlan = {
  schemaVersion: "fika.oac-legacy-reconciliation-preview.v1";
  sourceProjectionFingerprint: string;
  contextFingerprint: string;
  planHash: string;
  summary: {
    sourceRows: number;
    actions: Record<OacLegacyPreviewEntry["action"], number>;
    rowsWithSourceQuoteReferences: number;
    rowsWithSourceCalendarReferences: number;
    writes: 0;
    downstreamEffects: 0;
  };
  entries: OacLegacyPreviewEntry[];
};

const stable = (value: unknown): string => JSON.stringify(canonicalize(value));
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function oacPreviewHash(value: unknown): string {
  return createHash("sha256").update(stable(value)).digest("hex");
}

/** Must stay byte-for-byte compatible with Hub canonicalBookingId for non-RCoA portals. */
export function oacLegacyCanonicalBookingId(sourceBookingId: string): string {
  const digest = createHash("sha256").update(`mnk-booking-platform:${sourceBookingId.trim()}`).digest("hex").slice(0, 32);
  return `booking:mnk:${digest}`;
}

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
  && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const validTime = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const sameItems = (a: OacLegacyPreviewItem[], b: OacLegacyPreviewItem[]) => a.length === b.length
  && a.every((item, index) => item.legacyItemId === b[index]?.legacyItemId && item.quantity === b[index]?.quantity);

function buildEntry(row: OacLegacyPreviewRow, input: OacLegacyPreviewInput, duplicate: boolean): OacLegacyPreviewEntry {
  const canonicalId = oacLegacyCanonicalBookingId(row.bookingId);
  const rowFingerprint = oacPreviewHash(row);
  const entry: OacLegacyPreviewEntry = {
    bookingId: row.bookingId,
    canonicalId,
    rowFingerprint,
    status: row.status,
    serviceDate: row.eventDate,
    action: "hold",
    reasons: [],
    warnings: [],
    ...(row.quoteReferenceId ? { sourceQuoteReferenceId: row.quoteReferenceId } : {}),
    ...(row.quoteCreatedAt ? { sourceQuoteCreatedAt: row.quoteCreatedAt } : {}),
    ...(row.calendarEventId ? { sourceCalendarEventId: row.calendarEventId } : {}),
    ...(row.calendarCreatedAt ? { sourceCalendarCreatedAt: row.calendarCreatedAt } : {}),
    mappedItems: [],
  };
  const hold = (reason: string) => entry.reasons.push(reason);

  if (!row.bookingId.trim() || !row.bookingId.startsWith("AC-")) hold("A stable legacy AC booking reference is required.");
  if (row.sourceBookingId !== row.bookingId) hold("The current Dashboard and nested source booking references disagree.");
  if (row.sourceStatus !== row.status) hold("The current Dashboard and nested source statuses disagree.");
  if (row.sourceSiteId.replaceAll("_", "-") !== "angel-court") hold("The nested source does not identify the Angel Court portal.");
  if (duplicate) hold("The source contains a duplicate stable booking reference.");
  if (row.status !== "CONFIRMED") {
    entry.action = "excluded";
    entry.reasons.push("Only source CONFIRMED rows enter the current operational preview.");
    return entry;
  }
  if (!validDate(row.eventDate)) hold("The current service date is missing or invalid.");
  if (row.sourceEventDate && row.sourceEventDate !== row.eventDate) hold("Current and original source service dates disagree; preserve both for amendment review.");
  if (!Number.isInteger(row.guestCount) || row.guestCount < 1) hold("The current guest count is invalid.");
  if (row.sourceGuestCount !== undefined && row.sourceGuestCount !== row.guestCount) hold("Current and original source guest counts disagree.");
  if (row.manuallyEdited && !row.amendmentReviewed) hold("A manually edited row needs reviewed amendment provenance.");
  if (!validTime(row.startTime)) hold("A valid local service start time is required.");
  if (row.endTime && !validTime(row.endTime)) hold("The optional source end time is malformed.");
  if (!row.endTime) entry.warnings.push("Source end time absent; current booking model permits omission. Do not synthesize a Calendar end time.");
  if (row.quoteCreatedAt && !Number.isFinite(Date.parse(row.quoteCreatedAt))) hold("The nested source quote timestamp is invalid.");
  if (row.calendarCreatedAt && !Number.isFinite(Date.parse(row.calendarCreatedAt))) hold("The nested source Calendar timestamp is invalid.");
  if (row.quoteReferenceId && !row.quoteCreatedAt) hold("A nested source quote link has no creation timestamp.");
  if (row.calendarEventId && !row.calendarCreatedAt) hold("A nested source Calendar event ID has no creation timestamp.");
  if (!Array.isArray(row.items) || !row.items.length) hold("At least one source order line is required.");
  if (row.dashboardItems && !sameItems(row.items, row.dashboardItems)) hold("Dashboard ItemsJSON and ParsedJSON item IDs or quantities disagree.");
  if (row.originalItems && !sameItems(row.items, row.originalItems)) hold("ParsedJSON and nested original order item IDs or quantities disagree.");
  for (const line of row.items || []) {
    if (!line.legacyItemId.trim() || !Number.isInteger(line.quantity) || line.quantity < 1) {
      hold("A source order line has a missing item ID or invalid quantity.");
      continue;
    }
    const decisions = input.aliases.filter(alias => alias.legacyItemId === line.legacyItemId);
    if (decisions.length !== 1 || decisions[0].status !== "approved" || !decisions[0].canonicalItemId) {
      hold(`Legacy item ${line.legacyItemId} lacks exactly one approved canonical alias.`);
      continue;
    }
    entry.mappedItems.push({ legacyItemId: line.legacyItemId, canonicalItemId: decisions[0].canonicalItemId, quantity: line.quantity });
  }

  const existing = input.existing.filter(booking => booking.canonicalId === canonicalId);
  if (existing.length > 1) hold("Multiple canonical documents have the deterministic target ID.");
  else if (existing.length === 1) {
    if (existing[0].source.sourceBookingId !== row.bookingId || existing[0].service.portalSiteId !== "angel-court") hold("The deterministic target belongs to a different source or portal site.");
    else if (!entry.reasons.length) {
      entry.action = "exact_existing";
      entry.reasons.push("An exact current canonical booking already exists; preview will not write or update it.");
      return entry;
    } else {
      hold("An exact current canonical booking already exists; reconcile it without overwriting.");
    }
  }

  if (!input.authority.confirmedStatusMappingApproved) hold("No owner-approved mapping exists from legacy CONFIRMED to a current FIKA lifecycle/handoff state.");
  if (!row.quoteRevisionId || row.quoteDocumentStatus !== "hub-saved-pdf") hold("No current FIKA QuoteRevision backed by a saved quote PDF is present; source Docs remain evidence only.");
  if (row.calendarEventId && row.calendarCurrentState !== "verified") hold("The source Calendar event state is unverified; do not recreate or update it.");
  if (!row.calendarEventId) hold("No source Calendar event identity is available for reconciliation.");

  if (entry.reasons.length) {
    entry.action = "hold";
  } else {
    entry.action = "preview_create";
    entry.reasons.push("Inputs satisfy the preview gates. This is not an import authorization.");
  }
  return entry;
}

/** Pure, no-I/O reconciliation preview. It never constructs or persists a CanonicalBooking. */
export function buildOacLegacyPreview(input: OacLegacyPreviewInput): OacLegacyPreviewPlan {
  if (!input.source.spreadsheetId || input.source.sheetName !== "Dashboard Data" || !input.source.range.includes("A1:AM")) {
    throw new Error("A bounded Dashboard Data source snapshot is required.");
  }
  if (!Number.isFinite(Date.parse(input.source.modifiedTime))) throw new Error("A valid source modifiedTime is required.");
  const counts = new Map<string, number>();
  for (const row of input.source.rows) counts.set(row.bookingId, (counts.get(row.bookingId) || 0) + 1);
  const entries = input.source.rows.map(row => buildEntry(row, input, (counts.get(row.bookingId) || 0) > 1));
  const sourceProjectionFingerprint = oacPreviewHash({
    spreadsheetId: input.source.spreadsheetId,
    sheetName: input.source.sheetName,
    range: input.source.range,
    modifiedTime: input.source.modifiedTime,
    rows: input.source.rows,
  });
  const actions: OacLegacyPreviewPlan["summary"]["actions"] = { preview_create: 0, exact_existing: 0, hold: 0, excluded: 0 };
  for (const entry of entries) actions[entry.action]++;
  const contextFingerprint = oacPreviewHash({
    aliases: input.aliases,
    existing: input.existing.map(booking => ({ canonicalId: booking.canonicalId, sourceBookingId: booking.source.sourceBookingId, portalSiteId: booking.service.portalSiteId, lifecycleStatus: booking.lifecycleStatus })),
    authority: input.authority,
  });
  const body = {
    schemaVersion: "fika.oac-legacy-reconciliation-preview.v1" as const,
    sourceProjectionFingerprint,
    contextFingerprint,
    summary: {
      sourceRows: entries.length,
      actions,
      rowsWithSourceQuoteReferences: input.source.rows.filter(row => Boolean(row.quoteReferenceId)).length,
      rowsWithSourceCalendarReferences: input.source.rows.filter(row => Boolean(row.calendarEventId)).length,
      writes: 0 as const,
      downstreamEffects: 0 as const,
    },
    entries,
  };
  return { ...body, planHash: oacPreviewHash(body) };
}
