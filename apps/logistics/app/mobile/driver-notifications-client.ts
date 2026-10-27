export type DriverNoticeItem = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  priority: "normal" | "high";
  serviceDate: string;
  runId: string;
  createdAt: string;
  readAt?: string;
};

export type DriverInbox = { vehicleId: "van1" | "van2"; unreadCount: number; items: DriverNoticeItem[] };

const ENDPOINT = "/api/logistics/driver-notifications";

async function parse(response: Response): Promise<DriverInbox> {
  const body = await response.json().catch(() => null) as (DriverInbox & { error?: { message?: string } }) | null;
  if (!response.ok || !body || !Array.isArray(body.items)) throw new Error(body?.error?.message || "Notifications could not be loaded.");
  return { vehicleId: body.vehicleId, unreadCount: body.unreadCount, items: body.items };
}

/** The history lives on the server, not in this browser, so it survives restarts and a different device for the same van. */
export async function fetchInbox(headers: HeadersInit): Promise<DriverInbox> {
  return parse(await fetch(ENDPOINT, { cache: "no-store", headers }));
}

export async function postInboxAction(headers: HeadersInit, body: { action: "mark-read"; id: string } | { action: "mark-all-read" } | { action: "process-pending" }): Promise<DriverInbox> {
  return parse(await fetch(ENDPOINT, { method: "POST", cache: "no-store", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
}

export type NoticeTarget =
  | { state: "current"; runId: string }
  | { state: "changed" };

/**
 * Where tapping a notification should land, decided from the freshly loaded authoritative runs, never from the notification's
 * own payload. If the referenced run is no longer on this vehicle's schedule, the driver is told so and shown the current run.
 */
export function resolveNoticeTarget(item: Pick<DriverNoticeItem, "runId" | "serviceDate">, runs: Array<{ canonicalId: string }>, loadedServiceDate: string | undefined): NoticeTarget {
  if (loadedServiceDate !== item.serviceDate) return { state: "changed" };
  return runs.some(run => run.canonicalId === item.runId) ? { state: "current", runId: item.runId } : { state: "changed" };
}

export const NOTICE_CHANGED_MESSAGE = "This run has changed since the notification was sent. Showing your current run.";

const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false });
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
const shortDay = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" });

/** "14:32" for today in Europe/London, otherwise "Tue 27 Oct, 14:32". */
export function formatNoticeTime(createdAt: string, now = new Date()): string {
  const when = new Date(createdAt);
  if (Number.isNaN(when.getTime())) return "";
  return day.format(when) === day.format(now) ? clock.format(when) : `${shortDay.format(when)}, ${clock.format(when)}`;
}

export const unreadLabel = (count: number) => (count > 99 ? "99+" : String(count));
