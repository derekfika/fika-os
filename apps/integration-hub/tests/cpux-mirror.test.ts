import assert from "node:assert/strict";
import test from "node:test";
import { backfillDates, documentUrl, londonServiceDate, londonTimestamp, mirrorEventId, TIME_ZONE } from "../../shared/cpux-calendar/contract";
import { openMirrorClient } from "../../shared/cpux-calendar/google";
import { hospitalityCalendarSiteEnabled, resolveHospitalityCalendarTarget } from "../lib/hospitality-calendar-integration";
import { HOSPITALITY_EMAIL_SITE_IDENTITIES, RCOA_HOSPITALITY_OPLOC_ID } from "../lib/booking-email-site-identities";
import { hasCurrentHospitalityHandoff, hospitalityMirrorSource } from "../lib/cpux-mirror/source";
import type { CanonicalBooking } from "../lib/hospitality-booking-service";
import type { ProductionOrder } from "../lib/production-domain";

const identity = "mirror-test@fika-os.iam.gserviceaccount.com";
const issuer = "mirror-dwd-test@fika-os.iam.gserviceaccount.com";
const target = { calendarId: "site-test@group.calendar.google.com", subject: "organiser@fikacatering.com", logistics: "logistics-test@fikacatering.com" };
const env = {
  NODE_ENV: "production", FIKA_RUNTIME_MODE: "production", FIREBASE_PROJECT_ID: "fika-os", FIKA_CPUX_MIRROR_WRITES_ENABLED: "true",
  FIKA_CPUX_MIRROR_RUNTIME_IDENTITY: identity, FIKA_CPUX_MIRROR_DWD_ISSUER: issuer,
  FIKA_CPUX_HOSPITALITY_CALENDARS_JSON: "{}", FIKA_CPUX_LOGISTICS_MAILBOX: target.logistics,
};

test("Calendar recovery is limited to the explicitly configured canonical site", () => {
  const scoped = { FIKA_CPUX_HOSPITALITY_ALLOWED_OPLOC: RCOA_HOSPITALITY_OPLOC_ID };
  assert.equal(hospitalityCalendarSiteEnabled(RCOA_HOSPITALITY_OPLOC_ID, scoped), true);
  for (const other of Object.keys(HOSPITALITY_EMAIL_SITE_IDENTITIES).filter(id => id !== RCOA_HOSPITALITY_OPLOC_ID)) {
    assert.equal(hospitalityCalendarSiteEnabled(other, scoped), false);
  }
  assert.equal(hospitalityCalendarSiteEnabled(RCOA_HOSPITALITY_OPLOC_ID, {}), false);
  assert.equal(hospitalityCalendarSiteEnabled("rcoa", { FIKA_CPUX_HOSPITALITY_ALLOWED_OPLOC: "rcoa" }), false);
});

const booking = {
  canonicalId: "booking:one", version: 3, lifecycleStatus: "Sent to CPU", statusHistory: [{ status: "Sent to CPU" }],
  client: { companyName: "Fixture company" }, order: { eventType: "Lunch" },
  service: { oplocId: "oploc:one", portalSiteLabel: "Fixture site", eventDate: "2026-11-09", startTime: "12:00", roomOrArea: "Floor 2", deliveryPoint: "Kitchen", guestCount: 18 },
  quoteState: { currentRevisionId: "quote:current", revisions: [{ id: "quote:current", pdfStatus: "saved", driveFileId: "fixtureQuoteFile" }] },
} as unknown as CanonicalBooking;
const order = {
  canonicalId: "production:one", origin: "hospitality_booking", version: 2, status: "draft", sourceBookingId: booking.canonicalId,
  destinationOplocId: "oploc:one", serviceDate: booking.service.eventDate, sourceQuoteRevisionId: "quote:current",
  lines: [
    { canonicalId: "production:one:line:1", sourceBookingLineId: "booking:one:line:1", itemName: "Chicken sandwich", workstream: "sandwiches", productionQuantity: 36, productionUnit: "pieces", customerQuantity: 18, customerUnit: "Per person" },
    { itemName: "Coffee", workstream: "unassigned", customerQuantity: 18 },
    { itemName: "Bought-in crisps", workstream: "unassigned", customerQuantity: 18 },
  ],
} as unknown as ProductionOrder;

