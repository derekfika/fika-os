/**
 * Approved Hospitality labour rates (TCTE) — single governed source.
 *
 * Source: "Overtime Rate 2025.xlsx", sheet "Events" (Event Overtime Rate).
 * The workbook's *TCTE column is the OVERTIME-loaded figure:
 *   TCTE(overtime) = basic × 1.5 × (1 + 15% NIN + 3% pension) = basic × 1.5 × 1.18
 * The normal TCTE is therefore the same cost without the 1.5 uplift:
 *   TCTE(normal)   = basic × 1.18
 * Both are locked below as literals so the UI never re-derives (or double-applies) them.
 * The basic rate / NI / pension components are intentionally NOT exported to the UI;
 * tests/labour-calculator.test.ts proves the literals equal the derivation.
 *
 * Rates are net of VAT ("amount to be charged to the client before VAT").
 * Overtime is a single approved multiplier: 1.5×.
 */

export const OVERTIME_MULTIPLIER = 1.5;
export const NORMAL_MULTIPLIER = 1;
export const MAX_STAFF = 100;
export const MAX_HOURS = 168;

export type LabourRole = {
  /** Stable role identity stored on the charge (never the label). */
  id: string;
  /** Workbook naming. */
  label: string;
  /** Normal TCTE £/hour, net of VAT. */
  normalRate: number;
  /** Overtime TCTE £/hour (1.5×), net of VAT — equals the workbook's TCTE figure. */
  overtimeRate: number;
};

export const APPROVED_LABOUR_ROLES: readonly LabourRole[] = Object.freeze([
  { id: "kp", label: "KP", normalRate: 17.7, overtimeRate: 26.55 },
  { id: "ga-barista", label: "GA/Barista", normalRate: 17.7, overtimeRate: 26.55 },
  { id: "chef", label: "Chef", normalRate: 25.5234, overtimeRate: 38.2851 },
  { id: "head-chef", label: "Head Chef", normalRate: 34.043, overtimeRate: 51.0645 },
  { id: "manager", label: "Manager", normalRate: 31.27, overtimeRate: 46.905 },
].map((role) => Object.freeze(role)));

export function findApprovedRole(roleId: string | undefined) {
  return roleId ? APPROVED_LABOUR_ROLES.find((role) => role.id === roleId) : undefined;
}

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type LabourCalculationInput = { roleId: string; staffCount: number; hours: number; overtime: boolean };
export type LabourCalculation = {
  role: LabourRole;
  /** Stored charge fields: hourlyRate is ALWAYS the normal TCTE; multiplier is 1 or 1.5. */
  hourlyRate: number;
  multiplier: 1 | 1.5;
  net: number;
};

export type LabourValidation = { ok: true; value: LabourCalculation } | { ok: false; error: string };

/** Mirrors the Hub's charge maths: staff × hours × (hourlyRate × multiplier), rounded to pence once. */
export function calculateLabour(input: LabourCalculationInput): LabourValidation {
  const role = findApprovedRole(input.roleId);
  if (!role) return { ok: false, error: "Choose an approved labour role." };
  if (typeof input.overtime !== "boolean") return { ok: false, error: "Choose Normal or Overtime." };
  if (typeof input.staffCount !== "number" || !Number.isInteger(input.staffCount) || input.staffCount < 1 || input.staffCount > MAX_STAFF) {
    return { ok: false, error: `Staff count must be a whole number from 1 to ${MAX_STAFF}.` };
  }
  if (typeof input.hours !== "number" || !Number.isFinite(input.hours) || input.hours <= 0 || input.hours > MAX_HOURS) {
    return { ok: false, error: `Hours must be more than 0 and no more than ${MAX_HOURS}.` };
  }
  const multiplier = input.overtime ? OVERTIME_MULTIPLIER : NORMAL_MULTIPLIER;
  const net = roundMoney(input.staffCount * input.hours * (role.normalRate * multiplier));
  return { ok: true, value: { role, hourlyRate: role.normalRate, multiplier, net } };
}

/** A stored line is "approved" when it is an approved role at the normal TCTE with a 1× or 1.5× multiplier. */
export function isApprovedLabourLine(labour: { roleId?: string; hourlyRate: number; multiplier: number }) {
  const role = findApprovedRole(labour.roleId);
  return !!role && labour.hourlyRate === role.normalRate && (labour.multiplier === NORMAL_MULTIPLIER || labour.multiplier === OVERTIME_MULTIPLIER);
}

export type GovernedLabourLine = {
  roleId?: string;
  roleLabel: string;
  hourlyRate: number;
  multiplier: number;
};

/**
 * Hub-side lock for NEW or CHANGED labour lines: approved role identity + exact locked normal TCTE +
 * multiplier exactly 1 (Normal) or 1.5 (Overtime). Returns a message when the line is not permitted.
 * Never applied to stored/historical lines (they stay readable and quotable exactly as saved).
 */
export function governedLabourViolation(labour: GovernedLabourLine): string | null {
  const role = findApprovedRole(labour.roleId);
  if (!role) return "Labour must use an approved labour role.";
  if (labour.roleLabel !== role.label) return "Labour role name must match the approved role.";
  if (labour.hourlyRate !== role.normalRate) return "Labour rates are locked. Use the approved rate for this role.";
  if (labour.multiplier !== NORMAL_MULTIPLIER && labour.multiplier !== OVERTIME_MULTIPLIER) return "Labour is charged at Normal (1×) or Overtime (1.5×) only.";
  return null;
}
