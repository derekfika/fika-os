import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeBookingAdditionalCharges,
  validateStoredAdditionalCharge,
  validateLabourRates,
  type BookingAdditionalCharge,
  type BookingAdditionalChargeInput,
} from "../lib/hospitality-additional-charges";
import { APPROVED_LABOUR_ROLES } from "../../shared/hospitality-labour-rates";
import { bookingAdditionalChargesSchema } from "../lib/hospitality-additional-charges-schema";

const configuredRates = [{ id: "chef", label: "Chef", hourlyRate: 22 }];
const NOW = "2026-10-05T10:00:00.000Z";
const governedLine = (labour: Partial<Extract<BookingAdditionalChargeInput, { kind: "labour" }>["labour"]> = {}): BookingAdditionalChargeInput => ({
  id: "kp-line-0001", kind: "labour", category: "labour", label: "KP labour",
  labour: { roleId: "kp", roleLabel: "KP", staffCount: 2, hoursPerPerson: 5, hourlyRate: 17.7, multiplier: 1, rateSource: "governed", ...labour },
});
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

const storedLegacy = (input: BookingAdditionalChargeInput, quantity: number, unitNet: number, netTotal: number) =>
  ({ ...input, quantity, unitNet, netTotal, createdAt: "2026-09-01T10:00:00.000Z", createdBy: "manager-0", updatedAt: "2026-09-01T10:00:00.000Z", updatedBy: "manager-0" }) as BookingAdditionalCharge;

test("governed labour derives staff hours, unit rate and rounded line total for Normal and Overtime", () => {
  const [normal] = normalizeBookingAdditionalCharges([governedLine()], [], [], "manager-1", NOW);
  assert.equal(normal.quantity, 10);
  assert.equal(normal.unitNet, 17.7);
  assert.equal(normal.netTotal, 177);
  const [overtime] = normalizeBookingAdditionalCharges([governedLine({ multiplier: 1.5 })], [], [], "manager-1", NOW);
  assert.equal(Math.round(overtime.unitNet * 10000) / 10000, 26.55);
  assert.equal(overtime.netTotal, 265.5);
  if (overtime.kind === "labour") assert.equal(overtime.labour.rateSource, "governed");
});

test("every approved role is accepted at its exact normal rate with multiplier 1 or 1.5 (legacy sources tolerated during rollout)", () => {
  for (const role of APPROVED_LABOUR_ROLES) {
    for (const multiplier of [1, 1.5]) {
      for (const rateSource of ["governed", "custom"] as const) {
        const out = normalizeBookingAdditionalCharges([governedLine({ roleId: role.id, roleLabel: role.label, hourlyRate: role.normalRate, multiplier, rateSource })], [], [], "m", NOW);
        assert.equal(out.length, 1, `${role.id} x${multiplier} ${rateSource}`);
      }
    }
  }
});

test("the Hub rejects any new labour line that is not on the locked approved table", () => {
  const reject = (labour: Parameters<typeof governedLine>[0], pattern: RegExp, label: string) =>
    assert.throws(() => normalizeBookingAdditionalCharges([governedLine(labour)], [], [], "m", NOW), pattern, label);
  reject({ hourlyRate: 17.71 }, /locked/, "wrong hourly rate");
  reject({ hourlyRate: 26.55 }, /locked/, "overtime rate sent as hourly rate");
  reject({ roleId: "sous-chef", roleLabel: "Sous Chef", hourlyRate: 37.6302 }, /approved labour role/, "unknown role");
  reject({ roleId: undefined }, /approved labour role|reference a role/, "missing governed role identity");
  reject({ roleId: undefined, rateSource: "custom" }, /approved labour role/, "missing role identity on a custom-sourced line");
  reject({ roleLabel: "Kitchen Porter" }, /must match the approved role/, "role label spoof");
  reject({ multiplier: 2 }, /Normal .* or Overtime/, "multiplier 2");
  reject({ multiplier: 1.25 }, /Normal .* or Overtime/, "arbitrary multiplier");
  reject({ multiplier: 1.5000001 }, /Normal .* or Overtime/, "near-1.5 multiplier");
  reject({ rateSource: "custom", hourlyRate: 24 }, /locked/, "custom hourly rate");
  reject({ rateSource: "configured", hourlyRate: 22, roleId: "chef", roleLabel: "Chef" }, /locked|configured labour rate is unavailable/, "manager-configured rate");
});

