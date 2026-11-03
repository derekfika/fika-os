import { createHash, randomUUID } from "node:crypto";
import { GoogleAuth } from "google-auth-library";
import type { Transaction } from "firebase-admin/firestore";
import { db } from "./firebase-admin";
import { deliverCpuPropagation, stageCpuDeliveries, type CpuDurableDeliveryInput } from "./cpu-durable-outbox";
import type { ProductionOrder } from "./production-types";

export const CPUX_CALENDAR_STATE_COLLECTION = "fikaCpuXCalendarPublicationStateV1";
export const CPUX_CALENDAR_EVENT_ROUTE = "/api/internal/cpux-calendar";
export const CPUX_CALENDAR_TIME_ZONE = "Europe/London";
export const CPUX_CALENDAR_EVENTS_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const CPUX_CALENDAR_BACKFILL_MAX_DAYS = 31;
export const CPUX_CALENDAR_BACKFILL_MAX_ORDERS = 25;
const DEFAULT_EVENT_DURATION_MINUTES = 60;
const CLAIM_TTL_MS = 2 * 60 * 1000;

export type CpuXCalendarRuntimeEnvironment = Record<string, string | undefined>;

/** Calendar mutations are allowed only in the explicitly enabled FIKA production project. */
export function cpuXCalendarWritesEnabled(env: CpuXCalendarRuntimeEnvironment = process.env) {
  if (env.FIKA_RUNTIME_MODE !== "production" || env.FIREBASE_PROJECT_ID !== "fika-os") return false;
  if (env.GCLOUD_PROJECT && env.GCLOUD_PROJECT !== "fika-os") return false;
  if (env.GOOGLE_CLOUD_PROJECT && env.GOOGLE_CLOUD_PROJECT !== "fika-os") return false;
  if (env.FIREBASE_CONFIG) {
    try {
      const configuredProject = (JSON.parse(env.FIREBASE_CONFIG) as { projectId?: unknown }).projectId;
      if (configuredProject && configuredProject !== "fika-os") return false;
    } catch { return false; }
  }
  if (env.FIKA_CPUX_CALENDAR_WRITES_ENABLED !== "true") return false;
  return Boolean(env.FIKA_CPUX_CALENDAR_ID?.trim());
}

export function cpuXCalendarBackfillEnabled(env: CpuXCalendarRuntimeEnvironment = process.env) {
  return cpuXCalendarWritesEnabled(env) && env.FIKA_CPUX_CALENDAR_BACKFILL_ENABLED === "true";
}

type CalendarOperation = "upsert" | "delete";
type CalendarState = {
  canonicalId: string;
  desiredVersion: number;
  desiredOperation: CalendarOperation;
  calendarEventId: string;
  publishedVersion?: number;
  publishedOperation?: CalendarOperation;
  claim?: { id: string; version: number; expiresAt: string };
  updatedAt: string;
};

export type CpuXCalendarEventResource = {
  id: string;
  summary: string;
  description: string;
  location?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  extendedProperties: { private: Record<string, string> };
};

export type CpuXCalendarBackfillResult = {
  datesRead: number;
  ordersRead: number;
  queued: number;
  delivered: number;
  pending: number;
  alreadyCurrent: number;
  skipped: number;
};

