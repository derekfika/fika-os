import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { MemoryAuthModRepository, V1_APPLICATIONS, createAuthIdentity, grantAuthority, revokeAuthority } from "../../lib/authmod-core";
import type { AuthPrincipal } from "../../lib/authmod-core";
import { hasFoodDataAccess } from "../../lib/food-data/access";
import { foodDataConfig, FOOD_DATA_GRANT } from "../../lib/food-data/config";
import { FoodDataError, datasetVersion } from "../../lib/food-data/manifest";
import { handleFoodDataBundle, handleFoodDataManifest, type FoodDataServerDeps } from "../../lib/food-data/service";
import { defaultFiles, makeManifest } from "./fixtures";

const files = defaultFiles(); const manifest = makeManifest(files);
function harness(overrides: Partial<{ enabled: boolean; allowed: boolean; authenticated: boolean; objects: Record<string, Uint8Array> }> = {}) {
  const reads: string[] = []; const counts = { authenticate: 0, access: 0 };
  const objects: Record<string, Uint8Array> = overrides.objects ?? { "manifest.json": Buffer.from(JSON.stringify(manifest)), "ingredients.json.gz": files.ingredients.gzip, "recipes.json.gz": files.recipes.gzip };
  const deps: FoodDataServerDeps = {
    config: { enabled: overrides.enabled ?? true, bucket: "b", prefix: "p/" },
    async authenticate() { counts.authenticate++; if (overrides.authenticated === false) throw new FoodDataError("Sign in", "FOOD_DATA_UNAUTHENTICATED", 401); return { identityId: "identity:a" }; },
    async hasAccess() { counts.access++; return overrides.allowed ?? true; },
    store: () => ({ async read(name) { reads.push(name); const bytes = objects[name]; if (!bytes) throw new FoodDataError("missing", "FOOD_DATA_OBJECT_MISSING", 404); return bytes; } }),
  };
  return { deps, reads, counts };
}
const get = (url: string, headers: Record<string, string> = {}) => new Request(`https://hub.test${url}`, { headers });
const version = (dataset: "ingredients" | "recipes") => encodeURIComponent(datasetVersion(manifest, dataset));

test("food data server: authorised manifest request is one small object read and returns the identity scope", async () => {
  const h = harness();
  const response = await handleFoodDataManifest(get("/api/food-data/manifest"), h.deps);
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control")!, /no-store/);
  const body = await response.json() as { identityScope: string; readOnly: boolean; manifest: { snapshot: string; pricing: { priceEffectiveDate: null } } };
  assert.equal(body.identityScope, "identity:a"); assert.equal(body.readOnly, true); assert.equal(body.manifest.pricing.priceEffectiveDate, null);
  assert.deepEqual(h.reads, ["manifest.json"]);
});

test("food data server: refused callers cause zero storage reads", async () => {
  for (const [label, options, status] of [["signed out", { authenticated: false }, 401], ["no grant", { allowed: false }, 403], ["disabled", { enabled: false }, 404]] as const) {
    for (const call of [(deps: FoodDataServerDeps) => handleFoodDataManifest(get("/m"), deps), (deps: FoodDataServerDeps) => handleFoodDataBundle(get(`/b?version=${version("recipes")}`), "recipes", deps)]) {
      const h = harness(options); const response = await call(h.deps);
      assert.equal(response.status, status, label); assert.deepEqual(h.reads, [], `${label}: nothing read from the bucket`);
      assert.doesNotMatch(await response.text(), /Tomato|Flour/);
    }
  }
});

test("food data server: cross-site fetches are refused before authentication", async () => {
  const h = harness(); const response = await handleFoodDataManifest(get("/m", { "sec-fetch-site": "cross-site" }), h.deps);
  assert.equal(response.status, 403); assert.equal(h.counts.authenticate, 0); assert.deepEqual(h.reads, []);
  assert.equal((await handleFoodDataManifest(get("/m", { "sec-fetch-site": "same-origin" }), harness().deps)).status, 200);
});

test("food data server: bundle is the exact stored gzip, verified, uncompressed-transport-safe", async () => {
  const h = harness();
  const response = await handleFoodDataBundle(get(`/api/food-data/bundle/ingredients?version=${version("ingredients")}`), "ingredients", h.deps);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/gzip"); assert.equal(response.headers.get("content-encoding"), null);
  assert.match(response.headers.get("cache-control")!, /private, no-store/); assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest.files.ingredients.gzipSha256);
  assert.deepEqual(h.reads, ["manifest.json", "ingredients.json.gz"]);
});

test("food data server: stale versions, unknown datasets and tampered objects are rejected", async () => {
  const stale = await handleFoodDataBundle(get("/b?version=2020-01-01:" + "0".repeat(64)), "recipes", harness().deps);
  assert.equal(stale.status, 409); assert.equal((await stale.json() as { code: string }).code, "FOOD_DATA_VERSION_CHANGED");
  assert.equal((await handleFoodDataBundle(get("/b?version=x"), "../../etc/passwd", harness().deps)).status, 404);
  assert.equal((await handleFoodDataBundle(get("/b"), "recipes", harness().deps)).status, 409, "missing version is not accepted");
  const tampered = harness({ objects: { "manifest.json": Buffer.from(JSON.stringify(manifest)), "recipes.json.gz": Buffer.concat([files.recipes.gzip.subarray(0, 20), Buffer.alloc(20)]), "ingredients.json.gz": files.ingredients.gzip } });
  assert.equal((await handleFoodDataBundle(get(`/b?version=${version("recipes")}`), "recipes", tampered.deps)).status, 502);
});

