import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createAuthModEvaluationContext, evaluateAuthority, resolveUserAccess } from "../lib/authmod-core/evaluator";
import { buildLauncher } from "../lib/launcher";
import { MemoryAuthModRepository } from "../lib/authmod-core";
import type { AppAssignment, ApplicationRegistryEntry, AuthIdentity, AuthorityGrant, SiteAssignment } from "../lib/authmod-core/model";

class CountingRepository extends MemoryAuthModRepository {
  counts = { identities: 0, grants: 0, apps: 0, sites: 0, applications: 0, oplocs: 0, allOplocs: 0 };
  override async getIdentity(id: string) { this.counts.identities += 1; return super.getIdentity(id); }
  override async listAuthorityGrants(id: string, type?: "interactive" | "service") { this.counts.grants += 1; return super.listAuthorityGrants(id, type); }
  override async listAppAssignments(id: string) { this.counts.apps += 1; return super.listAppAssignments(id); }
  override async listSiteAssignments(id: string) { this.counts.sites += 1; return super.listSiteAssignments(id); }
  override async getApplication(id: string) { this.counts.applications += 1; return super.getApplication(id); }
  override async getActiveOploc(id: string) { this.counts.oplocs += 1; return super.getActiveOploc(id); }
  override async listActiveOplocs() { this.counts.allOplocs += 1; return super.listActiveOplocs(); }
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

test("an access route can seed active OPLOCs and avoid redundant canonical reads", async () => {
  const { repo, principal } = setup();
  const activeOplocs = await repo.listActiveOplocs();
  const context = createAuthModEvaluationContext(repo, principal, activeOplocs);
  await Promise.all(activeOplocs.map(oploc => resolveUserAccess(repo, { principal, appId: "cpu-production", oplocId: oploc.id }, context)));
  assert.equal(repo.counts.allOplocs, 1);
  assert.equal(repo.counts.oplocs, 0);
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

test("full-access launcher resolution does not enumerate the canonical OPLOC registry", async () => {
  const { repo, principal } = setup();
  const identity = repo.identities.get(principal.id)!;
  repo.identities.set(identity.id, { ...identity, fullAccess: true });
  await buildLauncher(repo, principal);
  assert.equal(repo.counts.allOplocs, 0);
  assert.equal(repo.counts.oplocs, 0);
});

test("interactive hot paths do not contain whole canonical collection gets", () => {
  const files = [
    "../app/api/oplocs/route.ts",
    "../app/api/delivered-in/access/route.ts",
    "../../cpu-production/app/api/production/route.ts",
    "../../cpu-production/lib/cpu-projection.ts",
    "../app/api/launcher/route.ts",
  ];
  for (const file of files) assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), "utf8"), /collection\(["']integrationHubCanonical["']\)\.get\(\)/);
  assert.doesNotMatch(readFileSync(new URL("../lib/launcher.ts", import.meta.url), "utf8"), /activeOplocs\(\)/);
  assert.match(readFileSync(new URL("../lib/authmod-core/firestore-repository.ts", import.meta.url), "utf8"), /integrationHubCanonical.*doc\(canonicalDocumentId\(oplocId\)\)\.get/);
  const authmodRepository = readFileSync(new URL("../lib/authmod-core/firestore-repository.ts", import.meta.url), "utf8");
  assert.match(authmodRepository, /getAuthmodReferenceReadPackage/);
  assert.match(readFileSync(new URL("../lib/authmod-reference-read-package.ts", import.meta.url), "utf8"), /where\("entityType", "==", "Legend"\)/);
  assert.match(readFileSync(new URL("../lib/authmod-reference-read-package.ts", import.meta.url), "utf8"), /where\("entityType", "==", "Employment"\)/);
  assert.doesNotMatch(authmodRepository, /readAll<CanonicalRecord>\("integrationHubCanonical"\)/);
  assert.match(readFileSync(new URL("../lib/repository.ts", import.meta.url), "utf8"), /canonicalRef\(\)\.doc\(canonicalDocumentId\(canonicalId\)\)\.get/);
  assert.match(readFileSync(new URL("../lib/repository.ts", import.meta.url), "utf8"), /\.count\(\)\.get/);
});