test("Hospitality mirrors a successful handoff only, using customer ordered quantities, the canonical site Calendar and matching quote", () => {
  assert.equal(hospitalityMirrorSource({ ...booking, lifecycleStatus: "Quoted", statusHistory: [] }, order), undefined);
  const model = hospitalityMirrorSource(booking, order)!;
  assert.throws(() => resolveHospitalityCalendarTarget(model.site, env), /no approved Workspace mail identity/);
  assert.match(model.details!.description, /Chicken sandwich — 18 Per person/);
  assert.doesNotMatch(model.details!.description, /36 pieces/);
  assert.doesNotMatch(model.details!.description, /Coffee|crisps/);
  assert.equal(model.fileId, "fixtureQuoteFile");
  assert.throws(() => hospitalityMirrorSource(booking, { ...order, sourceQuoteRevisionId: "quote:old" }), /does not match/);
  const cancelled = hospitalityMirrorSource({ ...booking, version: 4, lifecycleStatus: "Cancelled" }, undefined)!;
  assert.ok(cancelled.source.withdrawn);
  assert.equal(mirrorEventId(model.source.stream, model.source.identity), mirrorEventId(cancelled.source.stream, cancelled.source.identity));
});

test("Hospitality Calendar resolver reuses all five canonical site mailboxes and accepts only explicit binding overrides", () => {
  const expected = ["cfc@fikacatering.com", "mnk@fikacatering.com", "seven@fikacatering.com", "rcoa@fikacatering.com", "munichre@fikacatering.com"];
  const ids = Object.keys(HOSPITALITY_EMAIL_SITE_IDENTITIES);
  assert.deepEqual(ids.map(id => resolveHospitalityCalendarTarget(id, env).calendarId), expected);
  assert.deepEqual(ids.map(id => resolveHospitalityCalendarTarget(id, env).subject), expected);
  assert.throws(() => resolveHospitalityCalendarTarget("oploc:unapproved", env), /no approved Workspace mail identity/);
  assert.throws(() => resolveHospitalityCalendarTarget(ids[3], { ...env, FIKA_CPUX_HOSPITALITY_CALENDARS_JSON: "not-json" }), /override configuration is invalid/);
  assert.throws(() => resolveHospitalityCalendarTarget(ids[3], { ...env, FIKA_CPUX_HOSPITALITY_CALENDARS_JSON: JSON.stringify({ "oploc:unapproved": { calendarId: "rcoa@fikacatering.com" } }) }), /unknown OPLOC/);
  assert.throws(() => resolveHospitalityCalendarTarget(ids[3], { ...env, FIKA_CPUX_HOSPITALITY_CALENDARS_JSON: JSON.stringify({ [ids[3]]: { subject: "rcoa@fikacatering.com" } }) }), /override configuration is invalid/);
  const override = resolveHospitalityCalendarTarget(ids[3], { ...env, FIKA_CPUX_HOSPITALITY_CALENDARS_JSON: JSON.stringify({ [ids[3]]: { calendarId: "group-calendar@group.calendar.google.com", delegatedOrganizerMailbox: "delegate@fikacatering.com" } }) });
  assert.deepEqual({ calendarId: override.calendarId, subject: override.subject }, { calendarId: "group-calendar@group.calendar.google.com", subject: "delegate@fikacatering.com" });
  assert.throws(() => resolveHospitalityCalendarTarget(ids[3], { ...env, FIKA_CPUX_HOSPITALITY_CALENDARS_JSON: JSON.stringify({ [ids[3]]: { delegatedOrganizerMailbox: "rcoa@fikacatering.com" } }) }), /redundant/);
});

