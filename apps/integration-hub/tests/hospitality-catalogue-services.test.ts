import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { SERVICE_IDS, SERVICE_LAYOUT_SEED, type ServiceRules } from "@fika/server-shared/hospitality-service-layout";
import { buildServiceLayoutView, clearServiceOverrideCommand, setServiceCategoriesCommand, serviceRuleAt } from "../lib/hospitality-catalogue-types";

const rcoa = "oploc:rcoa";
const company = (services: ServiceRules, version = 3) => ({ scope: "company" as const, version, services });
const site = (oplocId: string, services: ServiceRules, version = 2) => ({ scope: "site" as const, oplocId, version, services });

test("company changes use the company version and preserve stored site exceptions", () => {
  const layout = buildServiceLayoutView([
    company({ dining: { categories: ["Dining", "Drinks"] } }, 7),
    site(rcoa, { dining: { categories: ["Dining", "Wine"] } }, 4),
  ], ["Dining", "Drinks", "Wine"]);
  assert.deepEqual(serviceRuleAt(layout, undefined, "dining").rule.categories, ["Dining", "Drinks"]);
  assert.deepEqual(serviceRuleAt(layout, rcoa, "dining").rule.categories, ["Dining", "Wine"]);
  assert.deepEqual(setServiceCategoriesCommand(layout, undefined, "dining", { categories: ["Dining", "Drinks", "Wine"] }, "Add wine to dining"), {
    action: "set-service-categories", serviceId: "dining", categories: ["Dining", "Drinks", "Wine"], expectedVersion: 7, reason: "Add wine to dining",
  });
  assert.deepEqual(clearServiceOverrideCommand(layout, rcoa, "dining", "Use the company default"), {
    action: "clear-service-override", serviceId: "dining", oplocId: rcoa, expectedVersion: 4, reason: "Use the company default",
  });
});

test("site toggle implementation preserves categories and changes only its hidden flag", () => {
  const source = readFileSync(new URL("../app/ui/HospitalityCatalogueServices.tsx", import.meta.url), "utf8");
  assert.match(source, /export function siteServiceDraft\(rule: ServiceRule, enabled: boolean\): ServiceRule\s*\{\s*return \{ categories: \[\.\.\.rule\.categories\], \.\.\.\(!enabled \? \{ hidden: true \} : \{\}\) \};/);
  assert.match(source, /setServiceCategoriesCommand\(currentLayout, target, serviceId, shownRule, reason\)/);
});

test("the UI uses governed service-layout commands and does not claim portal availability", () => {
  const source = readFileSync(new URL("../app/ui/HospitalityCatalogueServices.tsx", import.meta.url), "utf8");
  const helpers = readFileSync(new URL("../lib/hospitality-catalogue-types.ts", import.meta.url), "utf8");
  assert.match(source, /setServiceCategoriesCommand\(currentLayout, target, serviceId, shownRule, reason\)/);
  assert.match(source, /clearServiceOverrideCommand\(currentLayout, oplocId, serviceId, reason\)/);
  assert.match(helpers, /expectedVersion: scopeVersion\(view, oplocId\)/); // Commands carry their exact scope version via the canonical helper.
  assert.match(source, /Portal serving still depends on the site's connected booking consumer/);
  assert.match(source, /candidate count, not an orderability count/);
  assert.match(source, /itemId\?: string/);
  assert.match(source, /Opened from Item:/);
  assert.match(source, /Configured Hub settings do not prove the public booking portal/);
  assert.doesNotMatch(source, /window\.(?:alert|confirm|prompt)|dangerouslySetInnerHTML|localStorage/);
  assert.doesNotMatch(source, /action:\s*"(?:create-service|rename-category|set-item-service-membership)"/);
  assert.equal(SERVICE_IDS.length, 8);
});

test("service selection stays explicit unless a deep link names a service", () => {
  const source = readFileSync(new URL("../app/ui/HospitalityCatalogueServices.tsx", import.meta.url), "utf8");
  assert.match(source, /const \[oplocId, setOplocId\].*initialContext\?\.oplocId/);
  assert.match(source, /const \[serviceId, setServiceId\] = useState<ServiceId \| "">\(initialContext\?\.serviceId \?\? ""\)/);
  assert.match(source, /const nextService = initialContext\?\.serviceId \?\? ""/);
  assert.doesNotMatch(source, /pageView === "services" \? "dining"/);
  assert.match(source, /Choose a location…/);
  assert.match(source, /Choose a booking service/);
  assert.match(source, /onContextChange\?\.\(\{ \.\.\.next, \.\.\.\(contextCategory/);
  assert.match(source, /const scopeChanged = previous\.view !== pageView \|\| previous\.oplocId !== nextSite \|\| previous\.serviceId !== nextService/);
  assert.match(source, /if \(scopeChanged\) \{/);
  assert.match(source, /setItemId\(initialContext\?\.itemId \?\? ""\)/);
});
