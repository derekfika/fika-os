import { isWorkspaceEmail, type MirrorTarget } from "../../shared/cpux-calendar/contract";
import { hospitalityWorkspaceMailbox, HOSPITALITY_EMAIL_SITE_IDENTITIES } from "./booking-email-site-identities";

type Env = Readonly<Record<string, string | undefined>>;
type CalendarOverride = { calendarId?: unknown; delegatedOrganizerMailbox?: unknown };

const validCalendarId = (value: unknown): value is string =>
  typeof value === "string" && value.trim() === value && value !== "primary" && /^[a-zA-Z0-9_.+@-]{3,256}$/.test(value);

function calendarOverrides(env: Env): Record<string, CalendarOverride> {
  let value: unknown;
  try { value = JSON.parse(env.FIKA_CPUX_HOSPITALITY_CALENDARS_JSON || "{}"); }
  catch { throw new Error("Hospitality Calendar override configuration is invalid."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Hospitality Calendar override configuration is invalid.");
  for (const [oplocId, raw] of Object.entries(value)) {
    if (!Object.hasOwn(HOSPITALITY_EMAIL_SITE_IDENTITIES, oplocId) || !raw || typeof raw !== "object" || Array.isArray(raw))
      throw new Error("Hospitality Calendar override configuration contains an unknown OPLOC.");
    const record = raw as Record<string, unknown>;
    if (Object.keys(record).some(key => !["calendarId", "delegatedOrganizerMailbox"].includes(key)) ||
      (record.calendarId !== undefined && !validCalendarId(record.calendarId)) ||
      (record.delegatedOrganizerMailbox !== undefined && !isWorkspaceEmail(record.delegatedOrganizerMailbox)))
      throw new Error("Hospitality Calendar override configuration is invalid.");
  }
  return value as Record<string, CalendarOverride>;
}

export function hospitalityCalendarSiteEnabled(oplocId: string | undefined, env: Env = process.env) {
  return Boolean(oplocId && Object.hasOwn(HOSPITALITY_EMAIL_SITE_IDENTITIES, oplocId) &&
    env.FIKA_CPUX_HOSPITALITY_ALLOWED_OPLOC?.trim() === oplocId);
}

/**
 * Resolve site mail identity from the canonical booking-email source. Runtime JSON contains only
 * explicit Calendar/organiser overrides; a mailbox address by itself never proves Calendar access.
 */
export function resolveHospitalityCalendarTarget(oplocId: string, env: Env = process.env): MirrorTarget {
  const mailbox = hospitalityWorkspaceMailbox(oplocId);
  const override = calendarOverrides(env)[oplocId];
  const calendarId = override?.calendarId ?? mailbox;
  const subject = typeof override?.delegatedOrganizerMailbox === "string"
    ? override.delegatedOrganizerMailbox.toLowerCase()
    : mailbox;
  if (!validCalendarId(calendarId) || !isWorkspaceEmail(subject)) throw new Error("The approved Hospitality Calendar binding is not configured.");
  if (override?.delegatedOrganizerMailbox && subject === mailbox)
    throw new Error("Remove the redundant delegated organiser override; the canonical Workspace mailbox is the default.");
  const logistics = env.FIKA_CPUX_LOGISTICS_MAILBOX?.trim().toLowerCase() || "";
  return { calendarId, subject, logistics };
}
