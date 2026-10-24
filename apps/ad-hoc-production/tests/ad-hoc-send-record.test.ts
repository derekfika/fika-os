import assert from "node:assert/strict";
import test from "node:test";
import { applySendRecord, type AdHocRequest } from "../lib/ad-hoc-domain";

const request = (overrides: Partial<AdHocRequest> = {}): AdHocRequest => ({
  id: "adhoc-request:1", reference: "REQ-2026-001", schemaVersion: 2, version: 4, createdAt: "", createdBy: "u", updatedAt: "", updatedBy: "u", status: "DRAFT", audit: [],
  eventName: "Board lunch", serviceDate: "2026-10-31", requiredReadyTime: "12:00", category: "board_meeting", guestCount: 20,
  destination: { mode: "one_off", label: "Client", address: "1 Street", identity: "adhoc-destination:adhoc-request:1" }, lines: [],
  ...overrides,
});

test("recording a send: first-time and repeated (concurrent double send) outcomes", () => {
  const first = applySendRecord(request(), 4, "order:1", "u", "t");
  assert.equal(first.status, "SENT_TO_CPU");
  assert.equal(first.sentVersion, 4);
  assert.equal(first.version, 5);
  assert.equal(first.audit.at(-1)?.action, "sent-to-cpu");
  assert.equal(applySendRecord(first, 4, "order:1", "u", "t2"), first, "already recorded: no second version, no spurious Needs update");
});

test("recording a send never resurrects a cancelled request and supersedes an archive", () => {
  const cancelled = request({ status: "CANCELLED", version: 6, productionOrderId: "order:1" });
  assert.equal(applySendRecord(cancelled, 4, "order:1", "u", "t"), cancelled);
  const archived = applySendRecord(request({ archivedAt: "earlier", version: 5 }), 5, "order:1", "u", "t");
  assert.equal(archived.archivedAt, undefined);
  assert.equal(archived.status, "SENT_TO_CPU");
});

test("a request edited while its send was in flight is flagged Needs update", () => {
  const edited = applySendRecord(request({ version: 5 }), 4, "order:1", "u", "t");
  assert.equal(edited.status, "NEEDS_UPDATE");
  assert.equal(edited.sentVersion, 4);
  assert.equal(edited.productionOrderId, "order:1");
});

test("a later send of a changed version is recorded as an update", () => {
  const sent = applySendRecord(request(), 4, "order:1", "u", "t");
  const edited = { ...sent, status: "NEEDS_UPDATE" as const };
  const resent = applySendRecord(edited, edited.version, "order:1", "u", "t3");
  assert.equal(resent.status, "SENT_TO_CPU");
  assert.equal(resent.sentVersion, edited.version);
  assert.equal(resent.audit.at(-1)?.action, "update-sent-to-cpu");
  const movedOn = applySendRecord({ ...edited, version: edited.version + 1 }, edited.version, "order:1", "u", "t4");
  assert.equal(movedOn.status, "NEEDS_UPDATE", "edited again while the update was in flight");
});
