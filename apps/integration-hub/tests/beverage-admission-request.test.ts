import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { DocumentReference, Query, type Transaction } from "firebase-admin/firestore";
import { encodeReadPackage, publishReadPackage } from "@fika/server-shared/read-package";
import { decideBeverageRequestAuthority } from "../lib/beverage-admission-request";
import { authmodAccessManifestKey, AUTHMOD_ACCESS_DATASET } from "../lib/authmod-access-read-package";
import {
  BEVERAGE_AUTHMOD_APP_ID, BEVERAGE_AUTHMOD_NORMAL_ACTIONS, BEVERAGE_AUTHMOD_NORMAL_BUNDLE,
  BEVERAGE_AUTHMOD_NORMAL_RESOURCE,
} from "../lib/authmod-core/beverage-admission";
import { grantAuthority } from "../lib/authmod-core/authority";
import { grantStandardApplicationAccess } from "../lib/authmod-core/grants";
import { createAuthIdentity } from "../lib/authmod-core/identity";
import { MemoryAuthModRepository } from "../lib/authmod-core/memory-repository";
import type { ApplicationRegistryEntry, AuthPrincipal } from "../lib/authmod-core/model";
import { canonicalDocumentId } from "../lib/canonical-oplocs";
import { OPLOC_DATASET, OPLOC_MANIFEST_KEY, oplocPackageStore } from "../lib/oploc-read-package";
import { sessionCookieConfig } from "../lib/runtime-config";

const cookie = "fictional-session-cookie";
const uid = "fixture:firebase-beverage";
const site = "oploc:fixture-current";
const alias = "oploc:fixture-legacy";
const actor: AuthPrincipal = { id: "fixture:operator", type: "interactive", displayName: "Fixture operator" };
const app: ApplicationRegistryEntry = {
  appId: BEVERAGE_AUTHMOD_APP_ID, displayName: "Beverage Innovation", enabled: true, launchVisible: false, scopeModel: "oploc",
  standardBundleId: BEVERAGE_AUTHMOD_NORMAL_BUNDLE, standardResource: BEVERAGE_AUTHMOD_NORMAL_RESOURCE,
  standardActions: [...BEVERAGE_AUTHMOD_NORMAL_ACTIONS], version: 1, provenance: "migration",
  createdAt: "2026-11-07T00:00:00.000Z", updatedAt: "2026-11-07T00:00:00.000Z",
};

function request(value?: string) {
  return { cookies: { get: (name: string) => name === sessionCookieConfig().name && value ? { value } : undefined } };
}

test("Beverage validates the canonical session and bounded input before opening an authority snapshot", async () => {
  let verifications = 0;
  let snapshots = 0;
  const dependencies: NonNullable<Parameters<typeof decideBeverageRequestAuthority>[2]> = {
    auth: { async verifySessionCookie(value, checkRevoked) {
      assert.equal(value, cookie);
      assert.equal(checkRevoked, true);
      verifications++;
      throw new Error("Fictional revoked session");
    } },
    firestore: { async runTransaction() {
      snapshots++;
      throw new Error("Do not open a snapshot for an invalid request");
    } },
  };
  const validScope = { action: "View", oplocIds: [site] } as const;
  assert.equal((await decideBeverageRequestAuthority(request(), validScope, dependencies)).reasonCode, "unauthenticated");
  assert.equal((await decideBeverageRequestAuthority(request(cookie), { ...validScope, oplocIds: [] }, dependencies)).reasonCode, "invalid-request");
  assert.equal(verifications, 0);
  assert.equal((await decideBeverageRequestAuthority(request(cookie), validScope, dependencies)).reasonCode, "unauthenticated");
  assert.equal(verifications, 1);
  assert.equal(snapshots, 0);
});

