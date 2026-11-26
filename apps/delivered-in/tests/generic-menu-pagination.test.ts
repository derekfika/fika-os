import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import test from "node:test";
import { buildDeliveredInMenuRequests, createGoogleSiteMenu, hasRenderedMenu } from "../lib/google-site-menu";
import type { ProjectedDay } from "../lib/projection";

type Presentation = Parameters<typeof buildDeliveredInMenuRequests>[2];
type Slide = NonNullable<Presentation["slides"]>[number];
type Element = NonNullable<Slide["pageElements"]>[number];
const width = 10_000_000;
const height = 5_625_000;
const site = { oplocId: "oploc:fixture", label: "Fixture" };

function menu(count: number): ProjectedDay {
  return { publicationId: "published", publicationDayId: "published-day", sourceDayId: "day",
    date: "2026-11-26", weekCommencing: "2026-11-23", dayName: "Thursday", version: 1, contentHash: "fixture", allergenSignoff: {},
    entries: Array.from({ length: count }, (_, index) => ({ sourceEntryId: String(index),
      slot: "Hot Meat", dishName: `Dish ${index + 1}`, quantity: 5, allergensVisible: true,
      allergens: { milk: "contains", gluten: "may_contain" },
    })),
  };
}

function template(tokens = ["HOT_MAINS"]): Presentation {
  return { pageSize: { width: { magnitude: width }, height: { magnitude: height } }, slides: [
    { objectId: "original", pageElements: [{ objectId: "artwork" }, ...tokens.map(token => ({
      objectId: `anchor-${token}`, transform: { translateY: 900_000 },
      size: { height: { magnitude: 4_100_000 } }, shape: { text: { textElements: [{ textRun: { content: `{{${token}}}` } }] } },
    }))] }, { objectId: "closing", pageElements: [] },
  ] };
}

// Apply slide duplication, removal and text placement with the Slides API's
// insertion order. A repeated ID or missing destination is a fixture failure.
function rendered(day: ProjectedDay, original = template()) {
  const deck = structuredClone(original);
  const slides = deck.slides!;
  const shapes = () => slides.flatMap(slide => slide.pageElements || []);
  const requests = buildDeliveredInMenuRequests(day, site, original);
  for (const request of requests) {
    if (request.duplicateObject) {
      const { objectId, objectIds } = request.duplicateObject as { objectId: string; objectIds: Record<string, string> };
      const index = slides.findIndex(slide => slide.objectId === objectId);
      assert.ok(index >= 0);
      const duplicate = structuredClone(slides[index]);
      duplicate.objectId = objectIds[objectId];
      for (const element of duplicate.pageElements!) element.objectId = objectIds[element.objectId] || `${duplicate.objectId}:${element.objectId}`;
      slides.splice(index + 1, 0, duplicate);
    } else if (request.deleteObject) {
      const { objectId } = request.deleteObject as { objectId: string };
      const page = slides.findIndex(slide => slide.objectId === objectId);
      if (page >= 0) slides.splice(page, 1);
      else {
        const owner = slides.find(slide => slide.pageElements?.some(element => element.objectId === objectId));
        assert.ok(owner);
        owner.pageElements = owner.pageElements!.filter(element => element.objectId !== objectId);
      }
    } else if (request.createShape) {
      const { objectId, elementProperties } = request.createShape as { objectId: string; elementProperties: Pick<Element, "size" | "transform"> & { pageObjectId: string } };
      assert.ok(!shapes().some(element => element.objectId === objectId));
      const page = slides.find(slide => slide.objectId === elementProperties.pageObjectId)!;
      page.pageElements!.push({ objectId, size: elementProperties.size, transform: elementProperties.transform });
    } else if (request.insertText) {
      const { objectId, text } = request.insertText as { objectId: string; text: string };
      const element = shapes().find(row => row.objectId === objectId)!;
      element.shape = { text: { textElements: [{ textRun: { content: text } }] } };
    }
  }
  return deck;
}

const rows = (slide: Slide) => slide.pageElements!.filter(element => element.objectId.startsWith("fika-delivered-in-"));

test("twelve dishes keep every declaration visible on consecutive branded continuation slides", () => {
  const day = menu(12);
  const pages = rendered(day).slides!;
  assert.equal(pages.at(-1)!.objectId, "closing");
  const menus = pages.slice(0, -1);
  assert.ok(menus.length > 1);
  const ordered: string[] = [];
  for (const slide of menus) {
    assert.ok(slide.pageElements!.some(element => element.objectId.endsWith("artwork")));
    assert.ok(!slide.pageElements!.some(element => element.objectId.includes("anchor")));
    const elements = rows(slide);
    assert.equal(elements.length % 2, 0);
    elements.forEach((element, index) => {
      const y = element.transform!.translateY!;
      assert.ok(y >= 0 && y + element.size!.height!.magnitude! <= height);
      const text = element.shape!.text!.textElements![0].textRun!.content!;
      if (index % 2) assert.equal(text, "(Contains: Milk, May contain: Gluten)");
      else ordered.push(text);
    });
  }
  assert.deepEqual(ordered, day.entries.map(entry => entry.dishName));
});

test("shared anchors do not duplicate another section and ordinary menus retain their first slide", () => {
  const short = menu(1);
  assert.deepEqual(rendered(short).slides!.map(s => s.objectId), ["original", "closing"]);
  const day = menu(12);
  day.entries.push({ ...day.entries[0], slot: "Salad", dishName: "Mixed Leaf" });
  const deck = rendered(day, template(["SALADS", "HOT_MAINS", "SIDES_EXTRAS"]));
  assert.ok(hasRenderedMenu(day, deck));
  assert.equal(deck.slides!.flatMap(rows).filter(element => element.objectId.includes("salads-0-dish")).length, 1);
});

