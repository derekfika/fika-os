import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createAuthModEvaluationContext, evaluateAuthority, resolveUserAccess } from "../lib/authmod-core/evaluator";
import { MemoryAuthModRepository } from "../lib/authmod-core";
import type { AppAssignment, ApplicationRegistryEntry, AuthIdentity, AuthorityGrant, SiteAssignment } from "../lib/authmod-core/model";

class CountingRepository extends MemoryAuthModRepository {
  counts = { identities: 0, grants: 0, apps: 0, sites: 0, applications: 0, oplocs: 0 };
  override async getIdentity(id: string) { this.counts.identities += 1; return super.getIdentity(id); }
  override async listAuthorityGrants(id: string, type?: "interactive" | "service") { this.counts.grants += 1; return super.listAuthorityGrants(id, type); }
  override async listAppAssignments(id: string) { this.counts.apps += 1; return super.listAppAssignments(id); }
  override async listSiteAssignments(id: string) { this.counts.sites += 1; return super.listSiteAssignments(id); }
  override async getApplication(id: string) { this.counts.applications += 1; return super.getApplication(id); }
  override async getActiveOploc(id: string) { this.counts.oplocs += 1; return super.getActiveOploc(id); }
}

function setup() {
  const app: ApplicationRegistryEntry = { appId: "cpu-production", displayName: "CPU", enabled: true, launchVisible: true, scopeModel: "oploc", standardResource: "production", standardActions: ["View"], version: 1 } as ApplicationRegistryEntry;
  const repo = new CountingRepository({ applications: [app], oplocs: Array.from({ length: 20 }, (_, index) => ({ id: `oploc:${index}`, label: `Site ${index}`, active: true })) });
  const identity: AuthIdentity = { id: "person-1", displayName: "Person", normalizedEmail: "person@example.com", identityKind: "person", status: "active", identityLinkStatus: "matched", fullAccess: false, version: 1 } as AuthIdentity;
  repo.identities.set(identity.id, identity);
  repo.appAssignments.set("app-assignment", { id: "app-assignment", identityId: identity.id, appId: app.appId, status: "active", version: 1 } as AppAssignment);
  for (let index = 0; index < 20; index += 1) repo.siteAssignments.set(`site-${index}`, { id: `site-${index}`, identityId: identity.id, oplocId: `oploc:${index}`, status: "active", version: 1 } as SiteAssignment);
  repo.grants.set("grant", { id: "grant", subjectId: identity.id, subjectType: "interactive", appId: app.appId, resource: "production", action: "View", scope: { kind: "oploc", ids: ["oploc:0"] }, status: "active", provenance: "standard-app-access", version: 1 } as AuthorityGrant);
  return { repo, principal: { type: "interactive" as const, id: identity.id, displayName: identity.displayName, identityKind: identity.identityKind } };
}

test("one evaluation context bounds repeated unscoped and scoped access reads", async () => {
  const { repo, principal } = setup();
  const context = createAuthModEvaluationContext(repo, principal);
  await resolveUserAccess(repo, { principal, appId: "cpu-production" }, context);
  await Promise.all(Array.from({ length: 20 }, (_, index) => resolveUserAccess(repo, { principal, appId: "cpu-production", oplocId: `oploc:${index}` }, context)));
  assert.equal(repo.counts.identities, 1);
  assert.equal(repo.counts.grants, 1);
  assert.equal(repo.counts.apps, 1);
  assert.equal(repo.counts.sites, 1);
  assert.equal(repo.counts.applications, 1);
  assert.equal(repo.counts.oplocs, 20);
});

test("evaluateAuthority reuses the base identity and grants", async () => {
  const { repo, principal } = setup();
  const context = createAuthModEvaluationContext(repo, principal);
  const decision = await evaluateAuthority(repo, { principal, appId: "cpu-production", resource: "production", action: "View", scope: { kind: "oploc", ids: ["oploc:0"] } }, context);
  assert.equal(decision.allowed, true);
  assert.equal(repo.counts.identities, 1);
  assert.equal(repo.counts.grants, 1);
  assert.equal(repo.counts.apps, 1);
  assert.equal(repo.counts.sites, 1);
  assert.equal(repo.counts.applications, 1);
});

test("interactive hot paths do not contain whole canonical collection gets", () => {
  const files = [
    "../app/api/oplocs/route.ts",
    "../app/api/delivered-in/access/route.ts",
    "../../cpu-production/app/api/production/route.ts",
    "../../cpu-production/lib/cpu-projection.ts",
  ];
  for (const file of files) assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), "utf8"), /collection\(["']integrationHubCanonical["']\)\.get\(\)/);
});