test("Beverage reads only the UID binding, current packages and canonical site within one read-only snapshot", async t => {
  assert.equal(sessionCookieConfig().mode, "local");
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "beverage-admission-"));
  const previousRoot = process.env.FIKA_SNAPSHOT_DIR;
  process.env.FIKA_SNAPSHOT_DIR = fixtureRoot;
  t.after(async () => {
    if (previousRoot === undefined) delete process.env.FIKA_SNAPSHOT_DIR;
    else process.env.FIKA_SNAPSHOT_DIR = previousRoot;
    assert.equal(path.dirname(path.resolve(fixtureRoot)), path.resolve(tmpdir()));
    assert.ok(path.basename(fixtureRoot).startsWith("beverage-admission-"));
    await rm(fixtureRoot, { recursive: true, force: true });
  });

  const memory = new MemoryAuthModRepository({ applications: [app], oplocs: [{ id: site, label: "Fixture site", active: true }] });
  const identity = await createAuthIdentity(memory, { actor, displayName: "Fixture reviewer", externalProvider: "firebase", externalUid: uid });
  const { assignment, grants } = await grantStandardApplicationAccess(memory, { actor, identityId: identity.id, appId: app.appId });
  const entitlement = await grantAuthority(memory, {
    actor, subjectId: identity.id, subjectType: "interactive", appId: app.appId, resource: app.standardResource,
    action: "View", scope: { kind: "oploc", ids: [site] }, reason: "Fictional direct Beverage entitlement.",
  });
  const access = { identity, appAssignments: [assignment], authorityGrants: [...grants, entitlement], siteAssignments: [], delegations: [], custodians: [], securityVersion: 3 };
  const expectedReads = [
    "firebase-uid-query", `authmodApplications/${app.appId}`, `authmodAccessHeads/${identity.id}`,
    "integrationHubCacheManifests/oplocs", `integrationHubCanonical/${canonicalDocumentId(site)}`,
  ];
  let bindings = [identity];
  let securityHead = 3;
  let oplocHead = 4;
  const events: string[] = [];
  const tx = {
    async get(ref: Query | DocumentReference) {
      if (ref instanceof Query) {
        events.push("firebase-uid-query");
        return { size: bindings.length, docs: bindings.map(value => ({ data: () => value })) };
      }
      events.push(ref.path);
      const documents: Record<string, unknown> = {
        [expectedReads[1]]: app,
        [expectedReads[2]]: { version: securityHead },
        [expectedReads[3]]: { version: oplocHead },
        [expectedReads[4]]: { canonicalId: site, entityType: "OPLOC", record: { lifecycleState: "active" } },
      };
      assert.ok(Object.hasOwn(documents, ref.path), "Unexpected authority read");
      return { exists: true, data: () => documents[ref.path] };
    },
  } as Transaction;
  const dependencies: NonNullable<Parameters<typeof decideBeverageRequestAuthority>[2]> = {
    auth: { async verifySessionCookie(value, checkRevoked) {
      assert.equal(value, cookie);
      assert.equal(checkRevoked, true);
      events.push("verified");
      return { uid };
    } },
    firestore: { async runTransaction(read, options) {
      assert.deepEqual(options, { readOnly: true });
      events.push("snapshot");
      return read(tx);
    } },
  };
  const decide = () => decideBeverageRequestAuthority(request(cookie), { action: "View", oplocIds: [alias] }, dependencies);

  // Missing authority must never create a replacement package.
  assert.equal((await decide()).reasonCode, "store-unavailable");
  assert.deepEqual(events.splice(0), ["verified", "snapshot", ...expectedReads.slice(0, 3)]);
  assert.deepEqual(await readdir(fixtureRoot), []);

  const store = oplocPackageStore();
  await publishReadPackage(store, authmodAccessManifestKey(identity.id), encodeReadPackage(AUTHMOD_ACCESS_DATASET, 1, access, 1, {
    contractVersion: "integration-hub.authmod-access.v1", sourceVersion: "authmod-security:3", scope: identity.id,
  }));
  assert.equal((await decide()).reasonCode, "store-unavailable");
  assert.deepEqual(events.splice(0), ["verified", "snapshot", ...expectedReads.slice(0, 3)]);
  assert.equal(await store.getManifest(OPLOC_MANIFEST_KEY), undefined);

  await publishReadPackage(store, OPLOC_MANIFEST_KEY, encodeReadPackage(OPLOC_DATASET, 1, {
    oplocs: [{ canonicalId: site, label: "Fixture site" }], redirects: { [alias]: site },
  }, 2, { contractVersion: "integration-hub.oplocs.v2", sourceVersion: "canonical-oplocs:4" }));
  const allowed = await decide();
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.principalId, identity.id);
  assert.deepEqual(allowed.scope, { kind: "oploc", ids: [site] });
  assert.deepEqual(events.splice(0), ["verified", "snapshot", ...expectedReads]);

  securityHead++;
  assert.equal((await decide()).reasonCode, "store-unavailable");
  assert.deepEqual(events.splice(0), ["verified", "snapshot", ...expectedReads.slice(0, 3)]);
  assert.equal((await store.getManifest(authmodAccessManifestKey(identity.id)))?.sourceVersion, "authmod-security:3");
  securityHead--;
  oplocHead++;
  assert.equal((await decide()).reasonCode, "store-unavailable");
  assert.deepEqual(events.splice(0), ["verified", "snapshot", ...expectedReads.slice(0, 4)]);
  assert.equal((await store.getManifest(OPLOC_MANIFEST_KEY))?.sourceVersion, "canonical-oplocs:4");

  bindings = [identity, { ...identity, id: "fixture:duplicate" }];
  assert.equal((await decide()).reasonCode, "unauthenticated");
  assert.deepEqual(events, ["verified", "snapshot", "firebase-uid-query"]);
});