test("multiple continuations preserve sequence when Slides reports dimensions in points", () => {
  const day = menu(45);
  const deck = template();
  deck.pageSize = { width: { magnitude: width / 12_700, unit: "PT" }, height: { magnitude: height / 12_700, unit: "PT" } };
  const result = rendered(day, deck);
  assert.ok(result.slides!.length > 4);
  assert.ok(hasRenderedMenu(day, result));
  assert.deepEqual(result.slides!.flatMap(rows).filter(row => row.objectId.includes("-dish-"))
    .map(row => row.shape!.text!.textElements![0].textRun!.content), day.entries.map(entry => entry.dishName));
});

test("one dish with declarations too large for an entire slide blocks rendering", () => {
  const day = menu(1);
  day.entries[0].allergenDetailNotes = "Detailed declaration\n".repeat(80);
  assert.throws(() => buildDeliveredInMenuRequests(day, site, template()), { code: "MENU_DISH_OVERFLOW" });
});

test("receipt recovery accepts the ordered multipage output and rejects clipped, split or reordered output", () => {
  const day = menu(12);
  const deck = rendered(day);
  assert.ok(hasRenderedMenu(day, deck));
  const offPage = structuredClone(deck);
  rows(offPage.slides![0])[1].transform!.translateY = height;
  assert.equal(hasRenderedMenu(day, offPage), false);
  const split = structuredClone(deck);
  const first = split.slides![0];
  const declaration = rows(first).at(-1)!;
  first.pageElements = first.pageElements!.filter(element => element !== declaration);
  split.slides![1].pageElements!.push(declaration);
  assert.equal(hasRenderedMenu(day, split), false);
  assert.equal(hasRenderedMenu(day, { ...deck, slides: [...deck.slides!].reverse() }), false);
});

test("a retry after a committed Slides batch certifies the same paginated copy without a second batch", async t => {
  const settings = { FIKA_RUNTIME_MODE: "local", GOOGLE_OAUTH_CLIENT_FILE: "fixture-client",
    GOOGLE_OAUTH_TOKEN_FILE: "fixture-token", GOOGLE_DELIVERED_IN_TEMPLATE_ID: "fixture-template",
    GOOGLE_DELIVERED_IN_OUTPUT_FOLDER_ID: "fixture-root" };
  for (const [key, value] of Object.entries(settings)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  t.mock.method(fs, "readFile", async (file: string) => {
    if (file === "fixture-client") return JSON.stringify({ installed: { client_id: "fixture", client_secret: "synthetic" } });
    assert.equal(file, "fixture-token");
    return JSON.stringify({ access_token: "fixture", refresh_token: "fixture" });
  });
  const day = menu(12);
  day.cpuReview = { status: "signed", signatures: [] };
  day.sourceLineage = { cpu: { sourceStatus: "current", sourceCompleteness: "complete", releaseId: "fixture-release",
    releaseVersion: "v1", contentHash: "packet-hash", sourceBundleHash: day.contentHash } };
  let properties: Record<string, string> | undefined;
  let deck = template();
  let batches = 0, copies = 0, receipts = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    if (url.hostname === "slides.googleapis.com") {
      if (method === "GET") return Response.json(url.pathname.endsWith("fixture-template") ? template() : deck);
      assert.equal(url.pathname, "/v1/presentations/fixture-copy:batchUpdate");
      assert.deepEqual(JSON.parse(String(init?.body)).requests, buildDeliveredInMenuRequests(day, site, deck));
      deck = rendered(day, deck);
      batches++;
      return Response.json({});
    }
    assert.equal(url.hostname, "www.googleapis.com");
    if (url.pathname === "/drive/v3/files" && method === "GET") {
      if (url.searchParams.get("q")?.includes("application/vnd.google-apps.folder")) return Response.json({ files: [{ id: "fixture-week" }] });
      return Response.json({ files: properties ? [{ id: "fixture-copy", parents: ["fixture-week"], ownedByMe: true, appProperties: properties }] : [] });
    }
    if (method === "POST" && url.pathname.endsWith("/fixture-template/copy")) {
      copies++;
      properties = JSON.parse(String(init?.body)).appProperties;
      return Response.json({ id: "fixture-copy" });
    }
    assert.equal(method, "PATCH");
    assert.equal(url.pathname, "/drive/v3/files/fixture-copy");
    if (++receipts === 1) return Response.json({ error: "simulated receipt outage" }, { status: 503 });
    properties = JSON.parse(String(init?.body)).appProperties;
    return Response.json({});
  });
  const generate = () => createGoogleSiteMenu(day, site, "fixture", undefined, "delivery");
  await assert.rejects(generate(), /503/);
  assert.equal((await generate()).driveFileId, "fixture-copy");
  assert.deepEqual({ copies, batches, receipts }, { copies: 1, batches: 1, receipts: 2 });
  assert.equal(properties?.fikaMenuSections, "paginated-v1");
  // Recheck an older ready receipt whose text was present but physically clipped.
  properties!.fikaMenuSections = "checked";
  rows(deck.slides![0])[1].transform!.translateY = height;
  await assert.rejects(generate(), { code: "MENU_OUTPUT_INCOMPLETE" });
  assert.deepEqual({ copies, batches, receipts }, { copies: 1, batches: 1, receipts: 2 });
});