function safeDocumentId(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** A stable Google event ID makes insert retries and backfill replays idempotent. */
export function cpuxCalendarEventId(canonicalId: string) {
  return `fika${safeDocumentId(canonicalId)}`;
}

export function shouldQueueCpuXCalendarOrder(current: Pick<CalendarState, "desiredVersion"> | undefined, order: Pick<ProductionOrder, "version" | "status" | "supersededBy" | "lines">) {
  const operation = isCpuXCalendarOrderEligible(order) ? "upsert" : "delete";
  if (!current && operation === "delete") return false;
  return !current || order.version > current.desiredVersion;
}

function hasSandwichWorkstream(order: Pick<ProductionOrder, "lines">) {
  return order.lines.some((line) => line.workstream === "sandwiches");
}

export function isCpuXCalendarOrderEligible(order: Pick<ProductionOrder, "status" | "supersededBy" | "lines">) {
  // A canonical Production Order only exists after the upstream hand-off. Its
  // local planning status may still be "draft" or "needs_review" at that point.
  return !["cancelled", "rejected"].includes(order.status) && !order.supersededBy && hasSandwichWorkstream(order);
}

function operationFor(order: ProductionOrder): CalendarOperation {
  return isCpuXCalendarOrderEligible(order) ? "upsert" : "delete";
}

function deliveryEventId(order: ProductionOrder) {
  return `cpu-calendar:${safeDocumentId(order.canonicalId)}:v${order.version}`;
}

function stateRef(canonicalId: string) {
  return db.collection(CPUX_CALENDAR_STATE_COLLECTION).doc(safeDocumentId(canonicalId));
}

function deliveryFor(order: ProductionOrder, operation: CalendarOperation): CpuDurableDeliveryInput {
  return {
    eventId: deliveryEventId(order),
    sourceAggregateId: order.canonicalId,
    sourceVersion: order.version,
    occurredAt: order.updatedAt || order.createdAt,
    consumer: "cpu-production",
    route: CPUX_CALENDAR_EVENT_ROUTE,
    body: { canonicalId: order.canonicalId, sourceVersion: order.version, operation },
  };
}

/**
 * Record the desired Calendar state and durable delivery in one Firestore
 * transaction. The order/version key is shared by live delivery and backfill.
 */
export async function stageCpuXCalendarOrder(transaction: Transaction, order: ProductionOrder, environment: CpuXCalendarRuntimeEnvironment = process.env) {
  if (!cpuXCalendarWritesEnabled(environment)) return { status: "disabled" as const };
  if (!order.canonicalId || !Number.isInteger(order.version) || order.version < 1) {
    throw new Error("A canonical Production Order identity and positive version are required for CPUX Calendar delivery.");
  }
  const ref = stateRef(order.canonicalId);
  const snapshot = await transaction.get(ref);
  const current = snapshot.exists ? snapshot.data() as CalendarState : undefined;
  const operation = operationFor(order);
  if (!shouldQueueCpuXCalendarOrder(current, order)) return current ? { status: "already-current" as const } : { status: "skipped" as const };

  const eventId = cpuxCalendarEventId(order.canonicalId);
  await stageCpuDeliveries(transaction, [deliveryFor(order, operation)]);
  transaction.set(ref, {
    canonicalId: order.canonicalId,
    desiredVersion: order.version,
    desiredOperation: operation,
    calendarEventId: eventId,
    ...(current?.publishedVersion ? { publishedVersion: current.publishedVersion } : {}),
    ...(current?.publishedOperation ? { publishedOperation: current.publishedOperation } : {}),
    updatedAt: new Date().toISOString(),
  } satisfies CalendarState, { merge: true });
  return { status: "queued" as const, eventId };
}

export async function enqueueCpuXCalendarOrder(order: ProductionOrder, environment: CpuXCalendarRuntimeEnvironment = process.env) {
  if (!cpuXCalendarWritesEnabled(environment)) return { status: "disabled" as const };
  return db.runTransaction((transaction) => stageCpuXCalendarOrder(transaction, order, environment));
}

export async function claimCpuXCalendarOrder(canonicalId: string, sourceVersion: number, now = new Date(), environment: CpuXCalendarRuntimeEnvironment = process.env) {
  if (!cpuXCalendarWritesEnabled(environment)) return { status: "disabled" as const };
  const ref = stateRef(canonicalId);
  const claimId = `cpux-calendar:${randomUUID()}`;
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return { status: "missing" as const };
    const current = snapshot.data() as CalendarState;
    if (current.desiredVersion !== sourceVersion) return { status: "superseded" as const };
    if (current.claim && new Date(current.claim.expiresAt).getTime() > now.getTime()) return { status: "busy" as const };
    const claimed: CalendarState = {
      ...current,
      claim: { id: claimId, version: sourceVersion, expiresAt: new Date(now.getTime() + CLAIM_TTL_MS).toISOString() },
    };
    transaction.set(ref, claimed);
    return { status: "claimed" as const, claimId, state: claimed };
  });
}

export async function finishCpuXCalendarOrder(canonicalId: string, claimId: string, sourceVersion: number, operation: CalendarOperation) {
  const ref = stateRef(canonicalId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const current = snapshot.data() as CalendarState;
    if (current.claim?.id !== claimId || current.claim.version !== sourceVersion) return;
    transaction.set(ref, {
      ...current,
      publishedVersion: sourceVersion,
      publishedOperation: operation,
      claim: null,
      updatedAt: new Date().toISOString(),
    });
  });
}

