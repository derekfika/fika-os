import { randomUUID } from "node:crypto";
import { digest, documentUrl, isDriveId, isWorkspaceEmail, MIRROR_ORIGIN, mirrorEventId, mirrorRecipients, mirrorResource, type MirrorDetails, type MirrorDocument, type MirrorSource, type MirrorTarget } from "./contract";

type Env = Readonly<Record<string, string | undefined>>;
type Fetch = typeof fetch;
const GOOGLE = "https://www.googleapis.com";
const CALENDAR = "https://www.googleapis.com/auth/calendar.events";
const CALENDAR_READ = "https://www.googleapis.com/auth/calendar.events.readonly";
const CALENDAR_LIST_READ = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const DRIVE_READ = "https://www.googleapis.com/auth/drive.readonly";
const DRIVE_WRITE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const allowedId = (value: unknown): value is string =>
  typeof value === "string" && value !== "primary" && /^[a-zA-Z0-9_.+@-]{3,256}$/.test(value);

function productionRuntime(env: Env) {
  return env.FIKA_RUNTIME_MODE === "production" && env.FIREBASE_PROJECT_ID === "fika-os" &&
    !env.FIRESTORE_EMULATOR_HOST && !env.FIREBASE_AUTH_EMULATOR_HOST && env.NODE_ENV === "production";
}

export function mirrorEnabled(env: Env = process.env) {
  return productionRuntime(env) && env.FIKA_CPUX_MIRROR_WRITES_ENABLED === "true";
}

export function mirrorPreviewEnabled(env: Env = process.env) {
  return productionRuntime(env) && (env.FIKA_CPUX_MIRROR_PREVIEW_ENABLED === "true" || mirrorEnabled(env));
}

export function configuredMirrorTarget(stream: MirrorSource["stream"], site: string | undefined, env: Env = process.env): MirrorTarget {
  if (stream === "hospitality") throw new Error("Hospitality Calendars must use the canonical Workspace identity resolver.");
  const values = { calendarId: env.FIKA_CPUX_DELIVERED_IN_CALENDAR_ID, subject: env.FIKA_CPUX_DELIVERED_IN_CALENDAR_SUBJECT };
  const logistics = env.FIKA_CPUX_LOGISTICS_MAILBOX || "";
  if (!allowedId(values?.calendarId) || !isWorkspaceEmail(values?.subject)) throw new Error("The approved Calendar organiser is not configured.");
  const result = { calendarId: values.calendarId, subject: values.subject, logistics };
  if (mirrorRecipients(result).includes(result.calendarId.toLowerCase()) || mirrorRecipients(result).includes(result.subject))
    throw new Error("A recipient cannot be the configured organiser.");
  return result;
}

export type MirrorObservation = { disposition: "create" | "update" | "cancel" | "unchanged" | "skip"; eventId: string };
export type MirrorEventEvidence = {
  id: string; iCalUID?: string; status?: string; summary?: string; description?: string; location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string }; end?: { date?: string; dateTime?: string; timeZone?: string };
  htmlLink?: string; organizer?: { email?: string; self?: boolean };
  attendees: Array<{ email?: string; responseStatus?: string; self?: boolean; organizer?: boolean }>;
  attachments: Array<{ fileId?: string; title?: string; fileUrl?: string }>;
};
export type MirrorAttendeeCopy = {
  email: string; status: "found" | "missing" | "duplicate" | "unavailable"; responseStatus?: string;
  event?: MirrorEventEvidence; errorCode?: string;
};
type Event = {
  id?: string; etag?: string; iCalUID?: string; htmlLink?: string; summary?: string; description?: string; location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string }; end?: { date?: string; dateTime?: string; timeZone?: string };
  status?: string; organizer?: { self?: boolean; email?: string };
  attendees?: Array<{ email?: string; responseStatus?: string; organizer?: boolean; self?: boolean }>;
  attachments?: Array<{ fileId?: string; title?: string; fileUrl?: string }>;
  attendeesOmitted?: boolean;
  extendedProperties?: { shared?: Record<string, string> };
};
const privacySafeError = (response: Response) => new Error("Google Calendar or Drive refused the operation (HTTP " + response.status + ").");

