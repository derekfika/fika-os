import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { managerItemCounts } from "../app/ui/hospitality-catalogue-ux/model";

test("manager counts preserve exact category identity and distinguish archived and site permission", () => {
  const rows = [
    { category: "Wine", status: "active" as const, availableAt: ["site-a"] },
    { category: "Wine", status: "active" as const, availableAt: ["site-b"] },
    { category: "Wine", status: "archived" as const, availableAt: [] },
    { category: "wine", status: "active" as const, availableAt: ["site-a"] },
  ];
  assert.deepEqual(managerItemCounts(rows, "Wine", "site-a"), { active: 2, sitePermitted: 1, archived: 1 });
  assert.deepEqual(managerItemCounts(rows, "Wine"), { active: 2, sitePermitted: undefined, archived: 1 });
  assert.deepEqual(managerItemCounts(rows, "wine", "site-a"), { active: 1, sitePermitted: 1, archived: 0 });
});

test("manager is read only, keeps existing editors, and carries its URL context", () => {
  const manager = readFileSync(new URL("../app/ui/HospitalityCatalogueManager.tsx", import.meta.url), "utf8");
  const parent = readFileSync(new URL("../app/ui/HospitalityCatalogue.tsx", import.meta.url), "utf8");
  assert.match(manager, /serviceRuleAt\(layout, oplocId, serviceId\)/);
  assert.match(manager, /onOpenItem\(selected\.itemId\)/);
  assert.match(manager, /Counts show catalogue records and site permission; they do not establish customer orderability/);
  assert.doesNotMatch(manager, /fetch\(|send\(|action:\s*"|localStorage/);
  assert.match(parent, /nextTab === "manager"/);
  assert.match(parent, /tab === "manager"/);
  assert.match(parent, /tab === "services" \|\| tab === "locations"/);
});
