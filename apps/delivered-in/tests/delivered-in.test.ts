import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { test } from "node:test";
import { resolveDeliveredInAccess } from "@fika/server-shared/delivered-in-access";
import { assertAuthorisedOploc, assertPublishedAllocationIntegrity, isRelevantPublishedWeek, operationalDateLondon, projectPublishedWeeks, siteDayTotal, type SourcePublication } from "../lib/projection";
import { groupSiteMenuEntries, siteMenuSectionForSlot, siteMenuState, type SiteMenuArtifact } from "../lib/site-menu";
import { assertPrintableCpuEvidence, buildDeliveredInMenuRequests, createGoogleSiteMenu, retireGoogleSiteMenu, weekFolderName } from "../lib/google-site-menu";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import type { ProjectedDay } from "../lib/projection";
import { titleCase } from "../lib/text";
import { applyOrderAction, deliveryCutoff, isBeforeOrderCutoff, orderIdFor, productsForDeliveryDate, rotationWeekForDate, type GrabAndGoProduct } from "../lib/grab-and-go";

const haleon = "oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b";
const accessHaleon = "oploc:46701265-15af-48f4-a230-1d27ca21bc59";
const xchange = "oploc:b835d8ee-b187-49d1-9072-7348b04bfd2d";
const activeOplocRecords = [
  { canonicalId: accessHaleon, entityType: "OPLOC", record: { approvedName: "Haleon", lifecycleState: "active" }, dataHash: "a", lifecycleStatus: "published", publicationStatus: "published" },
  { canonicalId: xchange, entityType: "OPLOC", record: { approvedName: "FIKA Xchange", lifecycleState: "active" }, dataHash: "b", lifecycleStatus: "published", publicationStatus: "published" },
  { canonicalId: "service-definition:delivered-in", entityType: "Service Definition", record: { serviceName: "Delivered-In Lunch", lifecycleState: "active" }, lifecycleStatus: "published", publicationStatus: "published" },
  { canonicalId: "service-arrangement:delivered-in:haleon", entityType: "Service Arrangement", record: { oplocId: accessHaleon, serviceDefinitionId: "service-definition:delivered-in", lifecycleState: "active", effectiveFrom: "2026-01-01" }, lifecycleStatus: "published", publicationStatus: "published" },
  { canonicalId: "service-arrangement:delivered-in:xchange", entityType: "Service Arrangement", record: { oplocId: xchange, serviceDefinitionId: "service-definition:delivered-in", lifecycleState: "active", effectiveFrom: "2026-01-01" }, lifecycleStatus: "published", publicationStatus: "published" },
] as never[];
const source = (days: SourcePublication["days"]): SourcePublication => ({ publicationId: "publication:week", sourceWeekId: "week:1", weekCommencing: "2026-08-24", weekEnding: "2026-08-30", days });
const day = (overrides: Partial<SourcePublication["days"][number]> = {}): SourcePublication["days"][number] => ({ publicationDayId: "publication:day:v1", sourceDayId: "day:mon", date: "2026-08-24", dayName: "Monday", version: 1, status: "published", contentHash: "hash-v1", entries: [{ sourceEntryId: "entry:1", slot: "SALAD 1", dishName: "Mixed Baby Leaf", portions: 20, allocations: [{ destinationId: haleon, destinationLabel: "Haleon", quantity: 10 }, { destinationId: xchange, destinationLabel: "FIKA Xchange", quantity: 10 }], allergens: { milk: "clear" } }], allergenSignoff: { productionChef: { printedName: "Production Chef", signedAt: "2026-08-24T08:00:00Z" }, headChefSiteManager: { printedName: "Head Chef", signedAt: "2026-08-24T08:01:00Z" } }, ...overrides });
const projectAtTestClock = (publications: SourcePublication[], oplocId: string, governed?: Set<string>) => projectPublishedWeeks(publications, oplocId, governed, "2026-08-20");

test("Delivered-In access resolves zero, one and multiple authorised OPLOCs", () => {
  assert.equal(resolveDeliveredInAccess({ email: "unknown@local.fika", role: "viewer" }).access.oplocIds.length, 0);
  assert.deepEqual(resolveDeliveredInAccess({ email: "viewer@local.fika", role: "viewer" }, activeOplocRecords).access.oplocIds, [accessHaleon]);
  assert.deepEqual(resolveDeliveredInAccess({ email: "reviewer@local.fika", role: "reviewer" }, activeOplocRecords).access.oplocIds, [accessHaleon, xchange]);
});

