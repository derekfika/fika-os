import { createHash } from "node:crypto";

export const CPUX_ATTENDEE = "cpux@fikacatering.com";
export const MIRROR_ORIGIN = "fika-os-cpux-mirror-v1";
export const BACKFILL_START = "2026-11-09";
export const TIME_ZONE = "Europe/London";
const DAY = 86_400_000;

export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const mirrorEventId = (stream: "hospitality" | "delivered-in", identity: string) =>
  "fika" + digest([MIRROR_ORIGIN, stream, identity]);

export function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("A valid ISO service date is required.");
  const time = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value)
    throw new Error("A valid ISO service date is required.");
  return time;
}

export const nextCalendarDate = (value: string) => new Date(calendarDate(value) + DAY).toISOString().slice(0, 10);

export function backfillDates(from: string, through: string) {
  const first = calendarDate(from);
  const last = calendarDate(through);
  if (from < BACKFILL_START || last < first || last - first >= 14 * DAY)
    throw new Error("Select an inclusive range of at most 14 service days starting on or after 2026-11-09.");
  return Array.from({ length: (last - first) / DAY + 1 }, (_, index) => new Date(first + index * DAY).toISOString().slice(0, 10));
}

const london = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function londonServiceDate(at: Date) {
  if (!Number.isFinite(at.getTime())) return;
  const parts = Object.fromEntries(london.formatToParts(at).map(part => [part.type, part.value]));
  return parts.year + "-" + parts.month + "-" + parts.day;
}

export function londonTimestamp(date: string, clock: string) {
  calendarDate(date);
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(clock)) throw new Error("A valid local service time is required.");
  const wall = date + "T" + clock;
  const naive = Date.parse(wall + ":00Z");
  const matches = [naive, naive - 3600_000].filter(time => {
    const parts = Object.fromEntries(london.formatToParts(time).map(part => [part.type, part.value]));
    return parts.year + "-" + parts.month + "-" + parts.day + "T" + parts.hour + ":" + parts.minute === wall;
  });
  if (matches.length !== 1) throw new Error("The local service time is ambiguous or missing at the UK clock change.");
  return new Date(matches[0]).toISOString();
}

export type MirrorDocument = { fileId: string; title: string; url: string; attachmentUrl: string };
export type MirrorSource = {
  stream: "hospitality" | "delivered-in";
  identity: string;
  /** Monotonic within this event identity. */
  revision: number;
  sourceReference: string;
  withdrawn: boolean;
};
export type MirrorDetails = {
  summary: string;
  description: string;
  location?: string;
  start: { date: string } | { dateTime: string; timeZone: typeof TIME_ZONE };
  end: { date: string } | { dateTime: string; timeZone: typeof TIME_ZONE };
};
export type MirrorTarget = { calendarId: string; subject: string; logistics: string };
export const documentUrl = (id: string) => "https://drive.google.com/file/d/" + encodeURIComponent(id) + "/view";
export const isDriveId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{10,150}$/.test(id);
export const isWorkspaceEmail = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9._+-]*@fikacatering\.com$/.test(value);
export function mirrorRecipients(target: MirrorTarget) {
  if (!isWorkspaceEmail(target.logistics) || target.logistics === CPUX_ATTENDEE) throw new Error("A distinct verified Logistics mailbox is required.");
  return [CPUX_ATTENDEE, target.logistics];
}
export function mirrorResource(source: MirrorSource, details: MirrorDetails, document: MirrorDocument, target: MirrorTarget) {
  if (source.withdrawn || !isDriveId(document.fileId) || document.url !== documentUrl(document.fileId))
    throw new Error("A verified current PDF is required for active Calendar demand.");
  const id = mirrorEventId(source.stream, source.identity);
  return {
    id, status: "confirmed", ...details,
    description: (details.description + "\n\n" + document.title + ": " + document.url).replace(/[&<>]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]!),
    visibility: "private",
    transparency: "opaque",
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    attendees: mirrorRecipients(target).map(email => ({ email })),
    attachments: [{ fileUrl: document.attachmentUrl, title: document.title, mimeType: "application/pdf" }],
    extendedProperties: { shared: { fikaMirrorOrigin: MIRROR_ORIGIN, fikaMirrorKey: id, fikaMirrorRevision: String(source.revision), fikaMirrorWithdrawn: "false", fikaSourceReference: digest(source.sourceReference) } },
  };
}
