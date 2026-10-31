import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  availableStatuses,
  describeFilters,
  emptyQueueFilters,
  filterQueue,
  hasActiveFilters,
  queueStatusLabel,
  type QueueBooking,
  type QueueFilters,
  type QueueGroup,
} from "../lib/dashboard-queue-filters";

const booking = (id: string, over: Partial<QueueBooking> & { date?: string; time?: string; company?: string; name?: string } = {}): QueueBooking => ({
  canonicalId: id,
  lifecycleStatus: over.lifecycleStatus || "New",
  updatedAt: over.updatedAt,
  createdAt: over.createdAt,
  source: { sourceBookingId: over.source?.sourceBookingId || `SRC-${id}` },
  client: over.client || { name: over.name || "Ada Lovelace", companyName: over.company || "Analytical Ltd" },
  service: { eventDate: over.date, startTime: over.time },
});

const group = (id: string, over: Partial<QueueGroup> = {}): QueueGroup => ({
  id,
  reference: `GRP-${id}`,
  status: "New",
  eventDate: "2026-11-04",
  firstTime: "08:00",
  client: { name: "Grace Hopper", companyName: "Compiler Co" },
  services: [],
  ...over,
});

const filters = (patch: Partial<QueueFilters>): QueueFilters => ({ ...emptyQueueFilters, ...patch });
const run = (bookings: QueueBooking[], groups: QueueGroup[], patch: Partial<QueueFilters>, standalone = bookings.map((b) => b.canonicalId)) =>
  filterQueue({ bookings, groups, standaloneIds: new Set(standalone), filters: filters(patch) });
const ids = (result: ReturnType<typeof run>) => result.rows.map((row) => row.id);

const sample = [
  booking("b1", { date: "2026-11-02", time: "09:00", name: "Ada Lovelace", company: "Analytical Ltd", updatedAt: "2026-10-30T09:00:00Z" }),
  booking("b2", { date: "2026-11-02", time: "08:00", name: "Charles Babbage", company: "Engines plc", lifecycleStatus: "Cancelled", updatedAt: "2026-10-30T11:00:00Z" }),
  booking("b3", { date: "2026-11-04", time: "12:30", name: "Zoë Müller", company: "Münich Analytics", lifecycleStatus: "Approved", updatedAt: "2026-10-29T08:00:00Z" }),
];

test("an empty filter shows everything, cancelled history included, in service order", () => {
  const result = run(sample, [], {});
  assert.deepEqual(ids(result), ["b2", "b1", "b3"]);
  assert.equal(result.total, 3);
  assert.equal(result.shown, 3);
  assert.equal(hasActiveFilters(emptyQueueFilters), false);
});

test("search matches booker, company and requester names regardless of case, accents and spacing", () => {
  assert.deepEqual(ids(run(sample, [], { search: "  LOVELACE " })), ["b1"]);
  assert.deepEqual(ids(run(sample, [], { search: "engines" })), ["b2"]);
  assert.deepEqual(ids(run(sample, [], { search: "zoe muller" })), ["b3"]);
  assert.deepEqual(ids(run(sample, [], { search: "munich" })), ["b3"]);
  const requested = booking("r1", { client: { name: "Front Desk", companyName: "Host", requester: { name: "Katherine Johnson", companyName: "Orbit" } } });
  assert.deepEqual(ids(run([requested], [], { search: "johnson" })), ["r1"]);
  const clientName = booking("r2", { client: { name: "Reception", companyName: "Host", clientName: "Mary Jackson", clientCompany: "Wind Tunnel" } });
  assert.deepEqual(ids(run([clientName], [], { search: "jackson tunnel" })), ["r2"]);
});

test("search requires every term and never matches empty or unrelated records", () => {
  assert.deepEqual(ids(run(sample, [], { search: "ada analytical" })), ["b1"]);
  assert.deepEqual(ids(run(sample, [], { search: "ada engines" })), []);
  assert.deepEqual(ids(run(sample, [], { search: "   " })), ["b2", "b1", "b3"]);
  const bare = booking("b9", { client: { name: undefined, companyName: undefined } });
  assert.deepEqual(ids(run([bare], [], { search: "ada" })), []);
});