test("a manager-configured rate cannot override the locked table", () => {
  const settingsRate = [{ id: "kp", label: "KP", hourlyRate: 40 }];
  assert.throws(() => normalizeBookingAdditionalCharges([governedLine({ rateSource: "configured", hourlyRate: 40 })], [], settingsRate, "m", NOW), /locked/);
});

test("direct API payloads cannot bypass the lock: the route schema passes them but normalisation rejects them", () => {
  const payload = [governedLine({ rateSource: "custom", hourlyRate: 1, multiplier: 5 })];
  assert.equal(bookingAdditionalChargesSchema.safeParse(payload).success, true);
  assert.throws(() => normalizeBookingAdditionalCharges(payload, [], [], "m", NOW), /locked|Normal/);
  assert.equal(bookingAdditionalChargesSchema.safeParse([governedLine()]).success, true);
});

test("legacy custom and configured labour lines stay readable, quotable and byte-identical when resubmitted unchanged", () => {
  for (const rateSource of ["custom", "configured"] as const) {
    const legacy: BookingAdditionalChargeInput = { ...laborLine, labour: { ...laborLine.labour, rateSource } };
    const stored = storedLegacy(legacy, 10, 33, 330);
    assert.equal(validateStoredAdditionalCharge(stored).netTotal, 330);
    const again = normalizeBookingAdditionalCharges([legacy], [stored], [], "manager-2", "2026-10-06T10:00:00.000Z");
    assert.deepEqual(again[0], stored);
  }
});

test("changing a legacy line, or replacing it with another unapproved line, is held to the lock", () => {
  const stored = storedLegacy(laborLine, 10, 33, 330);
  const changedHours: BookingAdditionalChargeInput = { ...laborLine, labour: { ...laborLine.labour, hoursPerPerson: 6 } };
  assert.throws(() => normalizeBookingAdditionalCharges([changedHours], [stored], configuredRates, "m", NOW), /locked/);
  const relabelled: BookingAdditionalChargeInput = { ...laborLine, label: "Chef labour (edited)" };
  assert.throws(() => normalizeBookingAdditionalCharges([relabelled], [stored], configuredRates, "m", NOW), /locked/);
  const replacement = normalizeBookingAdditionalCharges([governedLine({ roleId: "chef", roleLabel: "Chef", hourlyRate: 25.5234, multiplier: 1.5 })], [stored], [], "m", NOW);
  assert.equal(replacement[0].kind, "labour");
});

test("later labour-settings edits do not rewrite a legacy rate snapshot, and an unrelated charge edit keeps it intact", () => {
  const stored = storedLegacy(laborLine, 10, 33, 330);
  const manual: BookingAdditionalChargeInput = { id: "porterage-01", kind: "manual", category: "service", label: "Additional porterage", quantity: 2, unitNet: 45 };
  const updated = normalizeBookingAdditionalCharges([laborLine, manual], [stored], [{ id: "chef", label: "Chef", hourlyRate: 30 }], "manager-2", "2026-10-06T10:00:00.000Z");
  assert.deepEqual(updated[0], stored);
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
  assert.match(productionDomain, /const lines: ProductionLine\[\] = booking\.order\.items\.(?:flatMap|map)/);
  assert.doesNotMatch(productionDomain, /booking\.additionalCharges\.map/);
  assert.match(productionDomain, /sourceQuoteRevisionId: quote\.id/);
});
