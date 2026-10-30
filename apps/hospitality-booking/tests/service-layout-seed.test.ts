import assert from "node:assert/strict";
import test from "node:test";
import { SERVICE_LAYOUT_SEED, effectiveServiceLayout, resolveServiceCategories } from "@fika/server-shared/hospitality-service-layout";
import { rcoaEventTypes } from "../lib/rcoa-portal";

// The shared portal's `allowed` map (app/ui/BookingPortal.tsx) as of this change, copied as evidence that the seed is today's behaviour.
const bookingPortalAllowed: Record<string, string[]> = {
  breakfast: ["Drinks", "Breakfast", "Sweet treats"],
  lunch: ["Lunch", "Lunch Boxes", "Salads & Sushi", "Grazing Boxes", "Sweet treats"],
  afternoon: ["Afternoon", "Sweet treats", "Finger Food", "Drinks"],
  meeting_hospitality: ["Drinks", "Breakfast", "Lunch", "Lunch Boxes", "Salads & Sushi", "Sweet treats", "Afternoon"],
  event_catering: ["Fork Buffet & Bowl Food", "Canapes", "Grazing Events", "Drinks"],
  bespoke: ["Bespoke Events", "Grazing Events", "Dining"],
};

test("the seeded service layout reproduces RCoA's hard-coded categories for every RCoA service, in order", () => {
  const layout = effectiveServiceLayout();
  for (const event of rcoaEventTypes) assert.deepEqual(resolveServiceCategories(layout, "oploc:any-site", event.id), [...event.categories], event.id);
  assert.deepEqual(rcoaEventTypes.map(event => event.id).sort(), Object.keys(SERVICE_LAYOUT_SEED).sort(), "the seed defines exactly the RCoA services");
});

test("the seeded service layout reproduces the shared BookingPortal map for every service it offers", () => {
  const layout = effectiveServiceLayout();
  for (const [service, categories] of Object.entries(bookingPortalAllowed)) assert.deepEqual(resolveServiceCategories(layout, undefined, service), categories, service);
});