test("Delivered-In access is filtered by the requested enabled service", () => {
  const records = [...activeOplocRecords, { canonicalId: "service-definition:grab-and-go", entityType: "Service Definition", record: { serviceName: "Grab & Go", lifecycleState: "active" }, lifecycleStatus: "published", publicationStatus: "published" }, { canonicalId: "service-arrangement:grab-and-go:haleon", entityType: "Service Arrangement", record: { oplocId: accessHaleon, serviceDefinitionId: "service-definition:grab-and-go", lifecycleState: "active", effectiveFrom: "2026-01-01" }, lifecycleStatus: "published", publicationStatus: "published" }] as never[];
  assert.deepEqual(resolveDeliveredInAccess({ email: "reviewer@local.fika", role: "reviewer" }, records, "grab-and-go").access.oplocIds, [accessHaleon]);
  assert.deepEqual(resolveDeliveredInAccess({ email: "reviewer@local.fika", role: "reviewer" }, records, "delivered-in").access.oplocIds, [accessHaleon, xchange]);
});

test("Delivered-In projection filters by canonical destination ID and quantity", () => {
  const weeks = projectAtTestClock([source([day()])], haleon);
  assert.equal(weeks[0].days[0].entries.length, 1);
  assert.equal(weeks[0].days[0].entries[0].quantity, 10);
  assert.equal(weeks[0].days[0].entries[0].dishName, "Mixed Baby Leaf");
  assert.equal(siteDayTotal(weeks[0].days[0]), 10);
  assertAuthorisedOploc({ email: "viewer@local.fika", oplocIds: [haleon], permissions: ["delivered_in.view"] }, haleon);
  assert.throws(() => assertAuthorisedOploc({ email: "viewer@local.fika", oplocIds: [haleon], permissions: [] }, xchange), (error: any) => error.status === 403);
});

test("Delivered-In preserves intentionally published blank weekdays as navigable days", () => {
  const blankFriday = day({ publicationDayId: "publication:day:fri", sourceDayId: "day:fri", date: "2026-08-28", dayName: "Friday", entries: [] });
  const projected = projectAtTestClock([source([day(), blankFriday])], haleon)[0];
  assert.equal(projected.days.length, 2);
  assert.equal(projected.days[1].entries.length, 0);
  assert.equal(projected.days[1].date, "2026-08-28");
});

test("Delivered-In keeps a valid site visible when another publication allocation is stale", () => {
  const weeks = projectAtTestClock([source([day({ entries: [{ ...day().entries[0], allocations: [{ destinationId: "oploc:stale-haleon", destinationLabel: "Haleon", quantity: 10 }, { destinationId: xchange, destinationLabel: "FIKA Xchange", quantity: 10 }] } as SourcePublication["days"][number]["entries"][number]] })])], xchange, new Set([xchange]));
  assert.equal(weeks[0].days[0].entries[0].dishName, "Mixed Baby Leaf");
  assert.equal(weeks[0].days[0].entries[0].quantity, 10);
});

test("Delivered-In excludes synthetic test weeks outside the operational horizon", () => {
  assert.equal(operationalDateLondon(new Date("2026-08-20T23:30:00Z")), "2026-08-21");
  assert.equal(isRelevantPublishedWeek(source([]), "2026-08-20"), true);
  assert.equal(isRelevantPublishedWeek({ ...source([]), weekCommencing: "2096-05-02", weekEnding: "2096-05-08" }, "2026-08-20"), false);
  const weeks = projectPublishedWeeks([
    source([day()]),
    { ...source([day()]), publicationId: "publication:test", weekCommencing: "2096-05-02", weekEnding: "2096-05-08" },
  ], haleon, undefined, "2026-08-20");
  assert.deepEqual(weeks.map(week => week.weekCommencing), ["2026-08-24"]);
});

test("Delivered-In accepts a live governed OPLOC set for restored venues", () => {
  const restoredHaleon = "oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b";
  const historicalHaleon = "oploc:46701265-15af-48f4-a230-1d27ca21bc59";
  assert.equal(projectPublishedWeeks([source([day({ entries: [{ ...day().entries[0], allocations: [{ destinationId: historicalHaleon, destinationLabel: "Haleon", quantity: 10 }] } as SourcePublication["days"][number]["entries"][number]] })])], restoredHaleon, new Set([restoredHaleon]), "2026-08-20")[0].days[0].entries[0].quantity, 10);
});

test("Delivered-In preserves the exact governed published allocation and rejects corrupt identity", () => {
  const published = projectAtTestClock([source([day()])], haleon)[0].days[0];
  assert.equal(published.entries[0].quantity, 10);
  assert.throws(() => assertPublishedAllocationIntegrity("publication:week", day(), { ...day().entries[0], allocations: [{ destinationLabel: "Unknown venue", quantity: 10 }] }), (error: any) => error.status === 502 && error.message.includes("integrity error"));
});

