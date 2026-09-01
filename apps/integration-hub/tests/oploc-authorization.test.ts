import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryAuthModRepository } from "../lib/authmod-core";
import { grantStandardApplicationAccess, assignSite } from "../lib/authmod-core/grants";
import { filterAuthorizedOplocs, resolvePermittedOplocIds } from "../lib/oploc-authorization";
import type { ApplicationRegistryEntry, AuthIdentity, AuthPrincipal } from "../lib/authmod-core/model";
import { decodeReadPackage, encodeReadPackage } from "@fika/server-shared/read-package";

const admin: AuthPrincipal = { type: "interactive", id: "admin", displayName: "Admin", identityKind: "person" };
const app: ApplicationRegistryEntry = { appId: "cpu-production", displayName: "CPU", enabled: true, launchVisible: true, scopeModel: "oploc", standardBundleId: "cpu-normal", standardResource: "cpu-production.normal", standardActions: ["View"], version: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01", provenance: "migration" };
const activeOplocs = [{ id: "oploc:a", label: "A", active: true }, { id: "oploc:b", label: "B", active: true }];
const principal = (id: string): AuthPrincipal => ({ type: "interactive", id, displayName: id, identityKind: "person" });

function setup() {
  const repository = new MemoryAuthModRepository({ applications: [app], oplocs: activeOplocs });
  const identity: AuthIdentity = { id: "user", displayName: "User", identityKind: "person", identityLinkStatus: "matched", status: "active", fullAccess: false, provenance: "manual-override", version: 1, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
  repository.identities.set(identity.id, identity);
  return { repository, identity };
}

async function grantSites(ids: string[]) {
  const { repository, identity } = setup();
  await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: app.appId, actor: admin, reason: "test" });
  for (const id of ids) await assignSite(repository, { identityId: identity.id, oplocId: id, actor: admin, reason: "test" });
  return repository;
}

test("users receive only their AUTHMOD-permitted OPLOCs", async () => {
  assert.deepEqual([...((await resolvePermittedOplocIds({ repository: await grantSites(["oploc:a"]), principal: principal("user"), appId: app.appId })).ids)], ["oploc:a"]);
  assert.deepEqual([...((await resolvePermittedOplocIds({ repository: await grantSites(["oploc:b"]), principal: principal("user"), appId: app.appId })).ids)], ["oploc:b"]);
  assert.deepEqual([...((await resolvePermittedOplocIds({ repository: await grantSites(["oploc:a", "oploc:b"]), principal: principal("user"), appId: app.appId })).ids)].sort(), ["oploc:a", "oploc:b"]);
});

test("canonical.view without an applicable OPLOC entitlement returns no organisation-wide data", async () => {
  const { repository } = setup();
  assert.deepEqual([...((await resolvePermittedOplocIds({ repository, principal: principal("user"), appId: app.appId })).ids)], []);
});

test("package contents cannot grant access and unauthorized records are removed", () => {
  const packageValue = { oplocs: [{ canonicalId: "oploc:a", label: "A" }, { canonicalId: "oploc:b", label: "B" }] };
  assert.deepEqual(filterAuthorizedOplocs(packageValue, new Set(["oploc:a"])), { oplocs: [{ canonicalId: "oploc:a", label: "A" }] });
});

test("the route has no shared filtered-response cache and keeps no-store semantics", () => {
  const source = readFileSync(new URL("../app/api/oplocs/route.ts", import.meta.url), "utf8");
  assert.match(source, /resolvePermittedOplocIds/);
  assert.doesNotMatch(source, /getCachedOplocResponse/);
  assert.match(source, /Cache-Control.*no-store/);
});

test("AUTHMOD failure fails closed", async () => {
  const repository = new MemoryAuthModRepository({ applications: [app], oplocs: activeOplocs });
  repository.listApplications = async () => { throw new Error("AUTHMOD unavailable"); };
  await assert.rejects(() => resolvePermittedOplocIds({ repository, principal: principal("user"), appId: app.appId }), /AUTHMOD unavailable/);
});

test("scope resolution is bounded by the principal's assigned OPLOCs", async () => {
  const repository = await grantSites(["oploc:a"]);
  let listed = false;
  repository.listActiveOplocs = async () => { listed = true; throw new Error("unbounded OPLOC discovery must not be used"); };
  const scope = await resolvePermittedOplocIds({ repository, principal: principal("user"), appId: app.appId });
  assert.equal(listed, false);
  assert.deepEqual([...scope.ids], ["oploc:a"]);
});

test("full AUTHMOD access can filter the package without enumerating canonical OPLOCs", async () => {
  const { repository, identity } = setup();
  identity.fullAccess = true;
  await grantStandardApplicationAccess(repository, { identityId: identity.id, appId: app.appId, actor: admin, reason: "test" });
  repository.listActiveOplocs = async () => { throw new Error("unbounded OPLOC discovery must not be used"); };
  const scope = await resolvePermittedOplocIds({ repository, principal: principal("user"), appId: app.appId });
  assert.equal(scope.all, true);
});

test("package integrity failure cannot bypass authorization", () => {
  const encoded = encodeReadPackage("integration-hub/oplocs", 1, { oplocs: [{ canonicalId: "oploc:a", label: "A" }] }, 1);
  const corrupt = Uint8Array.from(encoded.bytes, (byte, index) => index === 0 ? byte ^ 1 : byte);
  assert.throws(() => decodeReadPackage(encoded.manifest, corrupt), /integrity check failed/);
});