test("completed grouped handoffs retain their live order and can use a saved commercial quote refresh", () => {
  const completed = { ...booking, lifecycleStatus: "Completed" as const };
  assert.ok(hasCurrentHospitalityHandoff(completed));
  assert.equal(hospitalityMirrorSource(completed, order)?.source.withdrawn, false);
  const inHouse = { ...completed, statusHistory: [] };
  assert.equal(hasCurrentHospitalityHandoff(inHouse), false);
  assert.equal(hospitalityMirrorSource(inHouse, undefined), undefined);
  assert.throws(() => hospitalityMirrorSource(completed, undefined), /no verifiable current Production Order/);
  assert.ok(hospitalityMirrorSource(completed, { ...order, status: "amended" })?.source.withdrawn);
  const original = completed.quoteState!.revisions[0];
  const refreshed = { ...completed, commercialVersion: 2, quoteState: {
    currentRevisionId: "quote:updated",
    revisions: [original, { ...original, id: "quote:updated", commercialVersion: 2, driveFileId: "newQuoteFile" }],
  } };
  assert.equal(hospitalityMirrorSource(refreshed, order)?.fileId, "newQuoteFile");
  assert.throws(() => hospitalityMirrorSource({ ...refreshed, commercialVersion: 3 }, order), /does not match/);
  assert.throws(() => hospitalityMirrorSource(refreshed, { ...order, sourceQuoteRevisionId: "unknown" }), /does not match/);
  assert.equal(hospitalityMirrorSource(completed, { ...order, lines: [{ ...order.lines[0], productionQuantity: undefined, productionUnit: undefined }] })?.source.withdrawn, false);
});

test("Hospitality mirror fails closed when a CPU line lacks customer quantity, unit, or stable identity", () => {
  const cpuLine = order.lines[0];
  const withLine = (line: Record<string, unknown>) => ({ ...order, lines: [{ ...cpuLine, ...line }] }) as unknown as ProductionOrder;
  assert.throws(() => hospitalityMirrorSource(booking, withLine({ customerQuantity: undefined })), /customer quantities, units, or line identities/);
  assert.throws(() => hospitalityMirrorSource(booking, withLine({ customerUnit: " " })), /customer quantities, units, or line identities/);
  assert.throws(() => hospitalityMirrorSource(booking, withLine({ canonicalId: "" })), /customer quantities, units, or line identities/);
  assert.throws(() => hospitalityMirrorSource(booking, withLine({ sourceBookingLineId: "" })), /customer quantities, units, or line identities/);
});

test("Calendar line text uses the customer order quantity rather than the CPU production multiplier", () => {
  const tenPeople = { ...order, lines: [{ ...order.lines[0], customerQuantity: 10, customerUnit: "people", productionQuantity: 30, productionUnit: "pieces" }] } as unknown as ProductionOrder;
  const model = hospitalityMirrorSource(booking, tenPeople)!;
  assert.match(model.details!.description, /Chicken sandwich — 10 people/);
  assert.doesNotMatch(model.details!.description, /30 pieces/);
});

test("Hot Fork Buffet mirror displays 90 Per person without production quantity and keeps the approved quote attachment", async () => {
  const hotForkBooking = {
    ...booking,
    client: { ...booking.client, companyName: "bmaddix@rcoa.ac.uk", clientName: null, clientCompany: null },
    service: { ...booking.service, portalSiteLabel: "RCoA Hospitality", guestCount: 94 },
    order: { ...booking.order, eventType: "event_catering" },
  } as unknown as CanonicalBooking;
  const hotForkOrder = {
    ...order,
    lines: [
      { canonicalId: "production:one:line:buffet", sourceBookingLineId: "booking:one:line:buffet", itemName: "Hot Fork Buffet", workstream: "hospitality", customerQuantity: 90, customerUnit: "Per person", productionQuantity: undefined, productionUnit: undefined },
      { canonicalId: "production:one:line:coffee", sourceBookingLineId: "booking:one:line:coffee", itemName: "Coffee", workstream: "unassigned", customerQuantity: 90, customerUnit: "Per person", productionQuantity: 90, productionUnit: "cups" },
    ],
  } as unknown as ProductionOrder;
  const model = hospitalityMirrorSource(hotForkBooking, hotForkOrder)!;
  assert.equal(model.fileId, "fixtureQuoteFile");
  assert.equal(model.details!.summary, "RCoA Hospitality_event catering x 94");
  assert.doesNotMatch(model.details!.summary, /bmaddix@rcoa\.ac\.uk/i);
  assert.match(model.details!.description, /94 guests/);
  assert.match(model.details!.description, /Hot Fork Buffet — 90 Per person/);
  assert.doesNotMatch(model.details!.description, /Coffee|pieces|undefined/);

  const fixture = harness();
  const client = await openMirrorClient(target, env, fixture.fetcher);
  const quote = await client.verifiedPdf(model.fileId!, "Approved Hospitality quote.pdf");
  await client.publish(model.source, model.details, quote);
  const eventWrite = fixture.calls.find(call => call.method === "POST");
  assert.ok(eventWrite);
  assert.match(eventWrite.body!.description!, /Hot Fork Buffet — 90 Per person/);
  assert.doesNotMatch(eventWrite.body!.description!, /Coffee|pieces|undefined/);
  assert.deepEqual(eventWrite.body!.attachments, [{ fileUrl: quote.attachmentUrl, title: quote.title, mimeType: "application/pdf" }]);
  assert.ok(eventWrite.body!.description!.includes(quote.url));
});