test("superseded and withdrawn days are excluded, including older immutable versions", () => {
  const weeks = projectAtTestClock([source([day(), day({ publicationDayId: "publication:day:v2", version: 2, contentHash: "hash-v2" }), day({ publicationDayId: "publication:day:withdrawn", version: 3, status: "withdrawn" })])], haleon);
  assert.equal(weeks[0].days.length, 0);
});

test("site allergen projection retains source provenance and original signatories", () => {
  const projected = projectAtTestClock([source([day()])], haleon)[0].days[0];
  assert.equal(projected.publicationDayId, "publication:day:v1");
  assert.equal(projected.version, 1);
  assert.equal(projected.contentHash, "hash-v1");
  assert.equal(projected.allergenSignoff.productionChef?.printedName, "Production Chef");
  assert.equal(projected.allergenSignoff.headChefSiteManager?.signedAt, "2026-08-24T08:01:00Z");
});

test("site allergen projection exposes the archived signed PDF URL for the exact published day", () => {
  const projected = projectAtTestClock([source([day({ driveArchive: { pdfDriveUrl: "https://drive.google.com/file/d/pdf-v1/view", pdfFileName: "Monday-v1.pdf", pdfStatus: "saved" } })])], haleon)[0].days[0];
  assert.equal(projected.publicationDayId, "publication:day:v1");
  assert.equal(projected.drivePdfUrl, "https://drive.google.com/file/d/pdf-v1/view");
  assert.equal(projected.drivePdfFileName, "Monday-v1.pdf");
});

test("site menu grouping keeps site dishes in explicit non-empty sections", () => {
  const entries = projectAtTestClock([source([day()])], haleon)[0].days[0].entries;
  const grouped = groupSiteMenuEntries([...entries, { ...entries[0], sourceEntryId: "soup", slot: "Soup", dishName: "Country Vegetable Soup" }, { ...entries[0], sourceEntryId: "hot", slot: "Hot Meat", dishName: "Jerk Chicken" }]);
  assert.deepEqual(grouped.map(section => section.key), ["salads", "hot_mains", "sides_extras"]);
  assert.equal(grouped.find(section => section.key === "salads")?.entries[0].dishName, "Mixed Baby Leaf");
  assert.equal(siteMenuSectionForSlot("Hot Veg / Vegan"), "hot_mains");
});

test("site menu generation state becomes stale when the immutable source hash changes", () => {
  const artifact: SiteMenuArtifact = { artifactId: "artifact:1", oplocId: haleon, sourceDayId: "day:mon", sourcePublicationDayId: "publication:day:v1", sourceVersion: 1, sourceContentHash: "hash-v1", generatedAt: "2026-08-24T10:00:00Z", generatedBy: "admin@local.fika", driveFileId: "file:1", driveUrl: "https://drive.google.com/file/d/file1/view", fileName: "menu" };
  assert.equal(siteMenuState({ sourceDayId: "day:mon", contentHash: "hash-v1" }, artifact).status, "current");
  assert.equal(siteMenuState({ sourceDayId: "day:mon", contentHash: "hash-v2" }, artifact).status, "stale");
});

test("Delivered-In Drive output uses a deterministic week-commencing folder", () => {
  assert.equal(weekFolderName("2026-08-24"), "WC_2026-08-24");
  assert.equal(weekFolderName(undefined), undefined);
});