test("search finds canonical IDs, source references and group references including child service references", () => {
  assert.deepEqual(ids(run(sample, [], { search: "b2" })), ["b2"]);
  const custom = booking("b4", { source: { sourceBookingId: "MR-2026-0042" } });
  assert.deepEqual(ids(run([custom], [], { search: "mr-2026-0042" })), ["b4"]);
  const grouped = group("g1", { reference: "AD-100", services: [{ bookingId: "child-1", sourceReference: "AD-100-1" }] });
  assert.deepEqual(ids(run([], [grouped], { search: "ad-100" })), ["g1"]);
  assert.deepEqual(ids(run([], [grouped], { search: "AD-100-1" })), ["g1"]);
  assert.deepEqual(ids(run([], [grouped], { search: "child-1" })), ["g1"]);
  assert.deepEqual(ids(run([], [grouped], { search: "hopper" })), ["g1"]);
});

test("status filter uses canonical statuses, shows Approved as Ready for CPU and is multi-select", () => {
  assert.equal(queueStatusLabel("Approved"), "Ready for CPU");
  assert.deepEqual(ids(run(sample, [], { statuses: ["Cancelled"] })), ["b2"]);
  assert.deepEqual(ids(run(sample, [], { statuses: ["Ready for CPU"] })), ["b3"]);
  assert.deepEqual(ids(run(sample, [], { statuses: ["New", "Ready for CPU"] })), ["b1", "b3"]);
  assert.deepEqual(ids(run(sample, [], { statuses: ["Sent to CPU"] })), []);
  const readyGroup = group("g2", { status: "Ready for CPU" });
  assert.deepEqual(ids(run(sample, [readyGroup], { statuses: ["Ready for CPU"] })).sort(), ["b3", "g2"]);
});

test("date range is inclusive at both boundaries and open ended when one side is blank", () => {
  assert.deepEqual(ids(run(sample, [], { dateFrom: "2026-11-02", dateTo: "2026-11-02" })), ["b2", "b1"]);
  assert.deepEqual(ids(run(sample, [], { dateFrom: "2026-11-03" })), ["b3"]);
  assert.deepEqual(ids(run(sample, [], { dateTo: "2026-11-03" })), ["b2", "b1"]);
  assert.deepEqual(ids(run(sample, [], { dateFrom: "2026-11-04", dateTo: "2026-11-04" })), ["b3"]);
  assert.deepEqual(ids(run(sample, [], { dateFrom: "2026-11-05" })), []);
  // A reversed range can never match anything rather than guessing the intent.
  assert.deepEqual(ids(run(sample, [], { dateFrom: "2026-11-04", dateTo: "2026-11-02" })), []);
});

test("date boundaries compare Europe/London business dates as strings, never UTC timestamps", () => {
  const lateEvening = booking("late", { date: "2026-03-29", time: "23:30" });
  const earlyMorning = booking("early", { date: "2026-03-30", time: "00:15" });
  const result = run([lateEvening, earlyMorning], [], { dateFrom: "2026-03-30", dateTo: "2026-03-30" });
  assert.deepEqual(ids(result), ["early"]);
  const dst = run([lateEvening, earlyMorning], [], { dateFrom: "2026-03-29", dateTo: "2026-03-29" });
  assert.deepEqual(ids(dst), ["late"]);
});

test("a booking with no service date is only visible when no date range is active", () => {
  const undated = booking("u1");
  assert.deepEqual(ids(run([undated], [], {})), ["u1"]);
  assert.deepEqual(ids(run([undated], [], { dateFrom: "2026-01-01" })), []);
  assert.deepEqual(ids(run([undated], [], { dateTo: "2030-01-01" })), []);
});

test("grouped child bookings stay out of the standalone queue", () => {
  const child = booking("child-1", { date: "2026-11-02" });
  const standalone = booking("solo", { date: "2026-11-02" });
  const parent = group("g1", { services: [{ bookingId: "child-1" }] });
  const result = run([child, standalone], [parent], {}, ["solo"]);
  assert.deepEqual(new Set(ids(result)), new Set(["g1", "solo"]));
  assert.equal(result.total, 2);
});

