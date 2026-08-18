import test from "node:test";
import assert from "node:assert/strict";
import { createEvent, validate } from "../lib/domain.ts";

test("a planner may make a manual active Legend assignment outside suggestions", () => {
  const event = createEvent({ eventName: "Manual", eventType: "Internal Event", description: "Brief", eventDate: "2026-08-02", startTime: "10:00", endTime: "12:00", pax: 10, responsibleOplocId: "oploc:synthetic-north", siteId: "site:synthetic-atrium", eventContact: "Contact", accountableOwnerId: "person:synthetic-event-coordinator", staffingRequirements: [{ id: "staffing:manual", role: "Events Assistant", requiredHeadcount: 1, assignedPersonIds: ["legend:manual-active"], startTime: "09:00", endTime: "12:00", locationId: "oploc:synthetic-north", notes: "Manual planner selection", planningStatus: "Fully Assigned" }] }, "person:synthetic-event-coordinator");
  assert.deepEqual(validate(event), []);
});