test("lowercase Menu Planning names render as title case with attached governed allergen styling", () => {
  assert.equal(titleCase("fika house salad leaf"), "Fika House Salad Leaf");
  const projected = projectAtTestClock([source([day()])], haleon)[0].days[0];
  const menuDay = { ...projected, entries: [
    { ...projected.entries[0], slot: "SALAD 1", dishName: "fika house salad leaf", allergens: { gluten: "contains", milk: "may_contain" } },
    { ...projected.entries[0], sourceEntryId: "entry:2", slot: "Hot Meat", dishName: "mac & cheese", allergens: {} },
  ] as typeof projected.entries };
  const requests = buildDeliveredInMenuRequests(menuDay, { oplocId: haleon, label: "Haleon" }, { pageSize: { width: { magnitude: 10_000_000 }, height: { magnitude: 5_625_000 } }, slides: [
    { objectId: "salad-slide", pageElements: [{ objectId: "salad-anchor", size: { width: { magnitude: 8_800_000 }, height: { magnitude: 4_100_000 } }, transform: { translateX: 600_000, translateY: 900_000 }, shape: { text: { textElements: [{ textRun: { content: "{{SALADS}}" } }] } } }] },
    { objectId: "hot-slide", pageElements: [{ objectId: "hot-anchor", size: { width: { magnitude: 8_800_000 }, height: { magnitude: 4_100_000 } }, transform: { translateX: 600_000, translateY: 900_000 }, shape: { text: { textElements: [{ textRun: { content: "{{HOT_MAINS}}" } }] } } }] },
    { objectId: "empty-sides-slide", pageElements: [{ objectId: "sides-anchor", shape: { text: { textElements: [{ textRun: { content: "{{SIDES_EXTRAS}}" } }] } } }] },
  ] });
  const inserts = requests.filter(request => "insertText" in request).map(request => (request.insertText as { text: string }).text);
  assert.deepEqual(inserts, ["Fika House Salad Leaf", "(Contains: Gluten, May contain: Milk)", "Mac & Cheese"]);
  const firstShape = requests.find(request => "createShape" in request) as { createShape: { elementProperties: { size: { width: { magnitude: number } } } } };
  assert.ok(firstShape.createShape.elementProperties.size.width.magnitude >= 8_000_000);
  const styles = requests.filter(request => "updateTextStyle" in request).map(request => (request.updateTextStyle as { style: { fontFamily: string; fontSize: { magnitude: number }; bold?: boolean; foregroundColor: { opaqueColor: { rgbColor: { red: number; green: number; blue: number } } } } }).style);
  assert.equal(styles[0].fontFamily, "Montserrat");
  assert.ok(styles[0].fontSize.magnitude >= 18);
  assert.equal(styles[1].fontFamily, "Montserrat");
  assert.equal(styles[1].bold, true);
  assert.deepEqual(styles[1].foregroundColor.opaqueColor.rgbColor, { red: 1, green: 0, blue: 0 });
  assert.equal(requests.some(request => "updateShapeProperties" in request && (request.updateShapeProperties as { shapeProperties: { contentAlignment: string } }).shapeProperties.contentAlignment === "MIDDLE"), true);
  assert.equal(requests.some(request => "deleteObject" in request && (request.deleteObject as { objectId: string }).objectId === "empty-sides-slide"), true);
  assert.equal(requests.some(request => "insertText" in request && (request.insertText as { text: string }).text.includes("Mac & cheese")), false);
});

test("the generic menu requires placeholders for every populated section only", () => {
  const published = projectAtTestClock([source([day()])], haleon)[0].days[0];
  const site = { oplocId: haleon, label: "Test site" };
  const slide = (token: string) => ({ objectId: token, pageElements: [{ objectId: "anchor", shape: { text: { textElements: [{ textRun: { content: token } }] } } }] });
  for (const [slot, placeholder] of [["SALAD 1", "{{SALADS}}"], ["Hot Meat", "{{HOT_MAINS}}"], ["Soup", "{{SIDES_EXTRAS}}"]]) {
    const selected = { ...published, entries: [{ ...published.entries[0], slot }] };
    assert.throws(() => buildDeliveredInMenuRequests(selected, site, { slides: [slide("{{SERVICE_DATE}}")] }), {
      code: "MENU_TEMPLATE_SECTION_MISSING", status: 409, message: new RegExp(placeholder),
    });
    assert.doesNotThrow(() => buildDeliveredInMenuRequests(selected, site, { slides: [slide(placeholder)] }));
  }
  const shared = slide("{{SALADS}}");
  shared.pageElements.push({ ...slide("{{HOT_MAINS}}").pageElements[0], objectId: "empty-hot-anchor" });
  const updates = buildDeliveredInMenuRequests(published, site, { slides: [shared] });
  assert.ok(updates.some(update => (update.deleteObject as { objectId?: string })?.objectId === "empty-hot-anchor"));
  assert.ok(!updates.some(update => (update.deleteObject as { objectId?: string })?.objectId === shared.objectId));
});

