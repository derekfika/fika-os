import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeBookingAdditionalCharges,
  validateLabourRates,
  type BookingAdditionalChargeInput,
} from "../lib/hospitality-additional-charges";
import { bookingAdditionalChargesSchema } from "../lib/hospitality-additional-charges-schema";

const configuredRates = [{ id: "chef", label: "Chef", hourlyRate: 22 }];
const laborLine: BookingAdditionalChargeInput = {
  id: "chef-line-0001",
  kind: "labour",
  category: "labour",
  label: "Chef labour",
  labour: { roleId: "chef", roleLabel: "Chef", staffCount: 2, hoursPerPerson: 5, hourlyRate: 22, multiplier: 1.5, rateSource: "configured" },
};

test("booking charge persistence recalculates manual totals and adds actor timestamps", () => {
  const [charge] = normalizeBookingAdditionalCharges([
    { id: "equipment-01", kind: "manual", category: "equipment", label: "Equipment hire", quantity: 1, unitNet: 150, netTotal: 0 } as unknown as BookingAdditionalChargeInput,
  ], [], [], "manager-1", "2026-10-05T10:00:00.000Z");
  assert.equal(charge.netTotal, 150);
  assert.equal(charge.createdAt, "2026-10-05T10:00:00.000Z");
  assert.equal(charge.createdBy, "manager-1");
  assert.equal(charge.updatedAt, "2026-10-05T10:00:00.000Z");
  assert.equal(charge.updatedBy, "manager-1");
});

test("labour calculator derives staff hours, blended unit rate and rounded line total", () => {
  const [charge] = normalizeBookingAdditionalCharges([laborLine], [], configuredRates, "manager-1", "2026-10-05T10:00:00.000Z");
  assert.equal(charge.quantity, 10);
  assert.equal(charge.unitNet, 33);
  assert.equal(charge.netTotal, 330);
  assert.equal(charge.kind, "labour");
  if (charge.kind === "labour") assert.deepEqual(charge.labour, laborLine.labour);
});

test("configured rates are required for configured-rate lines, while explicit custom rates remain available", () => {
  assert.throws(() => normalizeBookingAdditionalCharges([laborLine], [], [{ id: "chef", label: "Chef" }], "manager", "now"), /configured labour rate is unavailable/);
  const custom: BookingAdditionalChargeInput = { ...laborLine, labour: { ...laborLine.labour, rateSource: "custom", hourlyRate: 24 } };
  assert.equal(normalizeBookingAdditionalCharges([custom], [], [{ id: "chef", label: "Chef" }], "manager", "now")[0].netTotal, 360);
});

test("later labour-settings edits do not rewrite the rate snapshot on an existing Booking charge", () => {
  const original = normalizeBookingAdditionalCharges([laborLine], [], configuredRates, "manager-1", "2026-10-05T10:00:00.000Z");
  const manual: BookingAdditionalChargeInput = { id: "porterage-01", kind: "manual", category: "service", label: "Additional porterage", quantity: 2, unitNet: 45 };
  const updated = normalizeBookingAdditionalCharges([laborLine, manual], original, [{ id: "chef", label: "Chef", hourlyRate: 30 }], "manager-2", "2026-10-06T10:00:00.000Z");
  assert.equal(updated[0].netTotal, 330);
  assert.equal(updated[0].createdAt, original[0].createdAt);
  assert.equal(updated[0].createdBy, original[0].createdBy);
  if (updated[0].kind === "labour") assert.equal(updated[0].labour.hourlyRate, 22);
  assert.equal(updated[1].netTotal, 90);
});

test("labour role settings validate bounded IDs, labels, values and duplicates", () => {
  assert.deepEqual(validateLabourRates(configuredRates), configuredRates);
  assert.throws(() => validateLabourRates([{ id: "chef", label: "Chef" }, { id: "chef", label: "Duplicate" }]), /unique/);
  assert.throws(() => validateLabourRates([{ id: "chef", label: "Chef", hourlyRate: -1 }]), /between £0 and £1,000/);
  assert.throws(() => validateLabourRates(Array.from({ length: 26 }, (_, index) => ({ id: `role-${index}`, label: `Role ${index}` }))), /no more than 25/);
});

test("booking charge route schema accepts commercial inputs and rejects client-supplied totals", () => {
  assert.equal(bookingAdditionalChargesSchema.safeParse([{ id: "equipment-01", kind: "manual", category: "equipment", label: "Equipment hire", quantity: 1, unitNet: 150 }]).success, true);
  assert.equal(bookingAdditionalChargesSchema.safeParse([{ id: "equipment-01", kind: "manual", category: "equipment", label: "Equipment hire", quantity: 1, unitNet: 150, netTotal: 0 }]).success, false);
  assert.equal(bookingAdditionalChargesSchema.safeParse([{ id: "chef-line-0001", kind: "labour", category: "labour", label: "Chef labour", labour: { roleId: "chef", roleLabel: "Chef", staffCount: 2, hoursPerPerson: 5, hourlyRate: 22, multiplier: 1.5, rateSource: "configured" } }]).success, true);
  assert.equal(bookingAdditionalChargesSchema.safeParse([{ ...laborLine, labour: { ...laborLine.labour, hourlyRate: 0 } }]).success, false);
  assert.equal(bookingAdditionalChargesSchema.safeParse(Array.from({ length: 26 }, (_, index) => ({ id: `equipment-${index}`, kind: "manual", category: "equipment", label: "Equipment hire", quantity: 1, unitNet: 1 }))).success, false);
});

test("Hospitality Production Order catering lines are still built only from Booking menu items", () => {
  const productionDomain = readFileSync(new URL("../lib/production-domain.ts", import.meta.url), "utf8");
  assert.match(productionDomain, /const lines: ProductionLine\[\] = booking\.order\.items\.map/);
  assert.doesNotMatch(productionDomain, /booking\.additionalCharges\.map/);
  assert.match(productionDomain, /sourceQuoteRevisionId: quote\.id/);
});