test("food data server: a manifest pointing outside the prefix is rejected", async () => {
  const evil = JSON.parse(JSON.stringify(manifest)); evil.files.recipes.object = "../other/recipes.json.gz";
  const h = harness({ objects: { "manifest.json": Buffer.from(JSON.stringify(evil)) } });
  assert.equal((await handleFoodDataBundle(get(`/b?version=${version("recipes")}`), "recipes", h.deps)).status, 502);
  assert.deepEqual(h.reads, ["manifest.json"]);
});

test("food data access: only an active person with an effective explicit grant is authorised", async () => {
  const repository = new MemoryAuthModRepository({ applications: [...V1_APPLICATIONS] });
  const actor: AuthPrincipal = { type: "interactive", id: "actor:admin", displayName: "Admin" };
  const person = await createAuthIdentity(repository, { actor, displayName: "Sam", email: "sam@example.test", externalProvider: "firebase", externalUid: "uid:sam", provenance: "migration" });
  assert.equal(await hasFoodDataAccess(repository, person.id), false, "no grant, no access");
  // A different authority, even Administer on authmod, is not Food Data access.
  await grantAuthority(repository, { subjectId: person.id, subjectType: "interactive", actor, appId: "integration-hub", resource: "authmod", action: "Administer", scope: { kind: "organisation", ids: [] }, reason: "admin" });
  assert.equal(await hasFoodDataAccess(repository, person.id), false, "AUTHMOD admin is not implicit Food Data access");
  const grant = await grantAuthority(repository, { subjectId: person.id, subjectType: "interactive", actor, ...FOOD_DATA_GRANT, scope: { kind: "organisation", ids: [] }, reason: "Food costing" });
  assert.equal(await hasFoodDataAccess(repository, person.id), true);
  assert.equal(await hasFoodDataAccess(repository, "identity:unknown"), false);
  await revokeAuthority(repository, { grantId: grant.id, actor, reason: "No longer needed" });
  assert.equal(await hasFoodDataAccess(repository, person.id), false, "revocation takes effect on the next request");
  const timed = await grantAuthority(repository, { subjectId: person.id, subjectType: "interactive", actor, ...FOOD_DATA_GRANT, scope: { kind: "organisation", ids: [] }, effectivePeriod: { effectiveFrom: "2020-01-01T00:00:00.000Z", effectiveTo: "2020-02-01T00:00:00.000Z" }, reason: "Expired" });
  assert.ok(timed); assert.equal(await hasFoodDataAccess(repository, person.id), false, "expired grants do not count");
});

test("food data config: staging and local only, pinned prefix, kill switch", () => {
  assert.equal(foodDataConfig({ FIKA_RUNTIME_MODE: "production" }).enabled, false);
  assert.equal(foodDataConfig({ FIKA_RUNTIME_MODE: "production", FIKA_FOOD_DATA_ENABLED: "true" }).enabled, false);
  assert.equal(foodDataConfig({ FIKA_RUNTIME_MODE: "staging" }).enabled, true);
  assert.equal(foodDataConfig({ FIKA_RUNTIME_MODE: "staging", FIKA_FOOD_DATA_ENABLED: "false" }).enabled, false);
  assert.equal(foodDataConfig({ FIKA_RUNTIME_MODE: "staging", FIKA_FOOD_DATA_PREFIX: "../x/" }).enabled, false);
  assert.equal(foodDataConfig({ FIKA_RUNTIME_MODE: "staging" }).prefix, "kafoodle/v1/2026-10-31/");
});

test("food data isolation: the feature has no Firestore catalogue access and touches no existing domain module", () => {
  const dir = path.join(import.meta.dirname, "..", "..", "lib", "food-data");
  const allowedLocal = new Set(["../authmod-core", "../firebase-admin", "../fika-session"]);
  for (const file of readdirSync(dir)) {
    const source = readFileSync(path.join(dir, file), "utf8");
    assert.doesNotMatch(source, /firebase-admin\/firestore|firebase\/firestore|\bdb\.collection|\.collection\(|onSnapshot|runTransaction/, `${file} must not query Firestore`);
    assert.doesNotMatch(source, /\.(save|setMetadata|copy|move)\(|createWriteStream|getSignedUrl|makePublic|setIamPolicy/, `${file} must not write, sign or publish storage objects`);
    for (const match of source.matchAll(/from "(\.\.\/[^"]+)"/g)) assert.ok(allowedLocal.has(match[1]), `${file} imports ${match[1]}: Food Data may only depend on AUTHMOD identity, session and admin init`);
    for (const match of source.matchAll(/import\("(\.\.\/[^"]+)"\)/g)) assert.ok(allowedLocal.has(match[1]), `${file} dynamically imports ${match[1]}`);
  }
});