test("generic output preflight and retry verify dishes and declarations without writing an incomplete document", async t => {
  const settings = {
    FIKA_RUNTIME_MODE: "local", GOOGLE_OAUTH_CLIENT_FILE: "fixture-client", GOOGLE_OAUTH_TOKEN_FILE: "fixture-token",
    GOOGLE_DELIVERED_IN_TEMPLATE_ID: "fixture-template", GOOGLE_DELIVERED_IN_OUTPUT_FOLDER_ID: "fixture-root",
  };
  for (const [key, value] of Object.entries(settings)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  t.mock.method(fs, "readFile", async (file: string) => {
    if (file === "fixture-client") return JSON.stringify({ installed: { client_id: "fixture", client_secret: "fixture" } });
    assert.equal(file, "fixture-token");
    return JSON.stringify({ access_token: "fixture", refresh_token: "fixture" });
  });
  const published = projectAtTestClock([source([day()])], haleon)[0].days[0];
  const reviewed: ProjectedDay = { ...published, cpuReview: { status: "signed", signatures: [] },
    sourceLineage: { cpu: { sourceStatus: "current", sourceCompleteness: "complete", releaseId: "release", releaseVersion: "r1", contentHash: "packet", sourceBundleHash: published.contentHash } },
    entries: [{ ...published.entries[0], allergensVisible: true, allergens: { milk: "may_contain" } }],
  };
  let status: "pending" | "ready" = "pending";
  const shape = (objectId: string, content: string) => ({
    objectId,
    size: { width: { magnitude: 1_000_000 }, height: { magnitude: 100_000 } },
    transform: { translateX: 100_000, translateY: objectId.includes("allergens") ? 300_000 : 100_000 },
    shape: { text: { textElements: [{ textRun: { content } }] } },
  });
  const elements = [shape("fika-delivered-in-salads-0-dish-0", "Mixed Baby Leaf\n")];
  const requests: string[] = [];
  const reply = (body: unknown) => new Response(JSON.stringify(body));
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const request = `${init?.method || "GET"} ${url.pathname}`;
    requests.push(url.searchParams.get("q")?.includes("application/vnd.google-apps.folder") ? "GET week folder" : request);
    switch (request) {
      case "GET /v1/presentations/fixture-template": return reply({ slides: [] });
      case "GET /drive/v3/files": {
        if (url.searchParams.get("q")?.includes("application/vnd.google-apps.folder")) {
          return reply({ files: [{ id: "fixture-week" }] });
        }
        assert.match(url.searchParams.get("q")!, /'fixture-week' in parents/);
        return reply({ files: [{ id: "fixture-copy", parents: ["fixture-week"], ownedByMe: true, appProperties: { fikaDeliveryId: stableDocumentId(`${haleon}:fixture-delivery`), fikaMaterializationStatus: status } }] });
      }
      case "GET /v1/presentations/fixture-copy": return reply({ slides: [{ objectId: "slide", pageElements: elements }] });
      case "PATCH /drive/v3/files/fixture-copy": return reply({});
      default: throw Error(`Unexpected Google request: ${request}`);
    }
  });
  const generate = (delivery?: string) => createGoogleSiteMenu(reviewed, { oplocId: haleon, label: "Test site" }, "fixture", undefined, delivery);
  await assert.rejects(generate(), { code: "MENU_TEMPLATE_SECTION_MISSING" });
  assert.deepEqual(requests.splice(0), ["GET /v1/presentations/fixture-template"]);
  await assert.rejects(generate("fixture-delivery"), { code: "MENU_TEMPLATE_SECTION_MISSING" });
  assert.deepEqual(requests.splice(0), ["GET week folder", "GET /drive/v3/files", "GET /v1/presentations/fixture-copy"]);
  status = "ready";
  await assert.rejects(generate("fixture-delivery"), { code: "MENU_OUTPUT_INCOMPLETE" });
  assert.deepEqual(requests.splice(0), ["GET week folder", "GET /drive/v3/files", "GET /v1/presentations/fixture-copy"]);
  status = "pending";
  elements.push(shape("fika-delivered-in-salads-0-allergens-0", "(May contain: Milk)\n"));
  assert.equal((await generate("fixture-delivery")).driveFileId, "fixture-copy");
  assert.deepEqual(requests, ["GET week folder", "GET /drive/v3/files", "GET /v1/presentations/fixture-copy", "PATCH /drive/v3/files/fixture-copy"]);
});

