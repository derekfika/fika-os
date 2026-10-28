import test from "node:test";
import assert from "node:assert/strict";
import { BusinessDate, RotationConfiguration, ROTATIONS_SCHEMA, ROTATIONS_AUTHORITY, rotationWeek, londonDate, publishedRevisionFor, freezeRotationSelection, type RotationRevision } from "../../shared/hospitality-rotations";
import { authoriseRotation } from "../lib/hospitality-rotations/auth";
import { MemoryAuthModRepository } from "../lib/authmod-core/memory-repository";
import { V1_APPLICATIONS, type AuthPrincipal } from "../lib/authmod-core/model";
import { createAuthIdentity } from "../lib/authmod-core/identity";
import { grantStandardApplicationAccess } from "../lib/authmod-core/grants";
import { grantAuthority, revokeAuthority } from "../lib/authmod-core/authority";

export function rotationFixture(): RotationConfiguration {
  return RotationConfiguration.parse({ schema: ROTATIONS_SCHEMA, label: "Synthetic autumn", calendar: { anchorMonday: "2026-10-26", cycleWeeks: 6, timeZone: "Europe/London" }, categories: [{ id: "finger-food", label: "Finger Food" }], groups: [{ id: "finger", label: "Finger", categoryId: "finger-food", itemId: "item:rotation", dishBank: [1, 2, 3].map(n => ({ dishId: `dish:${n}`, recipeRevision: 1 })), weeks: Array.from({ length: 6 }, (_, index) => ({ week: index + 1, dishIds: ["dish:1", "dish:2", "dish:3"] })), rules: { guests: { minimum: 6, maximum: 120, increment: 1 }, distinctDishes: { minimum: 3, maximum: 3 }, quantityPerDish: { minimum: 6, maximum: 60, increment: 6 }, unit: "pieces" } }] });
}
test("global calendar repeats across years, negative offsets and DST without elapsed-hour drift", () => {
  const calendar = rotationFixture().calendar;
  for (const [date, week] of [["2026-10-26", 1], ["2026-11-01", 1], ["2026-11-02", 2], ["2026-12-07", 1], ["2026-10-25", 6], ["2027-03-29", 5]] as const) assert.equal(rotationWeek(calendar, date), week);
  assert.equal(londonDate(new Date("2026-03-29T23:30:00Z")), "2026-03-30");
  assert.equal(londonDate(new Date("2026-10-25T00:30:00Z")), "2026-10-25");
  assert.equal(londonDate(new Date("2026-10-25T23:30:00Z")), "2026-10-25");
  assert.equal(londonDate(new Date("2026-06-01T23:01:00Z")), "2026-06-02");
  assert.throws(() => BusinessDate.parse("2026-02-30"));
  assert.throws(() => rotationWeek({ ...calendar, anchorMonday: "2026-10-27" }, "2026-10-28"));
});
test("groups cannot drift, duplicate Item mappings, or schedule unbanked dishes", () => {
  const config = rotationFixture();
  const fails = (mutate: (value: RotationConfiguration) => void) => { const copy = structuredClone(config); mutate(copy); assert.equal(RotationConfiguration.safeParse(copy).success, false); };
  fails(value => { value.groups[0].weeks.pop(); });
  fails(value => { value.groups[0].weeks[0].dishIds[0] = "dish:unknown"; });
  fails(value => { value.groups.push({ ...value.groups[0], id: "another" }); });
  fails(value => { value.calendar.cycleWeeks = 4; });
  const four = structuredClone(config); four.calendar.cycleWeeks = 4; four.groups[0].weeks = four.groups[0].weeks.slice(0, 4);
  assert.equal(RotationConfiguration.safeParse(four).success, true);
  const custom = structuredClone(config); custom.categories.push({ id: "new", label: "New category" }); custom.groups[0].categoryId = "new";
  assert.equal(RotationConfiguration.safeParse(custom).success, true);
});
test("dated publication resolves the whole company and booking references stay frozen", () => {
  const head = { schema: ROTATIONS_SCHEMA, version: 4, activations: [{ effectiveFrom: "2026-10-28", revision: 2 }, { effectiveFrom: "2026-12-01", revision: 4 }] };
  assert.equal(publishedRevisionFor(head, "2026-10-27"), undefined);
  assert.equal(publishedRevisionFor(head, "2026-11-30"), 2);
  assert.equal(publishedRevisionFor(head, "2026-12-01"), 4);
  const revision: RotationRevision = { schema: ROTATIONS_SCHEMA, revision: 2, status: "published", configuration: rotationFixture(), recipes: [1, 2, 3].map(n => ({ dishId: `dish:${n}`, recipeRevision: 1, record: { methodSteps: ["Original"] } })), effectiveFrom: "2026-10-28", actorId: "fixture", recordedAt: "2026-10-28T00:00:00Z", requestId: "request" };
  const input = { eventDate: "2026-10-29", itemId: "item:rotation", guests: 6, selections: [1, 2, 3].map(n => ({ dishId: `dish:${n}`, quantity: 6 })) };
  const frozen = freezeRotationSelection(revision, input);
  const before = structuredClone(frozen);
  revision.configuration.groups[0].rules.unit = "portions";
  assert.deepEqual(frozen, before);
  assert.throws(() => freezeRotationSelection(revision, { ...input, guests: 5 }));
  assert.throws(() => freezeRotationSelection(revision, { ...input, selections: input.selections.slice(1) }));
  assert.throws(() => freezeRotationSelection(revision, { ...input, selections: input.selections.map(value => ({ ...value, quantity: 7 })) }));
  assert.throws(() => freezeRotationSelection({ ...revision, status: "draft" }, input));
});
test("AUTHMOD requires separate explicit View, Manage and Publish grants; revocation and outages close access", async () => {
  const admin: AuthPrincipal = { type: "interactive", id: "synthetic-operator", displayName: "Test operator" };
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS] });
  const identity = await createAuthIdentity(repository, { actor: admin, displayName: "Synthetic manager", email: "rotations@example.test", provenance: "migration" });
  const principal: AuthPrincipal = { type: "interactive", id: identity.id, displayName: identity.displayName };
  await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: ROTATIONS_AUTHORITY.appId, actor: admin });
  identity.fullAccess = true;
  for (const action of ["View", "Manage", "Publish"] as const) await assert.rejects(authoriseRotation(repository, principal, action));
  const grant = await grantAuthority(repository, { subjectType: "interactive", subjectId: identity.id, actor: admin, ...ROTATIONS_AUTHORITY, action: "Manage", scope: { kind: "organisation", ids: [] }, reason: "Synthetic isolated test" });
  await authoriseRotation(repository, principal, "Manage");
  await assert.rejects(authoriseRotation(repository, principal, "View"));
  await assert.rejects(authoriseRotation(repository, principal, "Publish"));
  await revokeAuthority(repository, { grantId: grant.id, actor: principal, reason: "Synthetic revocation" });
  await assert.rejects(authoriseRotation(repository, principal, "Manage"));
  repository.getIdentity = async () => { throw new Error("Synthetic unavailable authority"); };
  await assert.rejects(authoriseRotation(repository, principal, "Manage"));
});
