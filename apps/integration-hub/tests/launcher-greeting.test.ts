import assert from "node:assert/strict";
import test from "node:test";
import { launcherGreeting } from "../lib/launcher-greeting";

const date = (hour: number) => new Date(2026, 7, 26, hour, 0, 0);

test("personalises only a person identity with an explicit first name", () => {
  assert.equal(launcherGreeting({ identityKind: "person", firstName: "Derek" }, date(9)), "Good morning, Derek");
});

test("site/shared and service-like identities use a generic greeting", () => {
  assert.equal(launcherGreeting({ identityKind: "operational", firstName: "CPU" }, date(9)), "Good morning");
  assert.equal(launcherGreeting({ principalType: "service", identityKind: "person", firstName: "Integration" }, date(9)), "Good morning");
  assert.equal(launcherGreeting({ identityKind: undefined, firstName: "Integration" }, date(9)), "Good morning");
});

test("missing or ambiguous identity information uses a generic greeting", () => {
  assert.equal(launcherGreeting({ identityKind: "person" }, date(9)), "Good morning");
  assert.equal(launcherGreeting({ identityKind: "person", firstName: "   " }, date(9)), "Good morning");
});

test("time-of-day remains dynamic", () => {
  const identity = { identityKind: "person" as const, firstName: "Tia" };
  assert.equal(launcherGreeting(identity, date(11)), "Good morning, Tia");
  assert.equal(launcherGreeting(identity, date(12)), "Good afternoon, Tia");
  assert.equal(launcherGreeting(identity, date(18)), "Good evening, Tia");
});