test("generic menus generate, retry and retire within the selected site owner and folder", async t => {
  const siteA = "oploc:fixture-a", siteB = "oploc:fixture-b", siteC = "oploc:fixture-c";
  const settings = {
    FIKA_RUNTIME_MODE: "local", GOOGLE_OAUTH_CLIENT_FILE: "fixture-client", GOOGLE_OAUTH_TOKEN_FILE: "fixture-token",
    GOOGLE_DELIVERED_IN_TEMPLATE_ID: "generic-template", GOOGLE_DELIVERED_IN_OUTPUT_FOLDER_ID: "app-root",
    GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_FIXTURE_A: "site-a@example.test", GOOGLE_DRIVE_ROOT_FOLDER_ID_OPLOC_FIXTURE_A: "root-a",
    GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_FIXTURE_B: "site-b@example.test", GOOGLE_DRIVE_ROOT_FOLDER_ID_OPLOC_FIXTURE_B: "root-b",
    GOOGLE_DRIVE_OWNER_EMAIL_APP_DELIVERED_IN: "app@example.test",
  };
  for (const [key, value] of Object.entries(settings)) {
    const prior = process.env[key];
    process.env[key] = value;
    t.after(() => { if (prior === undefined) delete process.env[key]; else process.env[key] = prior; });
  }
  let credentialReads = 0;
  t.mock.method(fs, "readFile", async (path: string) => {
    credentialReads++;
    if (path === "fixture-client") return JSON.stringify({ installed: { client_id: "fixture", client_secret: "fixture" } });
    assert.equal(path, "fixture-token"); return JSON.stringify({ access_token: "fixture", refresh_token: "fixture" });
  });
  const published = projectAtTestClock([source([day()])], haleon)[0].days[0];
  const reviewed: ProjectedDay = { ...published, entries: [], cpuReview: { status: "signed", signatures: [] },
    sourceLineage: { cpu: { sourceStatus: "current", sourceCompleteness: "complete", releaseId: "fixture-release", releaseVersion: "v1", contentHash: "fixture-packet", sourceBundleHash: published.contentHash } },
  };
  type FixtureFile = { id: string; parents: string[]; ownedByMe: boolean; mimeType: string; trashed: boolean; appProperties: Record<string, string> };
  const files = new Map<string, FixtureFile>();
  const folderType = "application/vnd.google-apps.folder", slidesType = "application/vnd.google-apps.presentation";
  for (const root of ["root-a", "root-b", "app-root"]) {
    files.set(root, { id: root, parents: [], ownedByMe: true, mimeType: folderType, trashed: false, appProperties: {} });
    files.set(root + "-week", { ...files.get(root)!, id: root + "-week", parents: [root] });
  }
  let copies = 0, calls = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    calls++;
    const url = new URL(input), method = init?.method || "GET", id = url.pathname.split("/").at(-1)!;
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer fixture");
    assert.equal(init?.redirect, "error");
    if (url.hostname === "slides.googleapis.com") {
      if (method === "GET") return Response.json({ slides: [{ objectId: "slide", pageElements: [] }] });
      assert.equal(method, "POST"); return Response.json({});
    }
    assert.equal(url.hostname, "www.googleapis.com");
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      const query = url.searchParams.get("q")!;
      const parent = query.match(/'([^']+)' in parents/)?.[1];
      assert.ok(parent);
      if (query.includes(folderType)) return Response.json({ files: [files.get(parent + "-week")] });
      const delivery = query.match(/key='fikaDeliveryId' and value='([^']+)'/)?.[1];
      assert.ok(delivery);
      return Response.json({ files: [...files.values()].filter(file => file.parents.includes(parent) && file.appProperties.fikaDeliveryId === delivery && !file.trashed) });
    }
    if (method === "POST" && url.pathname.endsWith("/generic-template/copy")) {
      const body = JSON.parse(String(init!.body));
      const file = { id: "copy-" + ++copies, parents: body.parents, ownedByMe: true, mimeType: slidesType, trashed: false, appProperties: body.appProperties };
      files.set(file.id, file); return Response.json({ id: file.id });
    }
    const file = files.get(id);
    if (!file) return Response.json({}, { status: 404 });
    if (method === "PATCH") Object.assign(file, JSON.parse(String(init!.body)));
    else assert.equal(method, "GET");
    return Response.json(file);
  });
  const generate = (oplocId: string) => createGoogleSiteMenu(reviewed, { oplocId, label: oplocId }, "fixture", undefined, "same-event");
  delete process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID_OPLOC_FIXTURE_A;
  await assert.rejects(generate(siteA), { code: "MENU_SITE_DRIVE_NOT_CONFIGURED" });
  await assert.rejects(retireGoogleSiteMenu("legacy", siteA), { code: "MENU_SITE_DRIVE_NOT_CONFIGURED" });
  assert.equal(credentialReads, 0); assert.equal(calls, 0);
  process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID_OPLOC_FIXTURE_A = "root-a";
  const [a, b, c] = [await generate(siteA), await generate(siteB), await generate(siteC)];
  for (const [artifact, parent] of [[a, "root-a-week"], [b, "root-b-week"], [c, "app-root-week"]] as const) {
    const file = files.get(artifact.driveFileId!)!;
    assert.deepEqual(file.parents, [parent]); assert.equal(file.appProperties.fikaMenuFolder, parent);
    assert.ok(file.appProperties.fikaMenuRoute);
    assert.equal((await generate(artifact.oplocId)).driveFileId, file.id);
  }
  assert.equal(copies, 3);
  await retireGoogleSiteMenu(a.driveFileId, siteB);
  assert.equal(files.get(a.driveFileId!)!.trashed, false);
  process.env.GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_FIXTURE_A = "changed@example.test";
  await assert.rejects(generate(siteA), { code: "MENU_DELIVERY_OWNERSHIP_UNVERIFIED" });
  await retireGoogleSiteMenu(a.driveFileId, siteA);
  assert.equal(files.get(a.driveFileId!)!.trashed, false);
  process.env.GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_FIXTURE_A = "site-a@example.test";
  const historical = { ...files.get(c.driveFileId!)!, id: "historical", appProperties: {} };
  files.set(historical.id, historical);
  await retireGoogleSiteMenu(historical.id, siteA);
  assert.equal(historical.trashed, false);
  const moved = files.get(b.driveFileId!)!;
  moved.parents = ["root-a-week"];
  await retireGoogleSiteMenu(moved.id, siteB);
  assert.equal(moved.trashed, false);
  await retireGoogleSiteMenu(a.driveFileId, siteA);
  assert.equal(files.get(a.driveFileId!)!.trashed, true);
});

