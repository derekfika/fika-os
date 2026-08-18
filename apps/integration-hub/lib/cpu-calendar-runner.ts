import fs from "node:fs/promises";
import path from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./firebase-admin";
import { parseAngelCourtWorkbook, type AngelCourtInboxMetadata } from "./angel-court-inbox";
import { ingestMnkBooking, type MnkBookingPayload } from "./hospitality-booking-service";
import { hydrateCalendarAttachments, listCpuCalendarEvents } from "./google-calendar-client";

export const CPU_CALENDAR_ADAPTER_VERSION = "fika.cpu-calendar-adapter.v1";
export const CPU_CALENDAR_ID = "cpux@fikacatering.com";
const STATE_ID = "cpux";

export type CpuCalendarEvent = {
  id: string;
  calendarId?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  updated?: string;
  htmlLink?: string;
  attachments?: Array<{ fileName?: string; title?: string; path?: string; contentBase64?: string }>;
};

export type CpuCalendarScanResult = {
  runId: string;
  calendarId: string;
  events: number;
  imported: number;
  updated: number;
  skipped: number;
  review: number;
  lastScanAt: string;
  state: "succeeded" | "failed";
};

export function makeCpuCalendarSourceKey(calendarId: string, eventId: string) {
  return `calendar:${calendarId}:${eventId}`;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function eventDate(event: CpuCalendarEvent) {
  return String(event.start?.dateTime || event.start?.date || "").slice(0, 10);
}

function eventTime(event: CpuCalendarEvent) {
  const value = String(event.start?.dateTime || "");
  const match = value.match(/T(\d{2}:\d{2})/);
  return match?.[1] || "09:00";
}

function attachmentBuffer(attachment: NonNullable<CpuCalendarEvent["attachments"]>[number]) {
  if (attachment.contentBase64) return Buffer.from(attachment.contentBase64, "base64");
  if (attachment.path) return fs.readFile(path.resolve(attachment.path));
  return undefined;
}

export function calendarEventPayload(event: CpuCalendarEvent, candidate: ReturnType<typeof parseAngelCourtWorkbook>, now: string): MnkBookingPayload {
  const sourceBookingId = makeCpuCalendarSourceKey(CPU_CALENDAR_ID, event.id);
  const items = candidate.items.map((item) => {
    const quantity = Number(item.quantity);
    const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
    const itemName = item.name.trim();
    return { itemId: `legacy:${slug(itemName)}`, itemName, description: item.details, unitPrice: 0, quantity: safeQuantity, lineTotal: 0, ...(item.category ? { category: item.category } : {}) };
  });
  return {
    bookingId: sourceBookingId,
    submittedAt: event.updated || now,
    site: candidate.location,
    siteId: slug(candidate.location),
    client: {
      name: candidate.hostName || candidate.clientName || "Legacy calendar requester",
      email: candidate.email || "legacy-calendar@invalid.local",
      phone: candidate.phone || undefined,
      requester: { name: candidate.hostName || candidate.clientName || "Legacy calendar requester", email: candidate.email || "legacy-calendar@invalid.local", phone: candidate.phone || undefined, companyName: candidate.clientName || candidate.location },
      companyName: candidate.clientName || candidate.location,
    },
    event: { eventDate: candidate.eventDate || eventDate(event), startTime: candidate.serviceTime || eventTime(event), guestCount: candidate.guestCount && candidate.guestCount > 0 ? candidate.guestCount : 1, roomOrArea: candidate.roomOrArea || undefined, deliveryPoint: candidate.roomOrArea || undefined },
    order: { eventType: "CPU calendar booking", items, netTotal: 0, vatNote: "Commercial values retained as calendar evidence; review before quoting." },
    dietaries: {}, acknowledgements: {},
    specialInstructions: [candidate.notes, `CPU calendar event: ${event.id}`, event.location ? `Calendar location: ${event.location}` : ""].filter(Boolean).join(" ") || undefined,
  };
}

async function readSnapshot(now = new Date()) {
  if (process.env.CPU_CALENDAR_SNAPSHOT_JSON) {
    const value = JSON.parse(process.env.CPU_CALENDAR_SNAPSHOT_JSON);
    return (Array.isArray(value) ? value : value.events) as CpuCalendarEvent[];
  }
  const configured = process.env.CPU_CALENDAR_SNAPSHOT_FILE;
  if (!configured && !process.env.CPU_CALENDAR_SNAPSHOT_JSON) {
    const lookback = Number(process.env.CPU_CALENDAR_LOOKBACK_DAYS || 7);
    const lookahead = Number(process.env.CPU_CALENDAR_LOOKAHEAD_DAYS || 60);
    return hydrateCalendarAttachments(await listCpuCalendarEvents(CPU_CALENDAR_ID, {
      timeMin: new Date(now.getTime() - lookback * 86_400_000),
      timeMax: new Date(now.getTime() + lookahead * 86_400_000),
    }));
  }
  const snapshotFile = configured || path.join(process.cwd(), "..", "..", "fixtures", "cpu-calendar-snapshot.json");
  try {
    const value = JSON.parse(await fs.readFile(path.resolve(snapshotFile), "utf8"));
    return (Array.isArray(value) ? value : value.events) as CpuCalendarEvent[];
  } catch (error) {
    throw new Error(`CPUX calendar snapshot is not configured or could not be read. Set CPU_CALENDAR_SNAPSHOT_FILE for local development, or authorise the live Calendar adapter with npm run auth:cpu-calendar. ${error instanceof Error ? error.message : ""}`.trim());
  }
}

export async function runCpuCalendarScan(options: { force?: boolean; now?: Date } = {}): Promise<CpuCalendarScanResult> {
  const now = options.now || new Date();
  const startedAt = now.toISOString();
  const stateRef = db.collection("cpuCalendarState").doc(STATE_ID);
  const previous = await stateRef.get();
  const lastScanAt = previous.exists ? String(previous.get("lastScanAt") || "") : "";
  const events = await readSnapshot(now);
  const processedSnapshot = await db.collection("cpuCalendarCandidates").select("sourceKey").get();
  const processed = new Set(processedSnapshot.docs.map((doc) => String(doc.get("sourceKey"))));
  const run = await db.collection("cpuCalendarRuns").add({ adapterVersion: CPU_CALENDAR_ADAPTER_VERSION, calendarId: CPU_CALENDAR_ID, sourceCount: events.length, startedAt, createdAt: FieldValue.serverTimestamp() });
  let imported = 0; let updated = 0; let review = 0; let skipped = 0;
  try {
    for (const event of events) {
      const sourceKey = makeCpuCalendarSourceKey(CPU_CALENDAR_ID, event.id);
      if (!options.force && processed.has(sourceKey) && (!event.updated || !lastScanAt || event.updated <= lastScanAt)) { skipped += 1; continue; }
      if (event.status === "cancelled") { skipped += 1; continue; }
      const attachment = event.attachments?.[0];
      const buffer = attachment ? await attachmentBuffer(attachment) : undefined;
      const metadata: AngelCourtInboxMetadata = { messageId: event.id, attachmentName: attachment?.fileName || attachment?.title || "calendar-event", receivedAt: event.updated, location: event.location || "CPUX" };
      const candidate = buffer ? parseAngelCourtWorkbook(await buffer, metadata) : parseAngelCourtWorkbook(Buffer.from(`Event: ${event.summary || "CPU booking"}\nDate: ${eventDate(event)}\nService time: ${eventTime(event)}\n`), metadata);
      const payload = calendarEventPayload(event, candidate, startedAt);
      const needsReview = candidate.warnings.length > 0 || candidate.items.length === 0;
      const ref = db.collection("cpuCalendarCandidates").doc(sourceKey.replace(/[^A-Za-z0-9_-]/g, "_"));
      if (needsReview) { review += 1; await ref.set({ sourceKey, calendarId: CPU_CALENDAR_ID, calendarEventId: event.id, event, candidate, sourcePayload: payload, runId: run.id, reviewState: "needs_review", updatedAt: FieldValue.serverTimestamp() }, { merge: true }); continue; }
      const result = await ingestMnkBooking(payload);
      if (result.created) imported += 1; else updated += 1;
      await ref.set({ sourceKey, calendarId: CPU_CALENDAR_ID, calendarEventId: event.id, event, candidate, sourcePayload: payload, canonicalBookingId: result.booking.canonicalId, runId: run.id, reviewState: "ingested", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    }
    const completedAt = new Date().toISOString();
    await run.update({ importedCount: imported, updatedCount: updated, reviewCount: review, skippedCount: skipped, completedAt, state: "succeeded" });
    await stateRef.set({ source: "cpux-calendar", calendarId: CPU_CALENDAR_ID, lastScanAt: completedAt, lastSuccessfulScanAt: completedAt, lastAttemptAt: startedAt, status: "succeeded", runId: run.id, imported, updated, review, skipped, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { runId: run.id, calendarId: CPU_CALENDAR_ID, events: events.length, imported, updated, skipped, review, lastScanAt: completedAt, state: "succeeded" };
  } catch (error) {
    await stateRef.set({ source: "cpux-calendar", calendarId: CPU_CALENDAR_ID, lastAttemptAt: startedAt, status: "failed", error: error instanceof Error ? error.message : String(error), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    throw error;
  }
}

export async function getCpuCalendarScanState() {
  const snapshot = await db.collection("cpuCalendarState").doc(STATE_ID).get();
  return snapshot.exists ? snapshot.data() : { source: "cpux-calendar", calendarId: CPU_CALENDAR_ID, status: "never_run" };
}
