import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("CPU canonical production route has no direct Hub canonical authority imports", async () => {
  const source = await readFile(join(process.cwd(), "app/api/production/route.ts"), "utf8");
  for (const forbidden of ["@hub/lib/production-domain", "@hub/lib/auth", "@hub/lib/authmod", "@hub/lib/firebase-admin"]) assert.equal(source.includes(forbidden), false, `unexpected direct import: ${forbidden}`);
});

test("CPU production HTTP client forwards the canonical Hub endpoint boundary", async () => {
  const source = await readFile(join(process.cwd(), "lib/production-http-client.ts"), "utf8");
  assert.match(source, /\/api\/production/);
  assert.match(source, /request\.headers\.get\("cookie"\)/);
  assert.match(source, /cache: "no-store"/);
});

test("Hub production route owns authorization for CPU transport commands", async () => {
  const source = await readFile(join(process.cwd(), "../integration-hub/app/api/production/route.ts"), "utf8");
  assert.match(source, /requireActor\(request, \["integration-admin", "reviewer"\]\)/);
  for (const action of ["cpu-create", "update-lines", "report-allergen-discrepancy"]) assert.match(source, new RegExp(`input\\?\\.action === "${action}"`));
});

test("CPU projection runtime has no Hub persistence or canonical repository imports", async () => {
  const files = ["lib/cpu-projection.ts", "lib/cpu-projection-repository.ts", "lib/firebase-admin.ts", "lib/cpu-oploc-labels.ts"];
  const forbidden = ["@hub/lib/firebase-admin", "@hub/lib/production-domain", "@hub/lib/auth", "@hub/lib/authmod", "apps/integration-hub/"];
  for (const file of files) {
    const source = await readFile(join(process.cwd(), file), "utf8");
    for (const value of forbidden) assert.equal(source.includes(value), false, `${file} imports forbidden runtime: ${value}`);
  }
  const adapter = await readFile(join(process.cwd(), "lib/firebase-admin.ts"), "utf8");
  const config = await readFile(join(process.cwd(), "lib/runtime-config.ts"), "utf8");
  assert.match(adapter, /FIRESTORE_EMULATOR_HOST/);
  assert.match(config, /FIREBASE_PROJECT_ID|GCLOUD_PROJECT/);
});

test("hosted production-plan runtime has no local plan-file persistence", async () => {
  const source = await readFile(join(process.cwd(), "app/api/production-plan/route.ts"), "utf8");
  for (const forbidden of ["plans.json", "writeFile", "@hub/lib/firebase-admin", "@hub/lib/production-domain", "@hub/lib/auth", "@hub/lib/authmod"]) assert.equal(source.includes(forbidden), false, `unexpected hosted plan dependency: ${forbidden}`);
  const loadPlans = source.slice(source.indexOf("async function loadPlans"), source.indexOf("function normalisePlanAllergens"));
  assert.equal(loadPlans.includes("fs.readFile"), false);
  assert.match(source, /createProductionPlanRepository/);
});

test("CPU routing and Hospitality notification paths use Hub HTTP boundaries", async () => {
  for (const file of ["lib/cpu-routing.ts", "lib/cpu-oploc-labels.ts", "app/api/oplocs/route.ts", "app/api/production-plan/route.ts"]) {
    const source = await readFile(join(process.cwd(), file), "utf8");
    for (const forbidden of ["@hub/lib/connections-service", "@hub/lib/hospitality-booking-service"]) assert.equal(source.includes(forbidden), false, `${file} imports forbidden Hub implementation: ${forbidden}`);
  }
  const routing = await readFile(join(process.cwd(), "../integration-hub/app/api/cpu-production/routing/route.ts"), "utf8");
  const notification = await readFile(join(process.cwd(), "../integration-hub/app/api/hospitality/production-confirmation/route.ts"), "utf8");
  assert.match(routing, /hospitalityMenuProductionRouting/);
  assert.match(notification, /notifyBookingConfirmedForProductionOrder/);
});

test("CPU calendar scan uses the authenticated Hub HTTP boundary", async () => {
  const route = await readFile(join(process.cwd(), "app/api/calendar/scan/route.ts"), "utf8");
  for (const forbidden of ["@hub/lib/cpu-calendar-runner", "@hub/lib/google-calendar-client", "@hub/lib/auth", "@hub/lib/authmod", "@hub/lib/firebase-admin", "apps/integration-hub/"]) assert.equal(route.includes(forbidden), false, `calendar route imports forbidden runtime: ${forbidden}`);
  assert.match(route, /cpuCalendarScanState/);
  assert.match(route, /runCpuCalendarScan/);
  const client = await readFile(join(process.cwd(), "lib/production-http-client.ts"), "utf8");
  assert.match(client, /\/api\/cpu\/calendar\/scan/);
  assert.match(client, /JSON\.stringify\(\{ force: true \}\)/);
  assert.match(client, /request\.headers\.get\("cookie"\)/);
  const hubRoute = await readFile(join(process.cwd(), "../integration-hub/app/api/cpu/calendar/scan/route.ts"), "utf8");
  assert.match(hubRoute, /requireActor\(request/);
  assert.match(hubRoute, /assertPermission\(actor, "canonical\.edit"\)/);
  assert.match(hubRoute, /runCpuCalendarScan\(command\)/);
});

test("CPU published-menu reads use the Menu Planning HTTP boundary", async () => {
  const route = await readFile(join(process.cwd(), "app/api/menu-publications/route.ts"), "utf8");
  for (const forbidden of ["@hub/lib/api", "@hub/lib/auth", "@hub/lib/authmod", "apps/menu-planning/", "operational-store", "operational.sqlite", "local-data/menu-planning", "../../../../shared/published-allergen-matrix"]) assert.equal(route.includes(forbidden), false, `publication route imports forbidden runtime: ${forbidden}`);
  assert.match(route, /menuPlanningJson/);
  assert.match(route, /requireCpuActor/);
  const client = await readFile(join(process.cwd(), "lib/menu-planning-http-client.ts"), "utf8");
  assert.match(client, /MENU_PLANNING_BASE_URL/);
  assert.match(client, /request\.headers\.get\("cookie"\)/);
  assert.match(client, /cache: "no-store"/);
  const menuRoute = await readFile(join(process.cwd(), "../menu-planning/app/api/rolling-menu/publications/route.ts"), "utf8");
  assert.match(menuRoute, /resolveMenuActor\(request\)/);
  assert.match(menuRoute, /getMenuPublication/);
  const sandwiches = await readFile(join(process.cwd(), "app/api/sandwiches/route.ts"), "utf8");
  for (const forbidden of ["node:fs", "local-data/menu-planning", "saved-sandwiches.json", "@hub/lib"]) assert.equal(sandwiches.includes(forbidden), false, `sandwich route imports forbidden runtime: ${forbidden}`);
  assert.match(sandwiches, /menuPlanningJson/);
});