test("catch-up starts on 9 November inclusive and timed events handle UK clock changes", () => {
  assert.deepEqual(backfillDates("2026-11-09", "2026-11-10"), ["2026-11-09", "2026-11-10"]);
  assert.throws(() => backfillDates("2026-11-08", "2026-11-09"), /inclusive range/);
  assert.throws(() => backfillDates("2026-11-09", "2026-11-23"), /inclusive range/);
  assert.throws(() => backfillDates("2026-11-31", "2026-12-01"), /valid ISO/);
  assert.equal(londonTimestamp("2026-07-01", "00:15"), "2026-06-30T23:15:00.000Z");
  assert.equal(londonServiceDate(new Date("2026-06-30T23:15:00Z")), "2026-07-01");
  assert.throws(() => londonTimestamp("2026-10-25", "01:15"), /ambiguous/);
  assert.throws(() => londonTimestamp("2026-03-29", "01:15"), /missing/);
});

function mockGoogleIdentity(url: URL, init?: RequestInit) {
  if (url.hostname === "metadata.google.internal") {
    const value = url.pathname.endsWith("/token") ? JSON.stringify({ access_token: "fixture-runtime" })
      : url.pathname.endsWith("/project-id") ? "fika-os" : identity;
    return new Response(value, { headers: { "Metadata-Flavor": "Google" } });
  }
  if (url.hostname === "iamcredentials.googleapis.com") {
    assert.equal(url.pathname, "/v1/projects/-/serviceAccounts/" + encodeURIComponent(issuer) + ":signJwt");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-runtime");
    const claims = JSON.parse(JSON.parse(String(init?.body)).payload);
    assert.equal(claims.iss, issuer);
    return Response.json({ signedJwt: Buffer.from(JSON.stringify(claims)).toString("base64url") });
  }
  if (url.hostname === "oauth2.googleapis.com") {
    const assertion = (init!.body as URLSearchParams).get("assertion")!;
    const claims = JSON.parse(Buffer.from(assertion, "base64url").toString());
    return Response.json({ access_token: "fixture:" + claims.sub, scope: claims.scope });
  }
}

function harness() {
  let event: Record<string, unknown> | undefined;
  let failWrite = false;
  let blockedPdf = false;
  let calendarRole = "writer";
  type RequestBody = Record<string, unknown> & {
    id?: string; description?: string; attachments?: Array<{ fileUrl?: string; title?: string; mimeType?: string }>; attendees?: Array<{ email?: string }>; transparency?: string;
    extendedProperties?: { shared?: Record<string, string> };
  };
  const calls: Array<{ url: URL; method: string; body?: RequestBody; headers: Headers }> = [];
  const response = (value: unknown, status = 200) => Response.json(value, { status });
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method || "GET";
    const headers = new Headers(init?.headers);
    const identityResponse = mockGoogleIdentity(url, init);
    if (identityResponse) return identityResponse;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body, headers });
    if (url.pathname.includes("/calendar/v3/users/me/calendarList/")) return response({ id: target.calendarId, accessRole: calendarRole });
    if (url.pathname.includes("/drive/v2/"))
      return response({ id: "fixtureQuoteFile", mimeType: "application/pdf", alternateLink: "https://drive.google.com/open?id=fixtureQuoteFile" });
    if (url.pathname.endsWith("/permissions")) return response({ permissions: [
      { type: "user", emailAddress: target.subject, role: "owner", permissionDetails: [{ inherited: false, permissionType: "file" }] },
      { type: "user", emailAddress: "cpux@fikacatering.com", role: "reader", permissionDetails: [{ inherited: false, permissionType: "file" }] },
    ] });
    if (url.pathname.includes("/drive/"))
      return blockedPdf && headers.get("authorization")?.endsWith(target.logistics) ? response({ error: { errors: [{ reason: "insufficientFilePermissions" }] } }, 403)
        : response({ id: "fixtureQuoteFile", mimeType: "application/pdf", capabilities: { canDownload: true } });
    if (method === "GET" && url.searchParams.has("sharedExtendedProperty")) {
      const wanted = url.searchParams.get("sharedExtendedProperty")?.split("=").slice(1).join("=");
      const storedMirrorKey = (event?.extendedProperties as { shared?: Record<string, string> } | undefined)?.shared?.fikaMirrorKey;
      return response({ items: event && storedMirrorKey === wanted ? [event] : [] });
    }
    if (method === "GET") return event ? response(event) : response({}, 404);
    if (failWrite) return response({ message: "private diagnostic must not leak" }, 429);
    if (method === "PATCH") assert.equal(headers.get("if-match"), event?.etag);
    event = { ...event, ...body, organizer: { self: true, email: target.subject }, etag: '"next"' };
    return response(event);
  };
  return { fetcher, calls, fail: () => { failWrite = true; }, denyPdf: () => { blockedPdf = true; }, setCalendarRole: (value: string) => { calendarRole = value; }, setEvent: (value: Record<string, unknown>) => { event = value; } };
}

