import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/api/internal/beverage/reference/[resource]/route";
import { handleBeverageReference, type BeverageReferenceDeps } from "../lib/beverage-reference";
import { collectBoundedBeverageObject } from "../lib/beverage-reference-object";
import { beverageReferenceConfig } from "../lib/beverage-reference-config";
import {
  BEVERAGE_AUTHMOD_APP_ID, BEVERAGE_AUTHMOD_NORMAL_BUNDLE,
  BEVERAGE_AUTHMOD_NORMAL_RESOURCE, decideBeverageSiteAuthority, type ReadOnlyBeverageAuthority,
} from "../lib/authmod-core/beverage-admission";
import { grantAuthority } from "../lib/authmod-core/authority";
import { assignSite, grantStandardApplicationAccess } from "../lib/authmod-core/grants";
import { createAuthIdentity } from "../lib/authmod-core/identity";
import { MemoryAuthModRepository } from "../lib/authmod-core/memory-repository";
import type { ApplicationRegistryEntry, AuthPrincipal } from "../lib/authmod-core/model";
import { DEFAULT_FOOD_DATA_BUCKET } from "../lib/food-data/config";
import { datasetVersion } from "../lib/food-data/manifest";
import { defaultFiles, makeManifest } from "./food-data/fixtures";

const audience = "https://staging-os.fikacatering.com/api/internal/beverage/reference";
const caller = {
  sub: "123456789012345678901", email: "fixture-beverage@fika-os-dev.iam.gserviceaccount.com",
  email_verified: true, iss: "https://accounts.google.com", aud: audience, exp: Math.floor(Date.now() / 1000) + 3600,
};
const site = "oploc:fixture-current";
const otherSite = "oploc:fixture-ungranted";
const alias = "oploc:fixture-legacy";
const uid = "fixture:firebase-person";
const files = defaultFiles();
const manifest = makeManifest(files);
const version = datasetVersion(manifest, "ingredients");
const fixtureEnv = {
  FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev", FIKA_BEVERAGE_REFERENCE_ENABLED: "true",
  FIKA_BEVERAGE_REFERENCE_CALLER_SUBJECT: caller.sub, FIKA_BEVERAGE_REFERENCE_CALLER_EMAIL: caller.email,
  FIKA_BEVERAGE_REFERENCE_AUDIENCE: audience, FIKA_BEVERAGE_FOOD_DATA_BUCKET: DEFAULT_FOOD_DATA_BUCKET,
  FIKA_BEVERAGE_FOOD_DATA_VERSION: version,
};
const config = beverageReferenceConfig(fixtureEnv)!;

function request(query = `oploc=${encodeURIComponent(alias)}`, headers: HeadersInit = { authorization: "Bearer fixture.jwt.token" }) {
  return new Request(`${audience}/oplocs?${query}`, { headers });
}

async function fixture() {
  const app: ApplicationRegistryEntry = {
    appId: BEVERAGE_AUTHMOD_APP_ID, displayName: "Fixture Beverage", enabled: true, launchVisible: false, scopeModel: "oploc",
    standardBundleId: BEVERAGE_AUTHMOD_NORMAL_BUNDLE, standardResource: BEVERAGE_AUTHMOD_NORMAL_RESOURCE,
    standardActions: ["View"], version: 1, provenance: "migration",
    createdAt: "2026-11-07T00:00:00.000Z", updatedAt: "2026-11-07T00:00:00.000Z",
  };
  const actor: AuthPrincipal = { id: "fixture:authority-admin", type: "interactive", displayName: "Fixture admin" };
  const repo = new MemoryAuthModRepository({ applications: [app], oplocs: [
    { id: site, label: "Fixture approved name", active: true }, { id: otherSite, label: "Fixture ungranted site", active: true },
  ] });
  const identity = await createAuthIdentity(repo, { actor, displayName: "Fixture reviewer", externalProvider: "firebase", externalUid: uid });
  await grantStandardApplicationAccess(repo, { actor, identityId: identity.id, appId: app.appId });
  const grant = await grantAuthority(repo, {
    actor, subjectId: identity.id, subjectType: "interactive", appId: app.appId, resource: app.standardResource,
    action: "View", scope: { kind: "oploc", ids: [site] }, reason: "Fictional direct Beverage View grant.",
  });
  repo.findIdentitiesByEmail = async () => { throw new Error("A reference request must not match by email."); };
  const authority: ReadOnlyBeverageAuthority = {
    findIdentitiesByExternal: (...args) => repo.findIdentitiesByExternal(...args),
    getApplication: id => repo.getApplication(id),
    getActiveOploc: id => repo.getActiveOploc(id),
    async readCurrentOplocRedirects() { return { [alias]: site }; },
    async readCurrentAccessPackage(id) {
      return {
        identity: (await repo.getIdentity(id))!, appAssignments: await repo.listAppAssignments(id),
        authorityGrants: await repo.listAuthorityGrants(id),
      };
    },
  };
  const state = { cookie: "verified-fixture-cookie", uid, verifications: 0, snapshots: 0, manifest };
  const reads: Array<[string, number]> = [];
  const deps: BeverageReferenceDeps = {
    config,
    async verifyCaller(token, expectedAudience) {
      assert.equal(token, "fixture.jwt.token");
      assert.equal(expectedAudience, audience);
      return caller;
    },
    decide: input => decideBeverageSiteAuthority(async read => {
      state.snapshots++;
      return read(authority);
    }, async (cookie, revoked) => {
      assert.equal(revoked, true);
      state.verifications++;
      if (cookie !== "verified-fixture-cookie") throw new Error("Fixture session revoked.");
      return { uid: state.uid };
    }, { ...input, sessionCookie: state.cookie }),
    async readFoodObject(name, maxBytes) {
      reads.push([name, maxBytes]);
      return name === "manifest.json" ? Buffer.from(JSON.stringify(state.manifest)) : files.ingredients.gzip;
    },
  };
  return { deps, repo, identity, grant, actor, reads, state };
}