test("both menu template paths reject missing CPU evidence before reaching Google", async () => {
  const published = projectAtTestClock([source([day()])], haleon)[0].days[0];
  const reviewed: ProjectedDay = {
    ...published,
    cpuReview: { status: "signed", signatures: [] },
    sourceLineage: { cpu: { sourceStatus: "current", sourceCompleteness: "complete", releaseId: "release", releaseVersion: "r1", contentHash: "packet", sourceBundleHash: published.contentHash } },
    entries: published.entries.map(entry => ({ ...entry, allergensVisible: true })),
  };
  const row = reviewed.entries[0];
  assert.doesNotThrow(() => assertPrintableCpuEvidence(reviewed));
  assert.doesNotThrow(() => assertPrintableCpuEvidence({ ...reviewed, entries: [{ ...row, allergens: {}, cpuAllergenState: "clear" }] }));
  for (const oplocId of [haleon, "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f"]) {
    const generate = (candidate: ProjectedDay) => createGoogleSiteMenu(candidate, { oplocId, label: "Test site" }, "test");
    for (const candidate of [
      published,
      { ...reviewed, cpuReview: undefined },
      { ...reviewed, sourceLineage: undefined },
      { ...reviewed, contentHash: "newer-publication" },
      { ...reviewed, sourceLineage: { cpu: { ...reviewed.sourceLineage!.cpu, sourceStatus: "partial" as const } } },
    ]) {
      await assert.rejects(generate(candidate), { code: "MENU_SIGNED_PACKET_REQUIRED", status: 409 });
    }
    const incompleteEntries: ProjectedDay["entries"] = [
      { ...row, allergensVisible: false },
      { ...row, allergensVisible: undefined, allergenEvidenceStatus: "confirmed" as const },
      { ...row, allergens: {} },
      { ...row, allergens: { milk: "unrecorded" as const } },
    ];
    for (const entry of incompleteEntries) {
      await assert.rejects(generate({ ...reviewed, entries: [entry] }), { code: "MENU_ALLERGENS_UNCONFIRMED", status: 409 });
    }
  }
});

const grabProducts: GrabAndGoProduct[] = [
  { productId: "grab:week1", name: "Week One Pot", category: "grab_250ml", rotationWeeks: [1], allowedDeliveryWeekdays: ["Monday"], price: 1.85, active: true, sortOrder: 1 },
  { productId: "grab:week2", name: "Week Two Pot", category: "grab_250ml", rotationWeeks: [2], allowedDeliveryWeekdays: ["Monday"], price: 1.95, active: true, sortOrder: 2 },
];

test("Grab & Go rotation repeats from week 4 to week 1 and filters products by delivery date", () => {
  assert.equal(rotationWeekForDate("2026-08-24"), 1);
  assert.equal(rotationWeekForDate("2026-09-14"), 4);
  assert.equal(rotationWeekForDate("2026-09-21"), 1);
  assert.deepEqual(productsForDeliveryDate(grabProducts, "2026-08-24").map(product => product.productId), ["grab:week1"]);
});