test("service date sorting is stable, date then time then id, with undated rows last in both directions", () => {
  const rows = [
    booking("z", { date: "2026-11-02", time: "09:00" }),
    booking("a", { date: "2026-11-02", time: "09:00" }),
    booking("m", { date: "2026-11-03", time: "07:00" }),
    booking("e", { date: "2026-11-02", time: "08:00" }),
    booking("undated"),
  ];
  assert.deepEqual(ids(run(rows, [], { sort: "service-asc" })), ["e", "a", "z", "m", "undated"]);
  assert.deepEqual(ids(run(rows, [], { sort: "service-desc" })), ["m", "z", "a", "e", "undated"]);
  const grouped = group("g", { eventDate: "2026-11-02", firstTime: "08:30" });
  assert.deepEqual(ids(run(rows, [grouped], { sort: "service-asc" })).slice(0, 3), ["e", "g", "a"]);
});

test("recently updated sorts newest first, uses a group's latest member update and leaves undated-update rows last", () => {
  const rows = [
    booking("old", { date: "2026-11-02", updatedAt: "2026-10-01T10:00:00Z" }),
    booking("new", { date: "2026-11-09", updatedAt: "2026-10-30T10:00:00Z" }),
    booking("never", { date: "2026-11-01" }),
    booking("c1", { date: "2026-11-03", updatedAt: "2026-10-29T10:00:00Z" }),
    booking("c2", { date: "2026-11-03", updatedAt: "2026-10-31T10:00:00Z" }),
  ];
  const parent = group("g1", { services: [{ bookingId: "c1" }, { bookingId: "c2" }] });
  const result = run(rows, [parent], { sort: "updated-desc" }, ["old", "new", "never"]);
  assert.deepEqual(ids(result), ["g1", "new", "old", "never"]);
});

test("counts reflect filtering and a filtered-out booking is hidden, not removed", () => {
  const result = run(sample, [], { statuses: ["Cancelled"] });
  assert.equal(result.shown, 1);
  assert.equal(result.total, 3);
  assert.equal(result.bookings.length, 1);
  assert.equal(result.groups.length, 0);
  assert.equal(run(sample, [], { search: "nobody" }).shown, 0);
});

test("filter inputs are never mutated", () => {
  const bookings = [...sample];
  const snapshot = JSON.stringify(bookings);
  const active = filters({ search: "a", sort: "service-desc", statuses: ["New"] });
  filterQueue({ bookings, groups: [], standaloneIds: new Set(bookings.map((b) => b.canonicalId)), filters: active });
  assert.equal(JSON.stringify(bookings), snapshot);
  assert.deepEqual(emptyQueueFilters, { search: "", statuses: [], dateFrom: "", dateTo: "", sort: "service-asc" });
});

test("only statuses present in the loaded data are offered", () => {
  const standaloneIds = new Set(["b1", "b2", "b3"]);
  assert.deepEqual(availableStatuses({ bookings: sample, groups: [group("g", { status: "Needs attention" })], standaloneIds }), ["New", "Ready for CPU", "Needs attention", "Cancelled"]);
  assert.deepEqual(availableStatuses({ bookings: [], groups: [], standaloneIds: new Set() }), []);
});

test("chips describe every active filter and can be reset", () => {
  const active = filters({ search: "ada", statuses: ["New"], dateFrom: "2026-11-02" });
  assert.equal(hasActiveFilters(active), true);
  assert.deepEqual(describeFilters(active).map((chip) => chip.key), ["search", "status:New", "date"]);
  assert.equal(hasActiveFilters(filters({ sort: "updated-desc" })), false);
  assert.deepEqual(describeFilters(emptyQueueFilters), []);
});

const dashboard = readFileSync(new URL("../app/ui/HospitalityDashboard.tsx", import.meta.url), "utf8");
const filterBar = readFileSync(new URL("../app/ui/DashboardQueueFilters.tsx", import.meta.url), "utf8");
const filterCss = readFileSync(new URL("../app/ui/DashboardQueueFilters.module.css", import.meta.url), "utf8");

