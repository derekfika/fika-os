import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("dashboard consumes the Hub projection, suppresses grouped children and offers one group quote command", () => {
  const dashboard = read("../app/ui/HospitalityDashboard.tsx");
  assert.match(dashboard, /setGroups\(body.bookingGroups/);
  assert.match(dashboard, /body.dashboardBookings \|\| body.bookings/);
  assert.match(dashboard, /standaloneIds.has\(item.canonicalId\)/);
  assert.match(dashboard, /visibleGroups.map\(group/);
  assert.match(dashboard, /groups.filter\(group => group.eventDate === key\)/);
  const action = dashboard.slice(dashboard.indexOf("const generateGroupQuote"), dashboard.indexOf("const persistQuotePdf"));
  assert.equal((action.match(/fetchQuoteRequest\(/g) || []).length, 1);
  assert.match(action, /expectedSourceHash: selectedGroup.sourceHash/);
  assert.doesNotMatch(action, /quoteHtml|saveQuoteDocument|for \(/);
  assert.match(dashboard, /!booking.bookingGroup && <button type="button" onClick=\{\(\) => onAmend/);
  assert.match(dashboard, /!booking.bookingGroup \|\| !\["Quoted", "QuotePdfRetry"\]/);
});

test("group detail is one booking with one chronological item list and no service selection", () => {
  const source = read("../app/ui/HospitalityGroupDetail.tsx");
  for (const text of ["groupRequestedItems(group)", "RequestedItemsList", "What was requested", "service.charges.map", "group.totals.gross", "Amend booking", "GroupAmendmentEditor", "/api/booking-groups/cancel", "CancellationStatusPanel", "Retry group quote", "group.quote.stale", "{!editing && production}"]) assert.ok(source.includes(text), text);
  for (const text of ["<details", "<summary", "All day schedule", "onService", "service operations"]) assert.ok(!source.includes(text), `removed: ${text}`);
  assert.doesNotMatch(source, /window\.(alert|confirm|prompt)/);
  const dashboard = read("../app/ui/HospitalityDashboard.tsx");
  assert.ok(!dashboard.includes("Service operations ·")); assert.ok(!dashboard.includes("onService="));
  const css = read("../app/ui/HospitalityGroupDetail.module.css");
  assert.match(css, /:focus-visible/); assert.match(css, /min-height: 44px/); assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
});

test("RCoA All Day event section has desktop/tablet separation and restrained mobile spacing", () => {
  assert.match(read("../app/ui/RcoaBookingPortal.tsx"), /section className=\{styles.allDayEventSection\} aria-labelledby="rcoa-allday-event-title"/);
  const css = read("../app/ui/RcoaBookingPortal.module.css");
  assert.match(css, /\.allDayEventSection \{ margin-top: var\(--space-7, 48px\); \}/);
  assert.match(css, /@media \(max-width: 600px\) \{ \.allDayEventSection \{ margin-top: var\(--space-5, 24px\); \} \}/);
});

test("single quote PDF rendering uses the shared renderer without changing its public interface", () => {
  assert.equal(read("../lib/local-pdf.ts").trim(), 'export * from "@fika/server-shared/pdf-renderer";');
  const source = read("../app/api/quotes/drive/route.ts"); assert.match(source, /bookingBody.booking.bookingGroup\?\.id/); assert.match(source, /renderPdfToBuffer\(body.html/);
});