test("Grab & Go orders are OPLOC-scoped, snapshot products, and preserve audit history on amendment", () => {
  const created = applyOrderAction(undefined, { action: "submit", oplocId: haleon, deliveryDate: "2026-08-24", rotationWeek: 1, lines: [{ productId: "grab:week1", quantity: 4 }], actor: "site@local.fika", at: "2026-08-23T10:59:00Z" }, grabProducts);
  assert.equal(created.orderId, orderIdFor(haleon, "2026-08-24"));
  assert.equal(created.lines[0].productName, "Week One Pot");
  assert.equal(created.lines[0].price, 1.85);
  assert.throws(() => applyOrderAction(created, { action: "amend", oplocId: xchange, deliveryDate: "2026-08-24", rotationWeek: 1, lines: [{ productId: "grab:week1", quantity: 2 }], actor: "other@local.fika", at: "2026-08-23T10:00:00Z" }, grabProducts), (error: any) => error.status === 403);
  const amended = applyOrderAction(created, { action: "amend", expectedVersion: 1, oplocId: haleon, deliveryDate: "2026-08-24", rotationWeek: 1, lines: [{ productId: "grab:week1", quantity: 7 }], actor: "site@local.fika", at: "2026-08-23T10:59:30Z" }, grabProducts);
  assert.equal(amended.version, 2);
  assert.equal(amended.lines[0].quantity, 7);
  assert.equal(amended.history.length, 2);
  assert.equal(amended.history[0].lines[0].quantity, 4);
});

test("Grab & Go commands are strict and reject stale versions", () => {
  const created = applyOrderAction(undefined, { action: "submit", oplocId: haleon, deliveryDate: "2026-08-24", rotationWeek: 1, lines: [{ productId: "grab:week1", quantity: 4 }], actor: "site@local.fika", at: "2026-08-23T10:00:00Z" }, grabProducts);
  assert.throws(() => applyOrderAction(created, { action: "submit", oplocId: haleon, deliveryDate: "2026-08-24", rotationWeek: 1, lines: [{ productId: "grab:week1", quantity: 5 }], actor: "site@local.fika", at: "2026-08-23T10:01:00Z" }, grabProducts), (error: any) => error.status === 409 && error.message.includes("Submit only creates"));
  assert.throws(() => applyOrderAction(created, { action: "amend", expectedVersion: 0, oplocId: haleon, deliveryDate: "2026-08-24", rotationWeek: 1, lines: [{ productId: "grab:week1", quantity: 5 }], actor: "site@local.fika", at: "2026-08-23T10:01:00Z" }, grabProducts), (error: any) => error.status === 409 && error.message.includes("Refresh"));
  assert.throws(() => applyOrderAction(undefined, { action: "amend", expectedVersion: 1, oplocId: haleon, deliveryDate: "2026-08-24", rotationWeek: 1, lines: [{ productId: "grab:week1", quantity: 5 }], actor: "site@local.fika", at: "2026-08-23T10:01:00Z" }, grabProducts), (error: any) => error.status === 404);
  assert.throws(() => applyOrderAction(undefined, { action: "cancel", expectedVersion: 1, oplocId: haleon, deliveryDate: "2026-08-24", rotationWeek: 1, actor: "site@local.fika", at: "2026-08-23T10:01:00Z" }, grabProducts), (error: any) => error.status === 404);
});

test("Grab & Go submit, amend and cancel are blocked at the next-day noon cutoff", () => {
  // 2026-08-24 is a BST date: the 12:00 London cutoff is 11:00Z on 2026-08-23.
  assert.equal(isBeforeOrderCutoff("2026-08-24", new Date("2026-08-23T10:59:59Z")), true, "11:59:59 BST is still open");
  assert.equal(isBeforeOrderCutoff("2026-08-24", new Date("2026-08-23T11:00:00Z")), false, "12:00 BST is closed");
  const created = applyOrderAction(undefined, { action: "submit", oplocId: haleon, deliveryDate: "2026-08-24", rotationWeek: 1, lines: [{ productId: "grab:week1", quantity: 1 }], actor: "site@local.fika", at: "2026-08-23T10:00:00Z" }, grabProducts);
  assert.throws(() => applyOrderAction(created, { action: "amend", oplocId: haleon, deliveryDate: "2026-08-24", rotationWeek: 1, lines: [{ productId: "grab:week1", quantity: 2 }], actor: "site@local.fika", at: "2026-08-23T11:00:00Z" }, grabProducts), (error: any) => error.status === 409);
  const cancelled = applyOrderAction(created, { action: "cancel", expectedVersion: 1, oplocId: haleon, deliveryDate: "2026-08-24", rotationWeek: 1, actor: "site@local.fika", at: "2026-08-23T10:30:00Z" }, grabProducts);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.history[1].action, "cancelled");
});

test("Grab & Go cutoff is explicitly Europe/London across GMT and BST", () => {
  assert.equal(deliveryCutoff("2026-01-05").toISOString(), "2026-01-04T12:00:00.000Z");
  assert.equal(deliveryCutoff("2026-07-06").toISOString(), "2026-07-05T11:00:00.000Z");
  assert.equal(isBeforeOrderCutoff("2026-07-06", new Date("2026-07-05T10:59:59.000Z")), true);
  assert.equal(isBeforeOrderCutoff("2026-07-06", new Date("2026-07-05T11:00:00.000Z")), false);
});