test("Calendar identity is not inferred from mailbox: CalendarList permission must verify writer access before inspection", async () => {
  const fixture = harness();
  fixture.setCalendarRole("reader");
  const client = await openMirrorClient(target, env, fixture.fetcher);
  const model = hospitalityMirrorSource(booking, order)!;
  await assert.rejects(client.inspect(model.source), /verified Calendar write access/);
  assert.equal(fixture.calls.filter(call => call.url.pathname.includes("/events")).length, 0);
  assert.equal(fixture.calls.filter(call => call.method !== "GET").length, 0);
});

test("Google delivery checks both PDF recipients, inserts once, preserves ID on amendment, and cancels without resurrecting on replay", async () => {
  const fixture = harness();
  const client = await openMirrorClient(target, env, fixture.fetcher);
  const model = hospitalityMirrorSource(booking, order)!;
  assert.equal((await client.inspect(model.source)).disposition, "create");
  const pdf = await client.verifiedPdf(model.fileId!, "Approved quote.pdf");
  assert.equal(pdf.url, documentUrl("fixtureQuoteFile"));
  assert.equal((await client.publish(model.source, model.details, pdf)).disposition, "create");
  assert.equal((await client.publish(model.source, model.details, pdf)).disposition, "unchanged");
  const amended = { ...model.source, revision: model.source.revision + 1, sourceReference: "amended" };
  await client.publish(amended, { ...model.details!, start: { dateTime: "2026-11-09T13:00:00.000Z", timeZone: TIME_ZONE } }, pdf);
  const cancelled = { ...amended, revision: amended.revision + 1, sourceReference: "cancelled", withdrawn: true };
  await client.publish(cancelled);
  assert.equal((await client.publish(amended, model.details, pdf)).disposition, "skip");
  const writes = fixture.calls.filter(call => call.method !== "GET");
  assert.deepEqual(writes.map(call => call.method), ["POST", "PATCH", "PATCH"]);
  assert.deepEqual(writes[0].body!.attendees, [{ email: "cpux@fikacatering.com" }, { email: target.logistics }]);
  assert.equal(writes[0].body!.attachments![0].fileUrl, "https://drive.google.com/open?id=fixtureQuoteFile");
  assert.ok(writes[0].body!.description!.includes(pdf.url));
  assert.equal(writes[0].url.searchParams.get("supportsAttachments"), "true");
  assert.match(writes[1].url.pathname, new RegExp(writes[0].body!.id + "$"));
  assert.equal(writes[2].body!.transparency, "transparent");
  assert.equal(writes[2].body!.extendedProperties!.shared!.fikaMirrorWithdrawn, "true");
  assert.deepEqual(writes[2].body!.attendees, []);
  assert.deepEqual(writes[2].body!.attachments, []);
});