test("the dashboard feeds the same filtered rows to the calendar and the queue, with one reset-able filter bar", () => {
  assert.match(dashboard, /filterQueue\(\{ bookings, groups, standaloneIds, filters: queueFilters \}\)/);
  assert.match(dashboard, /bookings=\{visible\}/);
  assert.match(dashboard, /groups=\{visibleGroups\}/);
  assert.match(dashboard, /<DashboardQueueFilters/);
  assert.match(dashboard, /queue\.rows\.map\(row/);
  assert.doesNotMatch(dashboard, /availableSites|onSiteChange|Hospitality site/, "the dashboard stays site-locked");
  assert.doesNotMatch(dashboard, /setFilter\(/);
  assert.match(dashboard, /No bookings match these filters/);
});

test("the filter bar is labelled, keyboard operable, announces counts and offers reset", () => {
  assert.match(filterBar, /role="search"/);
  assert.match(filterBar, /type="search"/);
  assert.match(filterBar, /<legend>Status<\/legend>/);
  assert.match(filterBar, /role="status" aria-live="polite"/);
  assert.match(filterBar, /Reset filters/);
  assert.match(filterBar, /aria-label=\{`Remove filter/);
  assert.match(filterBar, /role="alert"/);
  assert.doesNotMatch(filterBar, /window\.(alert|confirm|prompt)/);
  assert.match(filterCss, /:focus-visible/);
  assert.match(filterCss, /min-height: 44px/);
  assert.match(filterCss, /@media \(max-width: 640px\)/);
  assert.doesNotMatch(filterCss, /#[0-9a-fA-F]{3,8}\b/, "touched UI uses semantic tokens, not raw colours");
});

test("filtering is read-only: no booking write, fetch or storage access in the filter module or bar", () => {
  const model = readFileSync(new URL("../lib/dashboard-queue-filters.ts", import.meta.url), "utf8");
  for (const source of [model, filterBar]) {
    assert.doesNotMatch(source, /fetch\(|localStorage|sessionStorage|method:\s*"(POST|PUT|PATCH|DELETE)"/);
  }
});


test("site searches use only loaded canonical site fields and loaded authorized group children", () => {
  const child = { ...booking("child"), service: { eventDate: "2026-11-02", portalSiteId: "site-123", portalSiteLabel: "Example House", oplocId: "oploc-456" } };
  const solo = { ...booking("solo"), service: { eventDate: "2026-11-03", portalSiteId: "site-123", portalSiteLabel: "Example House", oplocId: "oploc-456" } };
  const parent = group("parent", { services: [{ bookingId: "child" }] });
  for (const search of ["site-123", "example house", "oploc-456"]) {
    assert.deepEqual(ids(run([child, solo], [parent], { search }, ["solo"])), ["solo", "parent"]);
  }
  // A reference to an unloaded child grants no additional searchable fields.
  assert.deepEqual(ids(run([], [parent], { search: "example house" })), []);
  assert.deepEqual(ids(run([solo], [], { search: "other-site" })), []);
});

test("status sorting interleaves groups and standalone records without changing canonical statuses", () => {
  const parent = group("parent", { status: "Quoted" });
  const rows = [booking("cancelled", { lifecycleStatus: "Cancelled" }), booking("approved", { lifecycleStatus: "Approved" }), booking("new", { lifecycleStatus: "New" })];
  assert.deepEqual(ids(run(rows, [parent], { sort: "status-asc" })), ["cancelled", "new", "parent", "approved"]);
  assert.equal(rows[1].lifecycleStatus, "Approved");
});

test("creation sorting uses recorded creation time, latest loaded group member, and missing timestamps last", () => {
  const rows = [booking("solo", { createdAt: "2026-10-30T10:00:00Z" }), booking("child", { createdAt: "2026-10-31T10:00:00Z" }), booking("missing")];
  const parent = group("parent", { services: [{ bookingId: "child" }] });
  assert.deepEqual(ids(run(rows, [parent], { sort: "created-desc" }, ["solo", "missing"])), ["parent", "solo", "missing"]);
});

test("summary metrics are calculated from the same filtered standalone and group subsets as the calendar", () => {
  const metrics = dashboard.slice(dashboard.indexOf("  const newCount ="), dashboard.indexOf("  const scanStepIndex"));
  assert.match(metrics, /visibleGroups\.filter/);
  assert.match(metrics, /visible\.filter/);
  assert.doesNotMatch(metrics, /\bgroups\.filter|\bbookings\.filter/);
  assert.match(dashboard, /aria-label="Filtered booking summary"/);
  assert.match(dashboard, /queue\.rows\.map\(row/);
  assert.doesNotMatch(dashboard, /!loading && visibleGroups\.map|visible\.map\(\(booking/);
});