export async function openMirrorClient(target: MirrorTarget, env: Env = process.env, fetcher: Fetch = fetch, readOnly = false) {
  if (!(readOnly ? mirrorPreviewEnabled(env) : mirrorEnabled(env))) throw new Error("Calendar mirror delivery is disabled for this runtime.");
  const assertWrite = () => { if (readOnly) throw new Error("Calendar preview cannot write."); };
  const runtimeIdentity = env.FIKA_CPUX_MIRROR_RUNTIME_IDENTITY;
  if (!runtimeIdentity || !/^[a-z0-9-]+@fika-os\.iam\.gserviceaccount\.com$/.test(runtimeIdentity)) throw new Error("An approved production runtime identity is required.");
  async function metadata(resource: string) {
    const response = await fetcher("http://metadata.google.internal/computeMetadata/v1/" + resource, { headers: { "Metadata-Flavor": "Google" }, redirect: "error", signal: AbortSignal.timeout(3000) });
    if (!response.ok || response.headers.get("Metadata-Flavor") !== "Google") throw new Error("Runtime identity could not be verified.");
    return response;
  }
  const [project, identity] = await Promise.all([metadata("project/project-id"), metadata("instance/service-accounts/default/email")]);
  if ((await project.text()).trim() !== "fika-os" || (await identity.text()).trim() !== runtimeIdentity)
    throw new Error("Calendar mirror is restricted to the approved production service.");
  const recipients = mirrorRecipients(target);
  const issuer = env.FIKA_CPUX_MIRROR_DWD_ISSUER;
  if (!issuer || issuer === runtimeIdentity || !/^[a-z0-9-]+@fika-os\.iam\.gserviceaccount\.com$/.test(issuer))
    throw new Error("A dedicated Calendar delegation issuer is required.");
  const signingUrl = "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/" + encodeURIComponent(issuer) + ":signJwt";
  let signerAccess: Promise<string> | undefined;
  async function signerToken() {
    const result = await metadata("instance/service-accounts/default/token");
    const { access_token } = await result.json() as { access_token?: string };
    if (!access_token) throw new Error("The verified runtime could not authenticate to IAM.");
    return access_token;
  }
  const tokens = new Map<string, Promise<string>>();
  function token(subject: string, scope: string) {
    const key = subject + ":" + scope;
    const existing = tokens.get(key);
    if (existing) return existing;
    const pending = (async () => {
      const iat = Math.floor(Date.now() / 1000);
      const claims = { iss: issuer, sub: subject, scope, aud: "https://oauth2.googleapis.com/token", iat, exp: iat + 600 };
      const signed = await fetcher(signingUrl, {
        method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + await (signerAccess ||= signerToken()) },
        body: JSON.stringify({ payload: JSON.stringify(claims) }), redirect: "error", signal: AbortSignal.timeout(8000),
      });
      if (!signed.ok) throw new Error("IAM refused to sign the Calendar delegation request.");
      const { signedJwt: assertion } = await signed.json() as { signedJwt?: string };
      if (!assertion) throw new Error("IAM returned no signed Calendar delegation request.");
      const result = await fetcher("https://oauth2.googleapis.com/token", {
        method: "POST", body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
        redirect: "error", signal: AbortSignal.timeout(8000),
      });
      if (!result.ok) throw new Error("Calendar/Drive delegation failed.");
      const { access_token, scope: grantedScope } = await result.json() as { access_token?: string; scope?: string };
      if (!access_token || (grantedScope !== undefined && grantedScope !== scope)) throw new Error("Calendar/Drive delegation returned invalid token evidence.");
      return access_token;
    })();
    tokens.set(key, pending);
    return pending;
  }

  async function request(path: string, scope: string, subject: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("authorization", "Bearer " + await token(subject, scope));
    return fetcher(GOOGLE + path, { ...init, headers, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(8000) });
  }
  let calendarBindingCheck: Promise<{ calendarId: string; subject: string; accessRole: "writer" | "owner" }> | undefined;
  async function verifyCalendarBinding() {
    return calendarBindingCheck ||= (async () => {
      const path = "/calendar/v3/users/me/calendarList/" + encodeURIComponent(target.calendarId) + "?fields=id,accessRole";
      const response = await request(path, CALENDAR_LIST_READ, target.subject);
      if (!response.ok) throw new Error("The delegated organiser cannot access the configured Calendar (HTTP " + response.status + ").");
      const binding = await response.json() as { id?: string; accessRole?: string };
      if (binding.id !== target.calendarId || !(binding.accessRole === "writer" || binding.accessRole === "owner"))
        throw new Error("The delegated organiser does not have verified Calendar write access.");
      return { calendarId: target.calendarId, subject: target.subject, accessRole: binding.accessRole };
    })();
  }
  async function verifyFile(fileId: string, mime: string, subjects = recipients) {
    if (!isDriveId(fileId)) throw new Error("The current Drive file is missing.");
    await Promise.all(subjects.map(async (subject) => {
      const response = await request("/drive/v3/files/" + encodeURIComponent(fileId) + "?supportsAllDrives=true&fields=id,mimeType,trashed,capabilities(canDownload)", DRIVE_READ, subject);
      if (!response.ok) throw new Error("The document is not readable by both intended attendees.");
      const file = await response.json() as { id?: string; mimeType?: string; trashed?: boolean; capabilities?: { canDownload?: boolean } };
      if (file.id !== fileId || file.mimeType !== mime || file.trashed === true || (mime === "application/pdf" && file.capabilities?.canDownload !== true)) throw new Error("The Drive document is not a current readable PDF.");
    }));
  }
  const verifiedDocuments = new WeakSet<MirrorDocument>();
  async function verifiedPdf(fileId: string, title: string): Promise<MirrorDocument> {
    await verifyFile(fileId, "application/pdf", [...recipients, target.subject]);
    const response = await request("/drive/v2/files/" + encodeURIComponent(fileId) + "?supportsAllDrives=true&fields=id,mimeType,alternateLink", DRIVE_READ, target.subject);
    if (!response.ok) throw new Error("The Calendar organiser cannot access the approved PDF.");
    const { id, mimeType, alternateLink } = await response.json() as { id?: string; mimeType?: string; alternateLink?: string };
    const link = URL.parse(alternateLink || "");
    if (id !== fileId || mimeType !== "application/pdf" || link?.origin !== "https://drive.google.com" || link.username || link.password ||
        !((link.pathname === "/open" && link.searchParams.get("id") === fileId) || link.pathname === "/file/d/" + fileId + "/view"))
      throw new Error("Drive returned no Calendar-compatible link for the approved PDF.");
    const doc = Object.freeze({ fileId, title, url: documentUrl(fileId), attachmentUrl: link.href });
    verifiedDocuments.add(doc);
    return doc;
  }
  async function verifyRunSheetFolder(folderId: string) {
    await verifyFile(folderId, FOLDER_MIME, [...recipients, target.subject]);
    const response = await request("/drive/v3/files/" + encodeURIComponent(folderId) + "/permissions?supportsAllDrives=true&pageSize=100&fields=nextPageToken,permissions(type,emailAddress,deleted)", DRIVE_READ, target.subject);
    if (!response.ok) throw privacySafeError(response);
    const body = await response.json() as { nextPageToken?: string; permissions?: Array<{ type?: string; emailAddress?: string; deleted?: boolean }> };
    const approved = new Set([...recipients, target.subject]);
    if (body.nextPageToken || !body.permissions?.length || body.permissions.some(permission => !permission.deleted &&
        (permission.type !== "user" || !approved.has(permission.emailAddress?.toLowerCase() || ""))))
      throw new Error("Run sheet folder access is broader than the approved audience or cannot be verified.");
  }
  const collection = "/calendar/v3/calendars/" + encodeURIComponent(target.calendarId) + "/events";
  const readScope = readOnly ? CALENDAR_READ : CALENDAR;
  async function readEvent(id: string) {
    const response = await request(collection + "/" + id, readScope, target.subject);
    if (response.status === 404) return undefined;
    if (!response.ok) throw privacySafeError(response);
    return await response.json() as Event;
  }
  async function findCanonicalEvent(id: string) {
    await verifyCalendarBinding();
    const exact = await readEvent(id);
    if (exact) return exact;
    const params = new URLSearchParams({ sharedExtendedProperty: "fikaMirrorKey=" + id, maxResults: "2", showDeleted: "false" });
    const response = await request(collection + "?" + params, readScope, target.subject);
    if (!response.ok) throw privacySafeError(response);
    const list = await response.json() as { items?: Event[]; nextPageToken?: string };
    if (list.nextPageToken || (list.items?.length || 0) > 1 || list.items?.some(item => item.id !== id))
      throw new Error("A conflicting Calendar identity requires operator review.");
    return list.items?.[0];
  }
  function classify(source: MirrorSource, event: Event | undefined): MirrorObservation {
    const eventId = mirrorEventId(source.stream, source.identity);
    if (!event) return { eventId, disposition: source.withdrawn ? "skip" : "create" };
    const meta = event.extendedProperties?.shared;
    const revision = Number(meta?.fikaMirrorRevision);
    if (event.id !== eventId || event.organizer?.self !== true || event.organizer.email?.toLowerCase() !== target.subject.toLowerCase() || meta?.fikaMirrorOrigin !== MIRROR_ORIGIN ||
        meta?.fikaMirrorKey !== eventId || !Number.isSafeInteger(revision) || revision < 1 || !event.etag)
      throw new Error("An existing event has ambiguous identity or organiser; review is required.");
    const withdrawn = meta.fikaMirrorWithdrawn === "true" || event.status === "cancelled";
    const guests = (event.attendees || []).filter(item => !item.organizer).map(item => item.email?.toLowerCase());
    if (event.attendeesOmitted || new Set(guests).size !== guests.length ||
        guests.some(email => !email || !recipients.includes(email)) ||
        (withdrawn ? guests.length !== 0 : guests.length !== recipients.length))
      throw new Error("The existing event audience does not match the approved recipients.");
    if (revision > source.revision) return { eventId, disposition: "skip" };
    if (revision === source.revision) {
      if (meta.fikaSourceReference !== digest(source.sourceReference) || withdrawn !== source.withdrawn)
        throw new Error("This Calendar event has conflicting source evidence for the same revision.");
      return { eventId, disposition: "unchanged" };
    }
    return { eventId, disposition: source.withdrawn ? "cancel" : "update" };
  }
  async function inspect(source: MirrorSource) {
    return classify(source, await findCanonicalEvent(mirrorEventId(source.stream, source.identity)));
  }
  function eventEvidence(event: Event): MirrorEventEvidence {
    return {
      id: event.id || "",
      ...(event.iCalUID ? { iCalUID: event.iCalUID } : {}),
      ...(event.status ? { status: event.status } : {}),
      ...(event.summary ? { summary: event.summary } : {}),
      ...(event.description ? { description: event.description } : {}),
      ...(event.location ? { location: event.location } : {}),
      ...(event.start ? { start: event.start } : {}),
      ...(event.end ? { end: event.end } : {}),
      ...(event.htmlLink ? { htmlLink: event.htmlLink } : {}),
      ...(event.organizer ? { organizer: event.organizer } : {}),
      attendees: (event.attendees || []).map(({ email, responseStatus, self, organizer }) => ({ email, responseStatus, self, organizer })),
      attachments: (event.attachments || []).map(({ fileId, title, fileUrl }) => ({ fileId, title, fileUrl })),
    };
  }
  async function inspectEvent(source: MirrorSource) {
    const eventId = mirrorEventId(source.stream, source.identity);
    await verifyCalendarBinding();
    const exact = await readEvent(eventId);
    const params = new URLSearchParams({ sharedExtendedProperty: "fikaMirrorKey=" + eventId, maxResults: "3", showDeleted: "false" });
    const response = await request(collection + "?" + params, readScope, target.subject);
    if (!response.ok) throw privacySafeError(response);
    const list = await response.json() as { items?: Event[]; nextPageToken?: string };
    const matches = [...new Map([...(exact ? [exact] : []), ...(list.items || [])].filter((item): item is Event & { id: string } => Boolean(item.id)).map(item => [item.id, item])).values()];
    const identityStatus = list.nextPageToken || matches.length > 1 || matches.some(item => item.id !== eventId) ? "duplicate-or-conflicting" : "unique";
    if (identityStatus !== "unique") return {
      observation: { eventId, disposition: "skip" as const }, identityStatus,
      currentEvent: exact ? eventEvidence(exact) : null, conflictingEvents: matches.map(eventEvidence),
    };
    const event = exact || matches[0];
    return { observation: classify(source, event), identityStatus, currentEvent: event ? eventEvidence(event) : null, conflictingEvents: [] };
  }
  async function inspectAttendeeCopies(source: MirrorSource): Promise<MirrorAttendeeCopy[]> {
    if (!readOnly) throw new Error("Attendee Calendar diagnostics are read-only.");
    const mirrorKey = mirrorEventId(source.stream, source.identity);
    const organizerEvent = await readEvent(mirrorKey);
    const attendees = mirrorRecipients(target);
    return Promise.all(attendees.map(async email => {
      try {
        const fields = "items(id,iCalUID,status,summary,description,location,start,end,htmlLink,organizer(email,self),attendees(email,responseStatus,self,organizer),attachments(fileId,title,fileUrl))";
        const params = new URLSearchParams({ maxResults: "2", showDeleted: "true", fields,
          ...(organizerEvent?.iCalUID ? { iCalUID: organizerEvent.iCalUID } : { sharedExtendedProperty: "fikaMirrorKey=" + mirrorKey }) });
        const response = await request("/calendar/v3/calendars/primary/events?" + params, CALENDAR_READ, email);
        if (!response.ok) return { email, status: "unavailable" as const, errorCode: "ATTENDEE_CALENDAR_READ_FAILED" };
        const events = ((await response.json()) as { items?: Event[] }).items || [];
        if (!events.length) return { email, status: "missing" as const };
        if (events.length > 1) return { email, status: "duplicate" as const };
        const event = events[0];
        if (organizerEvent?.iCalUID && event.iCalUID !== organizerEvent.iCalUID) return { email, status: "unavailable" as const, errorCode: "ATTENDEE_ICALUID_MISMATCH" };
        return { email, status: "found" as const, responseStatus: event.attendees?.find(attendee => attendee.self || attendee.email?.toLowerCase() === email)?.responseStatus, event: eventEvidence(event) };
      } catch {
        return { email, status: "unavailable" as const, errorCode: "ATTENDEE_CALENDAR_READ_FAILED" };
      }
    }));
  }
  async function publish(source: MirrorSource, details?: MirrorDetails, document?: MirrorDocument): Promise<MirrorObservation> {
    assertWrite();
    if (!source.identity || !Number.isSafeInteger(source.revision) || source.revision < 1) throw new Error("Valid canonical source identity and revision are required.");
    const id = mirrorEventId(source.stream, source.identity);
    const event = await findCanonicalEvent(id);
    const plan = classify(source, event);
    if (plan.disposition === "skip" || plan.disposition === "unchanged") return plan;
    if (!source.withdrawn && (!details || !document || !verifiedDocuments.has(document))) throw new Error("A current verified run sheet or quote is required.");
    const resource = source.withdrawn
      // Keep an organiser-only, transparent marker. Google can discard metadata
      // from deleted events, making an intentional republish impossible at this ID.
      ? { status: "confirmed", transparency: "transparent", visibility: "private",
        summary: "Withdrawn FIKA OS demand", description: "This event no longer represents active production.",
        location: "", attendees: [], attachments: [],
        extendedProperties: { shared: { fikaMirrorOrigin: MIRROR_ORIGIN, fikaMirrorKey: id, fikaMirrorRevision: String(source.revision), fikaMirrorWithdrawn: "true", fikaSourceReference: digest(source.sourceReference) } } }
      : mirrorResource(source, details!, document!, target);
    if (!source.withdrawn && event?.attendees && "attendees" in resource) {
      resource.attendees = resource.attendees.map(attendee => ({
        ...attendee,
        ...(event.attendees?.find(current => current.email?.toLowerCase() === attendee.email)?.responseStatus
          ? { responseStatus: event.attendees.find(current => current.email?.toLowerCase() === attendee.email)!.responseStatus } : {}),
      }));
    }
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (event?.etag) headers["if-match"] = event.etag;
    const response = await request(collection + (event ? "/" + id : "") + "?supportsAttachments=true&sendUpdates=all", CALENDAR, target.subject,
      { method: event ? "PATCH" : "POST", headers, body: JSON.stringify(resource) });
    if (response.ok) {
      const saved = await response.json() as Event;
      if (saved.id !== id || saved.organizer?.self !== true || saved.organizer.email?.toLowerCase() !== target.subject.toLowerCase())
        throw new Error("Calendar did not confirm the configured delegated organiser for the saved event.");
      return plan;
    }
    if (response.status === 409 || response.status === 412) {
      const after = await inspect(source);
      if (after.disposition === "unchanged" || after.disposition === "skip") return after;
    }
    throw privacySafeError(response);
  }
  async function allocatePdfId() {
    assertWrite();
    const response = await request("/drive/v3/files/generateIds?count=1&space=drive", DRIVE_WRITE, target.subject);
    if (!response.ok) throw privacySafeError(response);
    const id = (await response.json() as { ids?: string[] }).ids?.[0];
    if (!isDriveId(id)) throw new Error("Drive returned no reservable document ID.");
    return id;
  }
  async function storeRunSheet(fileId: string, folderId: string, revision: string, title: string, render: () => Promise<Buffer>) {
    assertWrite();
    await verifyRunSheetFolder(folderId);
    const path = "/drive/v3/files/" + encodeURIComponent(fileId) + "?supportsAllDrives=true&fields=id,parents,appProperties,mimeType,trashed";
    const verifyStored = async (response: Response) => {
      if (!response.ok) throw privacySafeError(response);
      const stored = await response.json() as { id?: string; parents?: string[]; appProperties?: Record<string, string>; mimeType?: string; trashed?: boolean };
      if (stored.id !== fileId || stored.parents?.length !== 1 || stored.parents[0] !== folderId || stored.appProperties?.fikaRunSheetRevision !== revision ||
          stored.mimeType !== "application/pdf" || stored.trashed) throw new Error("The reserved run sheet does not match the authoritative publication.");
    };
    const existing = await request(path, DRIVE_WRITE, target.subject);
    if (existing.status !== 404) {
      await verifyStored(existing);
      return verifiedPdf(fileId, title);
    }
    const pdf = await render();
    if (pdf.subarray(0, 5).toString() !== "%PDF-" || pdf.length > 8 * 1024 * 1024) throw new Error("The run sheet renderer did not return a usable PDF.");
    const boundary = "fika-" + randomUUID();
    const meta = { id: fileId, name: title, mimeType: "application/pdf", parents: [folderId], appProperties: { fikaRunSheetRevision: revision } };
    const body = Buffer.concat([Buffer.from("--" + boundary + "\r\nContent-Type: application/json\r\n\r\n" + JSON.stringify(meta) + "\r\n--" + boundary + "\r\nContent-Type: application/pdf\r\n\r\n"), pdf, Buffer.from("\r\n--" + boundary + "--\r\n")]);
    const written = await request("/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,parents,appProperties,mimeType,trashed",
      DRIVE_WRITE, target.subject, { method: "POST", headers: { "content-type": "multipart/related; boundary=" + boundary }, body: new Uint8Array(body) });
    await verifyStored(written.status === 409 ? await request(path, DRIVE_WRITE, target.subject) : written);
    return verifiedPdf(fileId, title);
  }
  return { inspect, inspectEvent, inspectAttendeeCopies, publish, verifiedPdf, allocatePdfId, storeRunSheet, verifyRunSheetFolder, verifyCalendarBinding };
}
