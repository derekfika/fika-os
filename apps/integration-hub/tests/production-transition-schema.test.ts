import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Transition } from "../lib/production-transition-schema";

const base = { action: "transition", canonicalId: "production-order:v1:booking:mnk:72eb3be0", expectedVersion: 3, reason: "Production plan marked Planned by the production chef." };

test("the Hub transition API accepts every status CPU Production walks through to Planned", () => {
  for (const status of ["needs_review", "accepted", "planning", "planned", "rejected", "needs_clarification"]) {
    assert.equal(Transition.safeParse({ ...base, status }).success, true, status);
  }
});

test("unknown statuses and extra fields are still rejected", () => {
  assert.equal(Transition.safeParse({ ...base, status: "bogus" }).success, false);
  assert.equal(Transition.safeParse({ ...base, status: "planned", extra: true }).success, false);
  assert.equal(Transition.safeParse({ ...base, status: "planned", expectedVersion: 0 }).success, false);
});

test("the route uses the shared schema and the domain table still allows accepted -> planning -> planned", () => {
  assert.match(readFileSync(new URL("../app/api/production/route.ts", import.meta.url), "utf8"), /from "@\/lib\/production-transition-schema"/);
  const domain = readFileSync(new URL("../lib/production-domain.ts", import.meta.url), "utf8");
  assert.match(domain, /accepted: \["planning"/);
  assert.match(domain, /planning: \["planned"/);
});
