import assert from "node:assert/strict";
import test from "node:test";
import { assertAuthorisedOploc, projectPublishedWeeks, type ProjectedDay } from "../lib/projection";
import { oneOffSitesFromPackets } from "../lib/server";
import { buildDeliveredInDayProjection } from "../lib/delivered-in-projection-materialiser";
import { deliveredInMenuFromDay } from "../lib/menu-adapter";
import { buildDeliveredInMenuRequests } from "../lib/google-site-menu";
import { menuAllergenLine } from "@fika/server-shared/menu-artifact";

const destination = { kind: "one-off" as const, id: "day:synthetic:one-off:1", sourceDayId: "day:synthetic", label: "Synthetic event", address: "10 Test Street" };
const packet = { schemaVersion: 1, publicationId: "publication:synthetic", sourceWeekId: "week:synthetic", week: { weekCommencing: "2098-11-03", weekEnding: "2098-11-09" }, days: [{ publicationDayId: "published:synthetic", sourceDayId: destination.sourceDayId, date: "2098-11-03", dayName: "Monday", version: 1, status: "published" as const, contentHash: "hash", allergenSignoff: {}, entries: [{ sourceEntryId: "entry:synthetic", dishName: "Synthetic dish", slot: "SOUP", portions: 7, allocations: [{ destination, destinationLabel: destination.label, quantity: 7 }], allergens: { tree_nuts: "contains" as const } }] }] };

test("one-off discovery uses only current allocated published identities and keeps site authority explicit", () => {
  const sites = oneOffSitesFromPackets([packet]);
  assert.equal(sites[0].oplocId, destination.id);
  assert.deepEqual(sites[0].destination, destination);
  assert.throws(() => assertAuthorisedOploc({ email: "synthetic-site", oplocIds: ["oploc:synthetic"], permissions: [] }, destination.id), { status: 403 });
  assert.throws(() => assertAuthorisedOploc({ email: "synthetic-admin", oplocIds: [], permissions: [], canViewOneOffDestinations: true, oneOffDestinationIds: [] }, destination.id), { status: 403 });
  assert.doesNotThrow(() => assertAuthorisedOploc({ email: "synthetic-admin", oplocIds: [], permissions: [], canViewOneOffDestinations: true, oneOffDestinationIds: sites.map(site => site.oplocId) }, destination.id));
  assert.deepEqual(oneOffSitesFromPackets([{ ...packet, publicationStatus: "withdrawn" }]), []);
  assert.deepEqual(oneOffSitesFromPackets([{ ...packet, days: [...packet.days, { ...packet.days[0], version: 2, status: "withdrawn" }] }]), []);
  assert.deepEqual(oneOffSitesFromPackets([{ ...packet, days: [{ ...packet.days[0], entries: [] }] }]), []);
  assert.throws(() => oneOffSitesFromPackets([{ ...packet, days: [{ ...packet.days[0], entries: [{ ...packet.days[0].entries[0], allocations: [{ ...packet.days[0].entries[0].allocations[0], destination: { ...destination, sourceDayId: "another-day" } }] }] }] }]), /does not belong/);
});

test("one-off publication projects exact quantities, name and routing snapshot without OPLOC fabrication", () => {
  const source = { publicationId: packet.publicationId, sourceWeekId: packet.sourceWeekId, weekCommencing: packet.week.weekCommencing, weekEnding: packet.week.weekEnding, days: packet.days };
  const projected = projectPublishedWeeks([source], destination.id, new Set(), "2098-11-03")[0].days[0];
  assert.equal(projected.entries[0].quantity, 7);
  assert.deepEqual(projected.destinations?.[0].destination, destination);
  assert.equal(projectPublishedWeeks([source], "oploc:synthetic", new Set(["oploc:synthetic"]), "2098-11-03")[0].days[0].entries.length, 0);
});

const day: ProjectedDay = { publicationId: "publication:synthetic", publicationDayId: "published:synthetic", sourceDayId: destination.sourceDayId, date: "2098-11-03", dayName: "Monday", version: 1, contentHash: "hash", allergenSignoff: {}, entries: [{ sourceEntryId: "entry:synthetic", canonicalDishId: "dish:synthetic", slot: "SOUP", dishName: "Synthetic dish", quantity: 7, allergens: { tree_nuts: "contains" }, allergenEvidenceStatus: "unreviewed", allergenDetailNotes: "Unsigned source detail", mayContainNotes: "Unsigned source note" }] };

test("only current signed CPU evidence supplies details; additional CPU declarations are retained", async () => {
  const input = { request: {} as never, site: { oplocId: destination.id, label: destination.label, destination }, day, governed: false };
  const pending = await buildDeliveredInDayProjection({ ...input, loadReview: async () => undefined });
  assert.equal(pending.entries[0].allergenDetailNotes, undefined);
  assert.equal(pending.entries[0].mayContainNotes, undefined);
  const signed = await buildDeliveredInDayProjection({ ...input, loadReview: async () => ({ entries: new Map([["dish:synthetic", { allergens: { tree_nuts: "contains", gluten: "contains", sesame: "may_contain" }, allergenState: "contains", allergenDetailNotes: "Almond and wheat", mayContainNotes: "Shared sesame equipment" }]]), cpuReview: { status: "signed", signatures: [] }, orderIds: [] }) });
  const row = signed.entries[0];
  assert.equal(row.allergens.gluten, "contains", "CPU additions not present in the Menu draft survive");
  assert.equal(row.allergenDetailNotes, "Almond and wheat");
  assert.equal(row.mayContainNotes, "Shared sesame equipment");
  assert.equal(row.allergensVisible, true);
  assert.equal(signed.state.exceptions.length, 0);
  const sharedMenu = deliveredInMenuFromDay(signed, { oplocId: "oploc:66e621fa-6e6f-4f46-9aed-462313abbe8f", label: "MNK" });
  assert.match(menuAllergenLine(sharedMenu.sections[0].items[0]), /Specific allergens: Almond and wheat; May contain: Shared sesame equipment/);
  const slideRequests = buildDeliveredInMenuRequests(signed, input.site, { slides: [{ objectId: "slide:synthetic", pageElements: [{ objectId: "anchor:synthetic", shape: { text: { textElements: [{ textRun: { content: "{{SIDES_EXTRAS}}" } }] } } }] }] });
  const text = JSON.stringify(slideRequests);
  assert.match(text, /Specific allergens: Almond and wheat/);
  assert.match(text, /May contain: Shared sesame equipment/);
});
