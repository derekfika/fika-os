export type BookingAdditionalChargeCategory = "labour" | "equipment" | "service" | "other";
export type LabourRateSetting = { id: string; label: string; hourlyRate?: number };

export type BookingAdditionalChargeInput =
  | {
      id: string;
      kind: "manual";
      category: Exclude<BookingAdditionalChargeCategory, "labour">;
      label: string;
      quantity: number;
      unitNet: number;
    }
  | {
      id: string;
      kind: "labour";
      category: "labour";
      label: string;
      labour: {
        roleId?: string;
        roleLabel: string;
        staffCount: number;
        hoursPerPerson: number;
        hourlyRate: number;
        multiplier: number;
        rateSource: "configured" | "custom";
      };
    };

type BookingAdditionalChargeBase = {
  id: string;
  category: BookingAdditionalChargeCategory;
  label: string;
  quantity: number;
  unitNet: number;
  netTotal: number;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
};

export type BookingAdditionalCharge =
  | (BookingAdditionalChargeBase & {
      kind: "manual";
      category: Exclude<BookingAdditionalChargeCategory, "labour">;
    })
  | (BookingAdditionalChargeBase & {
      kind: "labour";
      category: "labour";
      labour: Extract<BookingAdditionalChargeInput, { kind: "labour" }>['labour'];
    });

export const DEFAULT_LABOUR_ROLES: LabourRateSetting[] = [
  { id: "chef", label: "Chef" },
  { id: "foh-assistant", label: "FOH Assistant" },
  { id: "kp", label: "KP" },
];

export const roundQuoteMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

function fail(message: string): never {
  throw Object.assign(new Error(message), { status: 422 });
}

function requirePositive(value: number, label: string, maximum: number) {
  if (!Number.isFinite(value) || value <= 0 || value > maximum)
    fail(`${label} must be greater than zero and within the allowed limit.`);
}

export function validateLabourRates(rates: LabourRateSetting[]) {
  if (!Array.isArray(rates) || rates.length > 25)
    fail("Configure no more than 25 Hospitality labour roles.");
  const seen = new Set<string>();
  return rates.map((rate) => {
    const id = String(rate.id || "").trim();
    const label = String(rate.label || "").trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || !label || label.length > 100)
      fail("Each labour role needs a valid ID and a label of 1 to 100 characters.");
    if (seen.has(id)) fail("Labour role IDs must be unique.");
    seen.add(id);
    if (rate.hourlyRate !== undefined && (!Number.isFinite(rate.hourlyRate) || rate.hourlyRate < 0 || rate.hourlyRate > 1000))
      fail("Labour rates must be between £0 and £1,000 per hour.");
    return { id, label, ...(rate.hourlyRate !== undefined ? { hourlyRate: rate.hourlyRate } : {}) };
  });
}

/** Recalculate a line from its commercial inputs. Client totals are never accepted here. */
export function calculateAdditionalCharge(input: BookingAdditionalChargeInput) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.id)) fail("Each additional charge needs a stable ID.");
  const label = String(input.label || "").trim();
  if (!label || label.length > 120) fail("Charge names must be between 1 and 120 characters.");

  if (input.kind === "manual") {
    if (!["equipment", "service", "other"].includes(input.category)) fail("Choose a valid manual charge category.");
    requirePositive(input.quantity, "Charge quantity", 1000);
    requirePositive(input.unitNet, "Unit net price", 1_000_000);
    const netTotal = roundQuoteMoney(input.quantity * input.unitNet);
    if (!Number.isFinite(netTotal) || netTotal <= 0 || netTotal > 1_000_000)
      fail("The calculated charge must be greater than £0 and no more than £1,000,000.");
    return { id: input.id, kind: "manual" as const, category: input.category, label, quantity: input.quantity, unitNet: input.unitNet, netTotal };
  }

  if (input.category !== "labour") fail("Labour charges must use the labour category.");
  const labour = input.labour;
  if (!labour || !["configured", "custom"].includes(labour.rateSource)) fail("Choose a valid labour rate source.");
  const roleLabel = String(labour.roleLabel || "").trim();
  if (!roleLabel || roleLabel.length > 100) fail("Labour roles must have a name of 1 to 100 characters.");
  if (labour.roleId !== undefined && !/^[A-Za-z0-9_-]{1,80}$/.test(labour.roleId)) fail("The selected labour role is invalid.");
  if (!Number.isInteger(labour.staffCount) || labour.staffCount < 1 || labour.staffCount > 100)
    fail("Staff count must be a whole number between 1 and 100.");
  requirePositive(labour.hoursPerPerson, "Hours per person", 168);
  requirePositive(labour.hourlyRate, "Hourly rate", 1000);
  if (!Number.isFinite(labour.multiplier) || labour.multiplier < 0.25 || labour.multiplier > 5)
    fail("The rate multiplier must be between 0.25× and 5×.");
  if (labour.rateSource === "configured" && !labour.roleId)
    fail("A configured labour rate must reference a configured role.");

  const canonicalLabour = { ...labour, roleLabel };
  const quantity = labour.staffCount * labour.hoursPerPerson;
  const unitNet = labour.hourlyRate * labour.multiplier;
  const netTotal = roundQuoteMoney(quantity * unitNet);
  if (!Number.isFinite(netTotal) || netTotal <= 0 || netTotal > 1_000_000)
    fail("The calculated labour charge must be greater than £0 and no more than £1,000,000.");
  return { id: input.id, kind: "labour" as const, category: "labour" as const, label, quantity, unitNet, netTotal, labour: canonicalLabour };
}

