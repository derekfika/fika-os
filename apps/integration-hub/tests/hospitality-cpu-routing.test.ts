import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyHospitalityLine, governedRoutingPlatforms, hospitalityPlatformOf, isGovernedRoutingPlatform, LINE_LABELS, BOOKING_LABELS, planHospitalityCpuRouting, routingKeys, routingBlockedMessage } from "../lib/hospitality-cpu-routing";
import { LEGACY_HOSPITALITY_MENU_ROUTING } from "../lib/connections-service";

/**
 * Per-item RCoA CPU routing from the governed Production visibility records: Hospitality keeps the complete booking; only lines routed to
 * exactly one of Sandwiches/Hospitality reach CPU. Pure rules always run; the hand-off tests run through the real service against the
 *   firebase emulators:exec --only firestore --project demo-fika-os --config apps/integration-hub/firebase.json \
 *     "cd apps/integration-hub && npx tsx --test tests/hospitality-cpu-routing.test.ts"
 */
const P = "hospitality-menu-item:rcoa:";
const line = (itemId: string, itemName = itemId) => ({ itemId, itemName });
// governed records: a record existing IS the decision; [] = In house; an absent key = never classified
const routing = {
  [`${P}specialty_tea_coffee`]: [],
  [`${P}mini_pastries`]: ["hospitality"],
  [`${P}deli_sandwich_lunch`]: ["sandwiches"],
  [`${P}exotic_fruit_box`]: ["hospitality"],
  [`${P}delivered_only`]: ["delivered_in"],
  [`${P}both_flags`]: ["sandwiches", "hospitality"],
  [`${P}bad_value`]: ["not-a-workstream"],
} as Record<string, string[]>;
const states = (items: string[]) => planHospitalityCpuRouting(items.map((id) => line(id)), "rcoa", routing).lines.map((l) => l.state);

test("state semantics A-F: empty record = In house; sandwiches; hospitality; delivered_in only = CPU · Delivered-In; MISSING = Routing required; both = Routing conflict", () => {
  assert.deepEqual(states(["specialty_tea_coffee", "deli_sandwich_lunch", "mini_pastries", "delivered_only", "bagel_box", "both_flags"]), ["in_house", "cpu_sandwiches", "cpu_hospitality", "cpu_delivered_in", "routing_required", "routing_conflict"]);
  assert.equal(classifyHospitalityLine(line("bad_value"), "rcoa", routing).state, "routing_required", "an unrecognised value is not a governed decision");
  assert.equal(classifyHospitalityLine(line("cookie_box"), "rcoa", {}).state, "routing_required", "legacy defaults are never consulted for RCoA; missing is not In house");
});

test("1/6. all items In house (explicit empty records) -> No CPU production, no Production Order; Delivered-In only is CPU", () => {
  const plan = planHospitalityCpuRouting([line("specialty_tea_coffee")], "rcoa", routing);
  assert.equal(plan.status, "no_cpu_production");
  assert.deepEqual(plan.cpuLines, []);
  const delivered = planHospitalityCpuRouting([line("specialty_tea_coffee"), line("delivered_only")], "rcoa", routing);
  assert.equal(delivered.status, "cpu_required");
  assert.deepEqual(delivered.cpuLines, [{ index: 1, workstream: "delivered_in" }]);
});

test("2. Tea & Coffee (In house) + Mini Pastries (Hospitality) -> CPU gets the pastries only", () => {
  const plan = planHospitalityCpuRouting([line("specialty_tea_coffee"), line("mini_pastries")], "rcoa", routing);
  assert.equal(plan.status, "cpu_required");
  assert.deepEqual(plan.cpuLines, [{ index: 1, workstream: "hospitality" }]);
});

test("3/4/5. Sandwiches, Hospitality-only and mixed bookings route each CPU line to its own single workstream", () => {
  assert.deepEqual(planHospitalityCpuRouting([line("deli_sandwich_lunch")], "rcoa", routing).cpuLines, [{ index: 0, workstream: "sandwiches" }]);
  assert.deepEqual(planHospitalityCpuRouting([line("exotic_fruit_box")], "rcoa", routing).cpuLines, [{ index: 0, workstream: "hospitality" }]);
  const mixed = planHospitalityCpuRouting([line("exotic_fruit_box"), line("specialty_tea_coffee"), line("deli_sandwich_lunch")], "rcoa", routing);
  assert.deepEqual(mixed.cpuLines, [{ index: 0, workstream: "hospitality" }, { index: 2, workstream: "sandwiches" }]);
});

test("7. any Routing required or Routing conflict line blocks the whole hand-off and names the exact item(s)", () => {
  const plan = planHospitalityCpuRouting([line("mini_pastries"), line("bagel_box", "Bagel Box"), line("both_flags", "Odd Item")], "rcoa", routing);
  assert.equal(plan.status, "routing_required");
  assert.deepEqual(plan.required.map((l) => l.itemName), ["Bagel Box"]);
  assert.deepEqual(plan.conflicts.map((l) => l.itemName), ["Odd Item"]);
  const message = routingBlockedMessage(plan);
  assert.match(message, /Routing required.*Bagel Box/);
  assert.match(message, /Routing conflict: Odd Item/);
  assert.equal(planHospitalityCpuRouting([line("both_flags")], "rcoa", routing).status, "routing_conflict");
});

test("8. an empty booking never produces an empty Production Order", () => assert.equal(planHospitalityCpuRouting([], "rcoa", routing).status, "no_cpu_production"));

test("routing keys: canonical menu item id first, then the RCoA canonical id derived from the stable source item id", () => {
  assert.deepEqual(routingKeys({ itemId: "mini_pastries", menuItemId: `${P}mini_pastries` }, "rcoa"), [`${P}mini_pastries`]);
  assert.deepEqual(routingKeys({ itemId: "mini_pastries" }, "rcoa"), [`${P}mini_pastries`]);
});

test("9. only RCoA bookings are filtered; non-RCoA keeps its behaviour; one routing store; dashboard and Hub UI use the governed states", () => {
  const domain = readFileSync(new URL("../lib/production-domain.ts", import.meta.url), "utf8");
  assert.match(domain, /isGovernedRoutingPlatform\(platform\)/);
  assert.match(domain, /adaptCpuProductionWorkstreams\(assignments\)\.workstreams\[0\] \|\| "unassigned"/, "non-RCoA fallback unchanged");
  const service = readFileSync(new URL("../lib/connections-service.ts", import.meta.url), "utf8");
  assert.equal((service.match(/db\.collection\("integrationHubHospitalityMenuProductionRouting"\)/g) || []).length, 1, "a single routing store");
  const ui = readFileSync(new URL("../app/ui/Connections.tsx", import.meta.url), "utf8");
  assert.match(ui, /CPU_PRODUCTION_WORKSTREAM_LABELS/);
  const dashboard = readFileSync(new URL("../../hospitality-booking/app/ui/HospitalityDashboard.tsx", import.meta.url), "utf8");
  assert.match(dashboard, /booking\.cpuRouting/);
  const labels = readFileSync(new URL("../lib/hospitality-cpu-routing.ts", import.meta.url), "utf8");
  for (const label of ["In house", "CPU · Sandwiches", "CPU · Hospitality", "Routing required", "Routing conflict", "CPU required", "No CPU production"]) assert.ok(labels.includes(label), label);
});

// The real hand-off / dashboard-feed tests live in hospitality-routing-platforms.test.ts (one file, so parallel test files never share an OPLOC mapping).