export async function releaseCpuXCalendarOrderClaim(canonicalId: string, claimId: string) {
  const ref = stateRef(canonicalId);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const current = snapshot.data() as CalendarState;
    if (current.claim?.id !== claimId) return;
    transaction.set(ref, { ...current, claim: null, updatedAt: new Date().toISOString() });
  });
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function boundedBackfillDates(fromServiceDate: string, toServiceDate: string) {
  if (!validDate(fromServiceDate) || !validDate(toServiceDate) || toServiceDate < fromServiceDate) {
    throw Object.assign(new Error("Valid fromServiceDate and toServiceDate values are required."), { status: 400 });
  }
  const dates: string[] = [];
  for (let date = new Date(`${fromServiceDate}T00:00:00Z`); date <= new Date(`${toServiceDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
    dates.push(date.toISOString().slice(0, 10));
    if (dates.length > CPUX_CALENDAR_BACKFILL_MAX_DAYS) {
      throw Object.assign(new Error(`The CPUX Calendar backfill is limited to ${CPUX_CALENDAR_BACKFILL_MAX_DAYS} service dates per call.`), { status: 400 });
    }
  }
  return dates;
}

export async function scanCpuXCalendarBackfill(
  fromServiceDate: string,
  toServiceDate: string,
  listOrders: (serviceDate: string) => Promise<ProductionOrder[]>,
  enqueue: (order: ProductionOrder) => Promise<{ status: "queued" | "already-current" | "skipped" | "disabled"; eventId?: string }>,
  deliver: (eventId: string) => Promise<{ status: string }> = deliverCpuPropagation,
  environment: CpuXCalendarRuntimeEnvironment = process.env,
): Promise<CpuXCalendarBackfillResult> {
  if (!cpuXCalendarBackfillEnabled(environment)) throw Object.assign(new Error("CPUX Calendar backfill is disabled outside the separately enabled production workflow."), { status: 503 });
  const dates = boundedBackfillDates(fromServiceDate, toServiceDate);
  const result: CpuXCalendarBackfillResult = { datesRead: 0, ordersRead: 0, queued: 0, delivered: 0, pending: 0, alreadyCurrent: 0, skipped: 0 };
  const orders: ProductionOrder[] = [];
  for (const serviceDate of dates) {
    const dateOrders = await listOrders(serviceDate);
    result.datesRead += 1;
    result.ordersRead += dateOrders.length;
    orders.push(...dateOrders.filter(order => order.serviceDate === serviceDate));
  }
  if (orders.length > CPUX_CALENDAR_BACKFILL_MAX_ORDERS) {
    throw Object.assign(new Error(`The CPUX Calendar backfill is limited to ${CPUX_CALENDAR_BACKFILL_MAX_ORDERS} canonical orders per call; use a smaller explicit date range.`), { status: 413 });
  }
  for (const order of orders) {
    if (operationFor(order) === "delete" && !hasSandwichWorkstream(order)) { result.skipped += 1; continue; }
    const staged = await enqueue(order);
    if (staged.status === "queued") {
      result.queued += 1;
      if (staged.eventId) {
        const delivered = await deliver(staged.eventId);
        if (delivered.status === "delivered") result.delivered += 1;
        else result.pending += 1;
      } else result.pending += 1;
    } else if (staged.status === "already-current") result.alreadyCurrent += 1;
    else result.skipped += 1;
  }
  return result;
}

export type CpuXCalendarBackfillPreview = {
  datesRead: number;
  ordersRead: number;
  candidateCount: number;
  ineligibleCount: number;
  wrongServiceDateCount: number;
};

/** Read-only bounded preview. It never stages or delivers Calendar outbox work. */
export async function previewCpuXCalendarBackfill(
  fromServiceDate: string,
  toServiceDate: string,
  listOrders: (serviceDate: string) => Promise<ProductionOrder[]>,
): Promise<CpuXCalendarBackfillPreview> {
  const dates = boundedBackfillDates(fromServiceDate, toServiceDate);
  const result: CpuXCalendarBackfillPreview = { datesRead: 0, ordersRead: 0, candidateCount: 0, ineligibleCount: 0, wrongServiceDateCount: 0 };
  const orders: ProductionOrder[] = [];
  for (const serviceDate of dates) {
    const dateOrders = await listOrders(serviceDate);
    result.datesRead += 1;
    result.ordersRead += dateOrders.length;
    for (const order of dateOrders) {
      if (order.serviceDate !== serviceDate) result.wrongServiceDateCount += 1;
      else orders.push(order);
    }
  }
  if (orders.length > CPUX_CALENDAR_BACKFILL_MAX_ORDERS) {
    throw Object.assign(new Error(`The CPUX Calendar backfill is limited to ${CPUX_CALENDAR_BACKFILL_MAX_ORDERS} canonical orders per call; use a smaller explicit date range.`), { status: 413 });
  }
  for (const order of orders) {
    if (isCpuXCalendarOrderEligible(order)) result.candidateCount += 1;
    else result.ineligibleCount += 1;
  }
  return result;
}

function durationMinutes() {
  const configured = Number(process.env.FIKA_CPUX_CALENDAR_DURATION_MINUTES || DEFAULT_EVENT_DURATION_MINUTES);
  if (!Number.isInteger(configured) || configured < 1 || configured > 480) {
    throw Object.assign(new Error("FIKA_CPUX_CALENDAR_DURATION_MINUTES must be an integer from 1 to 480."), { status: 503 });
  }
  return configured;
}

function endTimeFor(order: ProductionOrder) {
  const start = order.serviceWindow?.startTime;
  if (!start || !/^([01]\d|2[0-3]):[0-5]\d$/.test(start)) throw Object.assign(new Error("A valid Europe/London service start time is required for the CPUX Calendar event."), { status: 422 });
  const end = order.serviceWindow?.endTime;
  if (end) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(end) || end <= start) throw Object.assign(new Error("The Production Order service end time is invalid."), { status: 422 });
    return { start, end };
  }
  const [hours, minutes] = start.split(":").map(Number);
  const endMinutes = hours * 60 + minutes + durationMinutes();
  if (endMinutes >= 24 * 60) throw Object.assign(new Error("The configured CPUX Calendar event duration crosses the service date boundary."), { status: 422 });
  return { start, end: `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}` };
}

function zonedParts(epoch: number) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: CPUX_CALENDAR_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(epoch));
  return Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, Number(part.value)])) as Record<string, number>;
}

function londonDateTime(serviceDate: string, time: string) {
  const [year, month, day] = serviceDate.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  const wanted = { year, month, day, hour, minute, second: 0 };
  const offsets = new Set<number>();
  for (const hoursFromWallClock of [-36, -12, 0, 12, 36]) {
    const sample = wallClockAsUtc + hoursFromWallClock * 60 * 60 * 1000;
    const local = zonedParts(sample);
    offsets.add(Math.round((Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second) - sample) / 60_000));
  }
  const valid = [...offsets].filter(offset => {
    const candidate = wallClockAsUtc - offset * 60_000;
    const local = zonedParts(candidate);
    return Object.keys(wanted).every(key => local[key] === wanted[key as keyof typeof wanted]);
  });
  if (valid.length !== 1) throw Object.assign(new Error(valid.length ? "The Production Order service time is ambiguous in Europe/London." : "The Production Order service time does not exist in Europe/London."), { status: 422 });
  const offset = valid[0];
  const sign = offset >= 0 ? "+" : "-";
  const magnitude = Math.abs(offset);
  return `${serviceDate}T${time}:00${sign}${String(Math.floor(magnitude / 60)).padStart(2, "0")}:${String(magnitude % 60).padStart(2, "0")}`;
}

export function buildCpuXCalendarEventResource(order: ProductionOrder): CpuXCalendarEventResource {
  const serviceDate = order.serviceDate || "";
  if (!validDate(serviceDate)) throw Object.assign(new Error("A valid Production Order service date is required for the CPUX Calendar event."), { status: 422 });
  const lines = order.lines.filter((line) => line.workstream === "sandwiches");
  if (!lines.length) throw Object.assign(new Error("The Production Order has no explicitly routed Sandwiches workstream lines."), { status: 422 });
  const times = endTimeFor(order);
  const company = String(order.clientName || "FIKA Booking").replace(/[\r\n]+/g, " ").trim().slice(0, 120);
  const pax = Number.isFinite(order.guestCount) && Number(order.guestCount) > 0 ? ` x ${order.guestCount}` : "";
  const descriptionLines = [
    "FIKA OS CPU order — outbound Calendar visibility only.",
    `Canonical Production Order: ${order.canonicalId}`,
    `FIKA status: ${order.status}`,
    `Service date: ${order.serviceDate}`,
    `Service time: ${times.start}–${times.end} (Europe/London)`,
    `Destination: ${order.destinationLabel || order.destinationAddress?.label || "Not supplied"}`,
    "Sandwich workstream items:",
    ...lines.map((line) => `• ${line.itemName}: ${line.customerQuantity} ${line.customerUnit}${line.productionInstructions ? ` — ${line.productionInstructions}` : ""}`),
  ];
  return {
    id: cpuxCalendarEventId(order.canonicalId),
    summary: `FIKA Sandwich Lunch — ${company}${pax}`,
    description: descriptionLines.join("\n").slice(0, 8000),
    ...(order.destinationLabel || order.destinationAddress?.label ? { location: order.destinationLabel || order.destinationAddress?.label } : {}),
    start: { dateTime: londonDateTime(serviceDate, times.start), timeZone: CPUX_CALENDAR_TIME_ZONE },
    end: { dateTime: londonDateTime(serviceDate, times.end), timeZone: CPUX_CALENDAR_TIME_ZONE },
    extendedProperties: { private: { fikaSource: "fika-os-cpu", canonicalOrderId: order.canonicalId, sourceVersion: String(order.version), workstream: "sandwiches" } },
  };
}

type CalendarFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type CpuXCalendarApiDependencies = {
  calendarId?: string;
  environment?: CpuXCalendarRuntimeEnvironment;
  getAccessToken?: () => Promise<string>;
  fetcher?: CalendarFetch;
};

async function defaultAccessToken() {
  const auth = new GoogleAuth({ scopes: [CPUX_CALENDAR_EVENTS_SCOPE] });
  const token = await auth.getAccessToken();
  if (!token) throw Object.assign(new Error("The CPU runtime service account did not return a Calendar access token."), { status: 503 });
  return token;
}

function calendarTarget(calendarId?: string) {
  const id = (calendarId || process.env.FIKA_CPUX_CALENDAR_ID || "").trim();
  if (!id) throw Object.assign(new Error("FIKA_CPUX_CALENDAR_ID is not configured."), { status: 503 });
  return `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events`;
}

async function apiCall(url: string, method: string, body: unknown, dependencies: CpuXCalendarApiDependencies) {
  const token = await (dependencies.getAccessToken || defaultAccessToken)();
  const response = await (dependencies.fetcher || fetch)(url, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: "application/json", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(8_000),
  });
  return response;
}

function calendarFailure(response: Response) {
  return Object.assign(new Error(`Google Calendar API returned HTTP ${response.status}.`), { status: 502, code: "CPUX_CALENDAR_API_FAILURE" });
}

export async function applyCpuXCalendarOrder(order: ProductionOrder, dependencies: CpuXCalendarApiDependencies = {}) {
  const environment = dependencies.environment || process.env;
  if (!cpuXCalendarWritesEnabled(environment)) throw Object.assign(new Error("CPUX Calendar writes are disabled outside the explicitly enabled production runtime."), { status: 503 });
  const configuredCalendarId = environment.FIKA_CPUX_CALENDAR_ID?.trim();
  if (dependencies.calendarId && dependencies.calendarId.trim() !== configuredCalendarId) {
    throw Object.assign(new Error("A Calendar ID override does not match the explicitly configured production Calendar."), { status: 503 });
  }
  const collection = calendarTarget(configuredCalendarId);
  const eventId = cpuxCalendarEventId(order.canonicalId);
  const eventUrl = `${collection}/${encodeURIComponent(eventId)}`;
  const operation = operationFor(order);
  if (operation === "delete") {
    const deleted = await apiCall(`${eventUrl}?sendUpdates=none`, "DELETE", undefined, dependencies);
    if (deleted.status === 404 || deleted.status === 410) return { operation, eventId, applied: false };
    if (!deleted.ok) throw calendarFailure(deleted);
    return { operation, eventId, applied: true };
  }

  const resource = buildCpuXCalendarEventResource(order);
  const patchUrl = `${eventUrl}?sendUpdates=none`;
  const patched = await apiCall(patchUrl, "PATCH", resource, dependencies);
  if (patched.ok) return { operation, eventId, applied: true };
  if (patched.status !== 404) throw calendarFailure(patched);

  const inserted = await apiCall(`${collection}?sendUpdates=none`, "POST", resource, dependencies);
  if (inserted.ok) return { operation, eventId, applied: true };
  if (inserted.status === 409) {
    const retryPatch = await apiCall(patchUrl, "PATCH", resource, dependencies);
    if (retryPatch.ok) return { operation, eventId, applied: true };
    throw calendarFailure(retryPatch);
  }
  throw calendarFailure(inserted);
}
