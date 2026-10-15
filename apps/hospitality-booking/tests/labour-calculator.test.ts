import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { APPROVED_LABOUR_ROLES, MAX_HOURS, OVERTIME_MULTIPLIER, calculateLabour, findApprovedRole, isApprovedLabourLine } from "../lib/labour-rates";

const dashboard = readFileSync(new URL("../app/ui/HospitalityDashboard.tsx", import.meta.url), "utf8");
const editorStart = dashboard.indexOf('editor?.kind === "labour" && (');
const editorSource = dashboard.slice(editorStart, dashboard.indexOf('additional-charges-modal__error', editorStart));

// Workbook "Events" sheet: basic £/hr in pence. Workbook *TCTE (col F) = basic × 1.5 × 1.18 = the OVERTIME figure.
const WORKBOOK = [
  { id: "kp", label: "KP", basicPence: 1500, workbookTcte: 26.55 },
  { id: "ga-barista", label: "GA/Barista", basicPence: 1500, workbookTcte: 26.55 },
  { id: "chef", label: "Chef", basicPence: 2163, workbookTcte: 38.2851 },
  { id: "head-chef", label: "Head Chef", basicPence: 2885, workbookTcte: 51.0645 },
  { id: "manager", label: "Manager", basicPence: 2650, workbookTcte: 46.905 },
];
// pence × 118 = 1e-4 pounds/hour for normal TCTE (integer arithmetic, no float drift)
const fromTenThousandths = (n: number) => Number((n / 10000).toFixed(4));

test("every approved role carries the workbook normal and 1.5x overtime TCTE", () => {
  assert.deepEqual(APPROVED_LABOUR_ROLES.map((r) => r.id), WORKBOOK.map((r) => r.id));
  for (const row of WORKBOOK) {
    const role = findApprovedRole(row.id)!;
    assert.equal(role.label, row.label);
    assert.equal(role.normalRate, fromTenThousandths(row.basicPence * 118), `${row.label} normal`);
    assert.equal(role.overtimeRate, row.workbookTcte, `${row.label} overtime equals workbook TCTE`);
    assert.equal(fromTenThousandths(row.basicPence * 118 * 1.5), role.overtimeRate, `${row.label} overtime = normal x 1.5`);
  }
});

test("normal calculation uses the normal TCTE and multiplies by staff and hours", () => {
  const r = calculateLabour({ roleId: "chef", staffCount: 3, hours: 5, overtime: false });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.hourlyRate, 25.5234);
    assert.equal(r.value.multiplier, 1);
    assert.equal(r.value.net, 382.85);
  }
});

test("overtime applies 1.5x exactly once to the normal TCTE (never to the workbook TCTE)", () => {
  for (const role of APPROVED_LABOUR_ROLES) {
    const r = calculateLabour({ roleId: role.id, staffCount: 2, hours: 4, overtime: true });
    assert.ok(r.ok);
    if (!r.ok) continue;
    assert.equal(r.value.multiplier, 1.5);
    assert.equal(r.value.hourlyRate, role.normalRate);
    assert.equal(r.value.net, Math.round((8 * role.overtimeRate + Number.EPSILON) * 100) / 100, role.label);
    assert.notEqual(r.value.net, Math.round(8 * role.overtimeRate * 1.5 * 100) / 100, `${role.label} not double-applied`);
  }
  const kp = calculateLabour({ roleId: "kp", staffCount: 1, hours: 1, overtime: true });
  assert.ok(kp.ok && kp.value.net === 26.55);
});

test("staff count multiplies the line", () => {
  const one = calculateLabour({ roleId: "manager", staffCount: 1, hours: 2, overtime: false });
  const four = calculateLabour({ roleId: "manager", staffCount: 4, hours: 2, overtime: false });
  assert.ok(one.ok && four.ok);
  if (one.ok && four.ok) {
    assert.equal(one.value.net, 62.54);
    assert.equal(four.value.net, 250.16);
  }
});

test("invalid hours, staff, role and overtime values are rejected", () => {
  const base = { roleId: "kp", staffCount: 1, hours: 1, overtime: false };
  for (const hours of [0, -1, NaN, Infinity, -Infinity, MAX_HOURS + 1]) assert.equal(calculateLabour({ ...base, hours }).ok, false, `hours ${hours}`);
  for (const staffCount of [0, -2, 1.5, NaN, Infinity, 101]) assert.equal(calculateLabour({ ...base, staffCount }).ok, false, `staff ${staffCount}`);
  assert.equal(calculateLabour({ ...base, roleId: "unknown" }).ok, false);
  assert.equal(calculateLabour({ ...base, overtime: 2 as unknown as boolean }).ok, false);
  assert.equal(calculateLabour({ ...base, overtime: "1.5" as unknown as boolean }).ok, false);
});

test("1.5x is the only overtime multiplier and cannot be entered", () => {
  assert.equal(OVERTIME_MULTIPLIER, 1.5);
  for (const role of APPROVED_LABOUR_ROLES) {
    for (const overtime of [false, true]) {
      const r = calculateLabour({ roleId: role.id, staffCount: 1, hours: 1, overtime });
      assert.ok(r.ok && (r.value.multiplier === 1 || r.value.multiplier === 1.5));
    }
  }
  assert.equal(isApprovedLabourLine({ roleId: "kp", hourlyRate: 17.7, multiplier: 2 }), false);
  assert.equal(isApprovedLabourLine({ roleId: "kp", hourlyRate: 17.7, multiplier: 1.25 }), false);
  assert.equal(isApprovedLabourLine({ roleId: "kp", hourlyRate: 17.7, multiplier: 1.5 }), true);
  assert.ok(editorSource.length > 500, "labour editor markup located");
  assert.doesNotMatch(editorSource, /Rate multiplier|Custom multiplier|<option value="2"|<option value="custom"|>2×<|changeLabour\(\{[^}]*multiplier/);
  assert.doesNotMatch(editorSource, /type="number"[^>]*value=\{editor\.(multiplier|hourlyRate)/);
});

test("operator UI exposes no NI, pension, VAT, on-cost or rate-entry fields", () => {
  assert.ok(editorSource.length > 500);
  assert.doesNotMatch(editorSource, /NIN|\bNI\b|[Pp]ension|VAT|on-cost|Base hourly rate|Hourly rate source|custom net rate/);
  assert.doesNotMatch(editorSource, /hourlyRate: e|changeLabour\(\{ hourlyRate/);
  assert.match(editorSource, /<option value="overtime">Overtime<\/option>/);
  assert.doesNotMatch(dashboard, /hospitality-labour-rates/);
  const lib = readFileSync(new URL("../lib/labour-rates.ts", import.meta.url), "utf8");
  const exported = lib.slice(lib.indexOf("export type LabourRole"));
  assert.doesNotMatch(exported, /basicRate|pension|nin\b/i);
});