test("Beverage reference is disabled by default and rejects wrong environment or caller binding", async t => {
  assert.ok(config.food);
  assert.equal(beverageReferenceConfig({}), undefined);
  assert.equal(beverageReferenceConfig({ FIKA_RUNTIME_MODE: "production", FIKA_BEVERAGE_REFERENCE_ENABLED: "true" }), undefined);
  assert.equal(beverageReferenceConfig({ FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev", FIKA_BEVERAGE_REFERENCE_ENABLED: "true" }), undefined);
  assert.equal(beverageReferenceConfig({ ...fixtureEnv, GCLOUD_PROJECT: "fika-os" }), undefined);
  assert.equal(beverageReferenceConfig({ ...fixtureEnv, FIKA_FOOD_DATA_ENABLED: "false" })?.food, undefined);
  const priorFlag = process.env.FIKA_BEVERAGE_REFERENCE_ENABLED;
  delete process.env.FIKA_BEVERAGE_REFERENCE_ENABLED;
  t.after(() => {
    if (priorFlag === undefined) delete process.env.FIKA_BEVERAGE_REFERENCE_ENABLED;
    else process.env.FIKA_BEVERAGE_REFERENCE_ENABLED = priorFlag;
  });
  const response = await GET(new NextRequest(request()), { params: Promise.resolve({ resource: "oplocs" }) });
  assert.equal(response.status, 404);

  const { deps, reads, state } = await fixture();
  assert.equal((await handleBeverageReference(request(undefined, {}), "oplocs", deps)).status, 401);
  assert.equal((await handleBeverageReference(request(undefined, { origin: "https://example.test" }), "oplocs", deps)).status, 403);
  assert.equal((await handleBeverageReference(new Request(request(), { method: "HEAD" }), "oplocs", deps)).status, 404);
  for (const claim of [{ ...caller, aud: "other" }, { ...caller, sub: "other" }, { ...caller, email_verified: false }, { ...caller, exp: 1 }]) {
    assert.equal((await handleBeverageReference(request(), "manifest", { ...deps, verifyCaller: async () => claim })).status, 401);
  }
  assert.equal(state.verifications, 0);
  assert.equal(state.snapshots, 0);
  assert.deepEqual(reads, []);
});

test("OPLOC-only configuration leaves both Food Data resources disabled before opening authority or storage", async () => {
  const { deps, reads, state } = await fixture();
  const oplocOnly = beverageReferenceConfig({
    ...fixtureEnv, FIKA_BEVERAGE_FOOD_DATA_BUCKET: undefined, FIKA_BEVERAGE_FOOD_DATA_VERSION: undefined,
  });
  assert.ok(oplocOnly);
  assert.equal(oplocOnly.food, undefined);
  const enabled = { ...deps, config: oplocOnly };
  assert.equal((await handleBeverageReference(request(), "manifest", enabled)).status, 404);
  assert.equal((await handleBeverageReference(request(`oploc=${site}&version=${version}`), "ingredients", enabled)).status, 404);
  assert.equal(state.snapshots, 0);
  assert.equal((await handleBeverageReference(request(), "oplocs", enabled)).status, 200);
  assert.equal(state.snapshots, 1);
  assert.deepEqual(reads, []);
});

test("verified service identity cannot replace a current, explicitly granted person or active canonical OPLOC", async () => {
  const { deps, repo, identity, grant, actor, reads, state } = await fixture();
  await assignSite(repo, { actor, identityId: identity.id, oplocId: site });
  const audits = repo.audits.length;
  state.cookie = "";
  assert.equal((await handleBeverageReference(request(), "manifest", deps)).status, 401);
  state.cookie = "revoked-fixture";
  assert.equal((await handleBeverageReference(request(), "manifest", deps)).status, 401);
  assert.equal(state.snapshots, 0);
  state.cookie = "verified-fixture-cookie";
  state.uid = "fixture:unbound";
  assert.equal((await handleBeverageReference(request(), "manifest", deps)).status, 401);
  state.uid = uid;
  repo.grants.set(grant.id, { ...grant, status: "revoked" });
  assert.equal((await handleBeverageReference(request(), "manifest", deps)).status, 403);
  assert.equal((await handleBeverageReference(request(), "oplocs", deps)).status, 403);
  repo.grants.set(grant.id, grant);
  repo.identities.set(identity.id, { ...identity, identityKind: "operational" });
  assert.equal((await handleBeverageReference(request(), "manifest", deps)).status, 403);
  repo.identities.set(identity.id, identity);
  assert.equal((await handleBeverageReference(request(""), "oplocs", deps)).status, 400);
  assert.equal((await handleBeverageReference(request(`oploc=${encodeURIComponent(otherSite)}`), "oplocs", deps)).status, 403);
  const allowed = await handleBeverageReference(request(), "oplocs", deps);
  assert.deepEqual(await allowed.json(), { readOnly: true, oplocs: [{ id: site, label: "Fixture approved name" }] });
  repo.oplocs.delete(site);
  assert.equal((await handleBeverageReference(request(), "oplocs", deps)).status, 403);
  assert.equal(repo.audits.length, audits);
  assert.deepEqual(reads, []);
});

test("Food Data reads only the current pinned manifest and hash-verified raw ingredient object", async () => {
  const { deps, reads, state } = await fixture();
  const manifestResponse = await handleBeverageReference(request(), "manifest", deps);
  assert.equal(manifestResponse.status, 200);
  const output = await manifestResponse.json();
  assert.equal(output.version, version);
  assert.deepEqual(Object.keys(output.manifest.files), ["ingredients"]);
  assert.equal(output.manifest.files.ingredients.object, undefined);
  assert.deepEqual(reads.splice(0), [["manifest.json", 64 * 1024]]);

  const bundleRequest = request(`oploc=${encodeURIComponent(site)}&version=${encodeURIComponent(version)}`);
  const bundle = await handleBeverageReference(bundleRequest, "ingredients", deps);
  assert.equal(bundle.status, 200);
  assert.equal(bundle.headers.get("content-type"), "application/gzip");
  assert.equal(bundle.headers.get("content-encoding"), null);
  assert.equal(bundle.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(Buffer.from(await bundle.arrayBuffer()), files.ingredients.gzip);
  assert.deepEqual(reads.splice(0), [["manifest.json", 64 * 1024], ["ingredients.json.gz", files.ingredients.gzip.byteLength]]);

  const entry = manifest.files.ingredients;
  state.manifest = { ...manifest, files: { ...manifest.files, ingredients: { ...entry, gzipSha256: "0".repeat(64) } } };
  assert.equal((await handleBeverageReference(bundleRequest, "ingredients", deps)).status, 409);
  assert.deepEqual(reads.splice(0), [["manifest.json", 64 * 1024]]);
  for (const change of [{ object: "other.json.gz" }, { gzipBytes: 5 * 1024 * 1024 + 1 }, { jsonBytes: 40 * 1024 * 1024 + 1 }]) {
    state.manifest = { ...manifest, files: { ...manifest.files, ingredients: { ...entry, ...change } } };
    assert.equal((await handleBeverageReference(bundleRequest, "ingredients", deps)).status, 503);
    assert.deepEqual(reads.splice(0), [["manifest.json", 64 * 1024]]);
  }
  state.manifest = { ...manifest, files: { ...manifest.files, ingredients: { ...entry, jsonSha256: "0".repeat(64) } } };
  assert.equal((await handleBeverageReference(bundleRequest, "ingredients", deps)).status, 503);
  state.manifest = manifest;
  assert.equal((await handleBeverageReference(bundleRequest, "ingredients", {
    ...deps,
    async readFoodObject(name, maxBytes) {
      const bytes = Buffer.from(await deps.readFoodObject(name, maxBytes));
      if (name === "ingredients.json.gz") bytes[0] ^= 1;
      return bytes;
    },
  })).status, 503);
});

test("Food Data streaming cap closes the raw source without returning partial data", async () => {
  let closed = false;
  async function* oversize() {
    try { yield Uint8Array.of(1, 2); yield Uint8Array.of(3, 4); }
    finally { closed = true; }
  }
  await assert.rejects(() => collectBoundedBeverageObject(oversize(), 3), /byte limit/);
  assert.equal(closed, true);
});
