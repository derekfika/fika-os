import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  hospitalityWorkspacePath,
  resolveWorkspaceEntry,
} from "../lib/hospitality-workspace";

const surfaces = { bookingPlatform: true, operationsDashboard: true };
const sites = [
  { id: "oploc:mnk", label: "MNK", active: true, portalSiteKey: "mnk" as const },
  { id: "oploc:angel", label: "Angel Court", active: true, portalSiteKey: "angel-court" as const },
];

test("generic multi-site entry never defaults into MNK and only preselects an authorised remembered site", () => {
  assert.deepEqual(resolveWorkspaceEntry({ sites, rememberedOplocId: "oploc:angel", surfaces }), { kind: "choose", selectedOplocId: "oploc:angel" });
  assert.deepEqual(resolveWorkspaceEntry({ sites, rememberedOplocId: "oploc:unknown", surfaces }), { kind: "choose" });
});

test("single-site entry auto-selects the site but shows destination choice when both surfaces are authorised", () => {
  assert.deepEqual(resolveWorkspaceEntry({ sites: [sites[0]], surfaces }), { kind: "destination-choice", selectedOplocId: "oploc:mnk" });
});

test("single authorised surface enters directly after selecting the only site", () => {
  assert.deepEqual(resolveWorkspaceEntry({ sites: [sites[0]], surfaces: { bookingPlatform: false, operationsDashboard: true } }), { kind: "surface", oplocId: "oploc:mnk", surface: "operations" });
});

test("authorised deep links preserve their OPLOC and selected surface", () => {
  assert.deepEqual(resolveWorkspaceEntry({ sites, explicitOplocId: "oploc:angel", requestedSurface: "booking-platform", surfaces }), { kind: "surface", oplocId: "oploc:angel", surface: "booking" });
  assert.deepEqual(resolveWorkspaceEntry({ sites, explicitOplocId: "oploc:angel", surfaces }), { kind: "surface", oplocId: "oploc:angel", surface: "operations" });
  assert.equal(hospitalityWorkspacePath("oploc:angel", "booking"), "/workspace?oploc=oploc%3Aangel&surface=booking");
});

test("unauthorised OPLOCs and zero-access users fail closed", () => {
  assert.deepEqual(resolveWorkspaceEntry({ sites, explicitOplocId: "oploc:forbidden", surfaces }), { kind: "unauthorised-oploc", oplocId: "oploc:forbidden" });
  assert.deepEqual(resolveWorkspaceEntry({ sites: [], explicitOplocId: "oploc:forbidden", surfaces }), { kind: "zero-access" });
});

test("an explicit deep link cannot select a surface outside the authorised surface set", () => {
  assert.deepEqual(resolveWorkspaceEntry({ sites: [sites[0]], explicitOplocId: "oploc:mnk", requestedSurface: "operations", surfaces: { bookingPlatform: true, operationsDashboard: false } }), { kind: "unauthorised-surface", surface: "operations" });
});

test("workspace UI exposes both destination cards and the access response keeps AUTHMOD as its authority", () => {
  const workspace = readFileSync(new URL("../app/ui/HospitalityWorkspace.tsx", import.meta.url), "utf8");
  const accessRoute = readFileSync(new URL("../app/api/access/route.ts", import.meta.url), "utf8");
  assert.match(workspace, /Booking platform/);
  assert.match(workspace, /Operations dashboard/);
  assert.match(workspace, /fetch\("\/api\/access"/);
  assert.match(accessRoute, /hospitality\/access/);
  assert.match(accessRoute, /bookingPlatform/);
  assert.match(accessRoute, /operationsDashboard/);
});