test("read-only PDF diagnostics distinguish delegated Drive access by principal without exposing tokens or file contents", async () => {
  const fixture = harness();
  fixture.denyPdf();
  const client = await openMirrorClient(target, env, fixture.fetcher, true);
  const result = await client.inspectPdfAccess("fixtureQuoteFile");
  assert.equal(result.readableByAll, false);
  assert.deepEqual(result.principals.map(({ principal, tokenStatus, grantedScope, driveHttpStatus, readable }) => ({ principal, tokenStatus, grantedScope, driveHttpStatus, readable })), [
    { principal: "cpux@fikacatering.com", tokenStatus: "ok", grantedScope: "https://www.googleapis.com/auth/drive.readonly", driveHttpStatus: 200, readable: true },
    { principal: target.logistics, tokenStatus: "ok", grantedScope: "https://www.googleapis.com/auth/drive.readonly", driveHttpStatus: 403, readable: false },
    { principal: target.subject, tokenStatus: "ok", grantedScope: "https://www.googleapis.com/auth/drive.readonly", driveHttpStatus: 200, readable: true },
  ]);
  assert.equal(result.principals[0].canDownload, true);
  assert.equal(result.principals[1].driveErrorCode, "insufficientFilePermissions");
  assert.doesNotMatch(JSON.stringify(result), /fixture:|Bearer|access_token|privateQuoteContent/);
  assert.ok(fixture.calls.every(call => call.method === "GET"));
});

test("read-only PDF diagnostics report IAM delegation failure separately from Drive ACL responses", async () => {
  const fixture = harness();
  const fetcher: typeof fetch = async (input, init) => new URL(String(input)).hostname === "iamcredentials.googleapis.com"
    ? Response.json({ error: { message: "private IAM response" } }, { status: 403 }) : fixture.fetcher(input, init);
  const client = await openMirrorClient(target, env, fetcher, true);
  const result = await client.inspectPdfAccess("fixtureQuoteFile");
  assert.equal(result.readableByAll, false);
  assert.ok(result.principals.every(principal => principal.tokenStatus === "failed" && principal.tokenStage === "iam-sign-jwt" && principal.tokenHttpStatus === 403));
  assert.doesNotMatch(JSON.stringify(result), /private IAM response|fixture:|Bearer|access_token/);
});

test("staging or unverified runtime cannot request Google tokens; ambiguous identities and ACL failures write nothing", async () => {
  let requests = 0;
  const fetcher: typeof fetch = async () => { requests++; return new Response("fika-os-dev", { headers: { "Metadata-Flavor": "Google" } }); };
  await assert.rejects(openMirrorClient(target, { ...env, FIKA_RUNTIME_MODE: "staging" }, fetcher), /disabled/);
  assert.equal(requests, 0);
  await assert.rejects(openMirrorClient(target, env, fetcher), /approved production/);
  assert.equal(requests, 2);
  const fixture = harness();
  await assert.rejects(openMirrorClient(target, { ...env, FIKA_CPUX_MIRROR_DWD_ISSUER: identity }, fixture.fetcher), /dedicated Calendar/);
  const client = await openMirrorClient(target, env, fixture.fetcher);
  const model = hospitalityMirrorSource(booking, order)!;
  fixture.setEvent({ id: mirrorEventId("hospitality", booking.canonicalId), status: "confirmed" });
  await assert.rejects(client.inspect(model.source), /ambiguous identity/);
  fixture.denyPdf();
  await assert.rejects(client.verifiedPdf(model.fileId!, "Quote.pdf"), /not readable/);
  assert.equal(fixture.calls.filter(call => call.method !== "GET").length, 0);
});

test("retryable Calendar failure reports only a safe code", async () => {
  const fixture = harness();
  fixture.fail();
  const client = await openMirrorClient(target, env, fixture.fetcher);
  const model = hospitalityMirrorSource(booking, order)!;
  const pdf = await client.verifiedPdf(model.fileId!, "Quote.pdf");
  await assert.rejects(client.publish(model.source, model.details, pdf), { message: "Google Calendar or Drive refused the operation (HTTP 429)." });
});

test("production preview cannot publish or allocate files even with write credentials configured", async () => {
  const fixture = harness();
  const preview = await openMirrorClient(target, { ...env, FIKA_CPUX_MIRROR_WRITES_ENABLED: "false", FIKA_CPUX_MIRROR_PREVIEW_ENABLED: "true" }, fixture.fetcher, true);
  const model = hospitalityMirrorSource(booking, order)!;
  assert.equal((await preview.inspect(model.source)).disposition, "create");
  await assert.rejects(preview.publish(model.source), /preview cannot write/);
  await assert.rejects(preview.allocatePdfId(), /preview cannot write/);
  assert.ok(fixture.calls.every(call => call.method === "GET"));
});

