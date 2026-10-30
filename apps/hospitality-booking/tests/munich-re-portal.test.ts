import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { MUNICH_RE_LOCATIONS as shared } from "@fika/server-shared/hospitality-catalogue";
import { MUNICH_RE_LOCATIONS, munichReLocationDisplay, munichReLocationFields, munichReLocationIdFor } from "../lib/munich-re-locations";

test("the portal's client location list equals the shared Munich RE source", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(MUNICH_RE_LOCATIONS)), JSON.parse(JSON.stringify(shared.map(({ level, ...rest }) => rest))));
});

test("seven rooms and three collection points display exactly as on the booking form", () => {
  assert.deepEqual(MUNICH_RE_LOCATIONS.map(munichReLocationDisplay), ["Acacia (20 seater)", "Aloe (5 seater)", "Ginko (5 seater)", "Ironbark (14 seater)", "Avon (16 seater)", "Amazon (16 seater)", "Flex (Avon and Amazon combined)", "Collection from Level 2 Pantry", "Collection from Level 3 Reception", "Collection from Level 5 Cafe"]);
});

test("rooms persist to roomOrArea and collection points to deliveryPoint, round-tripping to the same selection", () => {
  for (const location of MUNICH_RE_LOCATIONS) {
    const fields = munichReLocationFields(location.id);
    assert.equal(location.kind === "collection-point" ? fields.deliveryPoint : fields.roomOrArea, location.label);
    assert.equal(location.kind === "collection-point" ? fields.roomOrArea : fields.deliveryPoint, "", "never both");
    assert.equal(munichReLocationIdFor(fields), location.id);
  }
  assert.deepEqual(munichReLocationFields("nope"), { roomOrArea: "", deliveryPoint: "" });
});

test("the portal resolves minimums from the site context and only Munich RE gets the selector", () => {
  const source = fs.readFileSync(new URL("../app/ui/BookingPortal.tsx", import.meta.url), "utf8");
  assert.match(source, /minimumContext = \{ gallagher, siteId: site\.key \}/);
  assert.match(source, /siteId: site\.key, guestCount/, "form validation receives the site");
  assert.doesNotMatch(source, /minimumQuantityFor\([^)]*, gallagher\)/);
  assert.match(source, /siteKey === "munich-re" \? \(\s*<select/);
});
