import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FOOD_DATA_GRANT } from "../lib/food-data/config";

const source = readFileSync(new URL("../app/authmod/accounts/[id]/AccountDetail.tsx", import.meta.url), "utf8");

test("AUTHMOD Special Authority offers the exact Food Data grant as an organisation-wide View", () => {
  assert.ok(source.includes(`["${FOOD_DATA_GRANT.resource}", "Food Data (Kafoodle)"`), "Food Data row is listed for people");
  assert.ok(source.includes(`appId`) && source.includes(`"${FOOD_DATA_GRANT.appId}", "person"]`), "row targets the integration-hub app and person accounts");
  assert.ok(source.includes(`resource === "${FOOD_DATA_GRANT.resource}" ? "${FOOD_DATA_GRANT.action}"`), "grant action is View");
  assert.match(source, /organisationOnly = [^;]*food-data\.catalogue/, "no per-site scoping for Food Data");
});
