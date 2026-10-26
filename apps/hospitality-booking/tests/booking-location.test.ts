import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bookingLocation, groupLocationView } from "../lib/booking-location";

test("location fields are trimmed and blanks stay missing rather than being invented", () => {
  assert.deepEqual(bookingLocation({ floorLevel: " 7 ", roomOrArea: "   ", deliveryPoint: "" }), { floorLevel: "7", roomOrArea: undefined, deliveryPoint: undefined });
  assert.deepEqual(bookingLocation({}), { floorLevel: undefined, roomOrArea: undefined, deliveryPoint: undefined });
});

test("a group with one shared floor and room is summarised once", () => {
  const view = groupLocationView([{ floorLevel: "7", roomOrArea: "Boardroom" }, { floorLevel: "7", roomOrArea: "Boardroom", deliveryPoint: undefined }]);
  assert.equal(view.shared, true);
  assert.equal(view.first.roomOrArea, "Boardroom");
  assert.equal(view.missingFloorOrRoom, false);
});

test("differing services keep their own floor and room and are not collapsed", () => {
  const view = groupLocationView([{ floorLevel: "7", roomOrArea: "Boardroom" }, { floorLevel: "2", roomOrArea: "Lecture Hall", deliveryPoint: "Loading bay" }]);
  assert.equal(view.shared, false);
  assert.deepEqual(view.rows.map(row => row.roomOrArea), ["Boardroom", "Lecture Hall"]);
  assert.equal(view.rows[1].deliveryPoint, "Loading bay");
  assert.equal(view.rows[0].deliveryPoint, undefined);
});

test("historical incomplete group services report missing floor or room without fabricating values", () => {
  const view = groupLocationView([{ floorLevel: "7" }, { roomOrArea: "Lecture Hall" }]);
  assert.equal(view.shared, false);
  assert.equal(view.missingFloorOrRoom, true);
  assert.equal(view.rows[0].roomOrArea, undefined);
  assert.equal(view.rows[1].floorLevel, undefined);
});

test("grouped and standalone dashboards both render the Location section from the authoritative fields", () => {
  const group = readFileSync(new URL("../app/ui/HospitalityGroupDetail.tsx", import.meta.url), "utf8");
  const standalone = readFileSync(new URL("../app/ui/HospitalityDashboard.tsx", import.meta.url), "utf8");
  assert.ok(group.includes("<GroupLocation services={group.services} />"));
  assert.ok(group.indexOf("<GroupLocation") < group.indexOf('<div className={styles.actions}>'), "location sits above the actions");
  assert.ok(standalone.includes('className="booking-detail__location"'));
  assert.ok(standalone.includes("bookingLocation(booking.service)"));
});