test("read-only diagnostics expose deterministic organiser identity and attendee-copy status without writes", async () => {
  const fixture = harness();
  const preview = await openMirrorClient(target, { ...env, FIKA_CPUX_MIRROR_WRITES_ENABLED: "false", FIKA_CPUX_MIRROR_PREVIEW_ENABLED: "true" }, fixture.fetcher, true);
  const model = hospitalityMirrorSource(booking, order)!;
  const inspected = await preview.inspectEvent(model.source);
  assert.equal(inspected.observation.disposition, "create");
  assert.equal(inspected.identityStatus, "unique");
  assert.equal(inspected.currentEvent, null);
  const copies = await preview.inspectAttendeeCopies(model.source);
  assert.deepEqual(copies.map(copy => [copy.email, copy.status]), [["cpux@fikacatering.com", "missing"], [target.logistics, "missing"]]);
  assert.ok(fixture.calls.every(call => call.method === "GET"));
  assert.ok(fixture.calls.some(call => call.url.pathname.includes("/calendars/primary/events")));
  const eventId = mirrorEventId("hospitality", booking.canonicalId);
  fixture.setEvent({ id: "conflicting-event-id", status: "confirmed", extendedProperties: { shared: { fikaMirrorKey: eventId } } });
  const duplicate = await preview.inspectEvent(model.source);
  assert.equal(duplicate.identityStatus, "duplicate-or-conflicting");
  assert.equal(duplicate.observation.disposition, "skip");
  assert.equal(duplicate.conflictingEvents[0]?.id, "conflicting-event-id");
  assert.ok(fixture.calls.every(call => call.method === "GET"));
});

test("whole-day run sheet upload reuses its reserved Drive ID and verifies the exact publication before attaching", async () => {
  const folderId = "fixtureRunSheetFolder";
  const fileId = "fixtureRunSheetFileId";
  let stored: Record<string, unknown> | undefined;
  let uploads = 0, renders = 0, extraAccess = false;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const identityResponse = mockGoogleIdentity(url, init);
    if (identityResponse) return identityResponse;
    if (url.pathname.endsWith("/permissions")) return Response.json({ permissions: [
      ...["cpux@fikacatering.com", target.logistics, target.subject].map(emailAddress => ({ type: "user", emailAddress })),
      ...(extraAccess ? [{ type: "domain" }] : []),
    ] });
    if (url.pathname.endsWith("/generateIds")) return Response.json({ ids: [fileId] });
    if (url.pathname.endsWith("/" + folderId)) return Response.json({ id: folderId, mimeType: "application/vnd.google-apps.folder" });
    if (url.pathname.startsWith("/drive/v2/") && stored)
      return Response.json({ id: fileId, mimeType: "application/pdf", alternateLink: documentUrl(fileId) });
    if (url.pathname.endsWith("/" + fileId)) return stored ? Response.json(stored) : Response.json({}, { status: 404 });
    assert.equal(init?.method, "POST");
    assert.match(url.pathname, /\/upload\/drive\/v3\/files$/);
    uploads++;
    const raw = Buffer.from(init!.body as Uint8Array).toString();
    const metadata = JSON.parse(raw.split("\r\n\r\n")[1].split("\r\n")[0]);
    assert.equal(metadata.id, fileId);
    stored = { ...metadata, capabilities: { canDownload: true } };
    return Response.json(stored);
  };
  const client = await openMirrorClient(target, env, fetcher);
  const reserved = await client.allocatePdfId();
  const render = async () => { renders++; return Buffer.from("%PDF-1.7\nSynthetic fixture"); };
  const first = await client.storeRunSheet(reserved, folderId, "pub-1-v3", "Run sheet.pdf", render);
  const retry = await client.storeRunSheet(reserved, folderId, "pub-1-v3", "Run sheet.pdf", render);
  assert.deepEqual(retry, first);
  assert.equal(uploads, 1);
  assert.equal(renders, 1);
  await assert.rejects(client.storeRunSheet(reserved, folderId, "pub-1-v4", "Run sheet.pdf", render), /does not match/);
  extraAccess = true;
  await assert.rejects(client.verifyRunSheetFolder(folderId), /broader than the approved audience/);
  assert.equal(uploads, 1);
});