export function validateStoredAdditionalCharge(charge: BookingAdditionalCharge) {
  const calculated = calculateAdditionalCharge(charge.kind === "manual"
    ? { id: charge.id, kind: "manual", category: charge.category, label: charge.label, quantity: charge.quantity, unitNet: charge.unitNet }
    : { id: charge.id, kind: "labour", category: "labour", label: charge.label, labour: charge.labour });
  if (calculated.quantity !== charge.quantity || calculated.unitNet !== charge.unitNet || calculated.netTotal !== charge.netTotal)
    fail("A stored additional charge does not match its server-calculated amount. Review the Booking before quoting.");
  return calculated;
}

export function normalizeBookingAdditionalCharges(
  inputs: BookingAdditionalChargeInput[],
  previous: BookingAdditionalCharge[],
  labourRates: LabourRateSetting[],
  actorId: string,
  now: string,
) {
  if (!Array.isArray(inputs) || inputs.length > 25) fail("A Booking can have no more than 25 additional charges.");
  const rates = validateLabourRates(labourRates);
  const previousById = new Map(previous.map((charge) => [charge.id, charge]));
  const seen = new Set<string>();
  return inputs.map((input) => {
    if (seen.has(input.id)) fail("Each additional charge must have a unique ID.");
    seen.add(input.id);
    const calculated = calculateAdditionalCharge(input);
    const existing = previousById.get(calculated.id);
    if (input.kind === "labour" && input.labour.rateSource === "configured") {
      const configured = rates.find((rate) => rate.id === input.labour.roleId);
      const matchesConfigured = configured?.hourlyRate !== undefined && configured.hourlyRate > 0 && configured.hourlyRate === input.labour.hourlyRate;
      const preservesStoredRate = existing?.kind === "labour" && existing.labour.roleId === input.labour.roleId && existing.labour.rateSource === "configured" && existing.labour.hourlyRate === input.labour.hourlyRate;
      if (!matchesConfigured && !preservesStoredRate)
        fail("That configured labour rate is unavailable or has changed. Refresh the rate or enter a custom hourly rate.");
    }
    const content = { ...calculated, ...(calculated.kind === "labour" ? { labour: structuredClone(calculated.labour) } : {}) };
    if (existing) {
      const oldContent = existing.kind === "labour"
        ? { id: existing.id, kind: existing.kind, category: existing.category, label: existing.label, quantity: existing.quantity, unitNet: existing.unitNet, netTotal: existing.netTotal, labour: existing.labour }
        : { id: existing.id, kind: existing.kind, category: existing.category, label: existing.label, quantity: existing.quantity, unitNet: existing.unitNet, netTotal: existing.netTotal };
      if (JSON.stringify(oldContent) === JSON.stringify(content)) return structuredClone(existing);
      return { ...content, createdAt: existing.createdAt, createdBy: existing.createdBy, updatedAt: now, updatedBy: actorId } as BookingAdditionalCharge;
    }
    return { ...content, createdAt: now, createdBy: actorId, updatedAt: now, updatedBy: actorId } as BookingAdditionalCharge;
  });
}
