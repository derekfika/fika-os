import assert from "node:assert/strict";
import test from "node:test";
import { studioReviewAudience } from "../../shared/hospitality-menu-studio-staging";
import { handleStagedStudioDishReview } from "../lib/studio-dish-review-staging";

const env = {
  FIKA_CPU_STUDIO_REVIEW_ENABLED: "true", FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev",
  CPU_PUBLIC_BASE_URL: "https://cpu-staging.fikacatering.com", FIKA_HUB_BASE_URL: "https://staging-os.fikacatering.com",
};
const caller = { sub: "115415878091159761145", email: "fika-menu-studio-staging@fika-os-dev.iam.gserviceaccount.com", email_verified: true };
const subject = { dishId: "dish:fixture", revision: 2, sourceHash: "a".repeat(64) };
const status = { action: "status", subject };

function request(body: string = JSON.stringify(status), overrides: HeadersInit = {}) {
  const headers = new Headers({ authorization: "Bearer fixture.identity.token", "content-type": "application/json" });
  new Headers(overrides).forEach((value, key) => headers.set(key, value));
  return new Request(studioReviewAudience, { method: "POST", body, headers });
}

test("Studio CPU intake stays closed in production, local, other projects and staging without opt-in", async () => {
  for (const changes of [
    { FIKA_CPU_STUDIO_REVIEW_ENABLED: undefined }, { FIKA_RUNTIME_MODE: "production" }, { FIKA_RUNTIME_MODE: "local" },
    { FIREBASE_PROJECT_ID: "fika-os" }, { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" },
    { GOOGLE_APPLICATION_CREDENTIALS: "/unexpected" }, { GOOGLE_CLOUD_PROJECT: "fika-os" },
    { CPU_PUBLIC_BASE_URL: "https://cpu.fikacatering.com" }, { FIKA_HUB_BASE_URL: "https://os.fikacatering.com" },
  ]) {
    const response = await handleStagedStudioDishReview(request(), { env: { ...env, ...changes },
      async verifyCaller() { assert.fail("No token verification outside the approved staging runtime."); },
      async store() { assert.fail("No Firestore access."); },
    });
    assert.equal(response.status, 404);
  }
});

test("Studio CPU intake requires the verified dedicated service identity and rejects browser requests", async () => {
  const denied = async (source: Request, claims?: Partial<typeof caller>) => handleStagedStudioDishReview(source, {
    env,
    async verifyCaller(token, audience) {
      assert.equal(token, "fixture.identity.token");
      assert.equal(audience, studioReviewAudience);
      return claims;
    },
    async store() { assert.fail("An unauthorized request cannot open the store."); },
  });
  assert.equal((await denied(request(undefined, { origin: "https://menu-studio-staging.fikacatering.com" }), caller)).status, 403);
  assert.equal((await denied(request(undefined, { cookie: "session=example" }), caller)).status, 403);
  assert.equal((await denied(request(undefined, { authorization: "" }), caller)).status, 401);
  assert.equal((await denied(request(), undefined)).status, 401);
  assert.equal((await denied(request(), { ...caller, sub: "other-staging-identity" })).status, 401);
  assert.equal((await denied(request(), { ...caller, email_verified: false })).status, 401);
});

test("authorized status input is bounded and validated before Firestore; a read cannot register evidence", async () => {
  let reads = 0;
  const apply = (source: Request) => handleStagedStudioDishReview(source, {
    env,
    async verifyCaller() { return caller; },
    async store() {
      return {
        async register() { assert.fail("Status requests cannot register a review."); },
        async readiness(requested) {
          reads += 1;
          assert.deepEqual(requested, subject);
          return { subject, status: "in_review" };
        },
      };
    },
  });
  assert.equal((await apply(request("x".repeat(500_001)))).status, 413);
  assert.equal((await apply(request(JSON.stringify({ ...status, extra: true })))).status, 422);
  assert.equal((await apply(request("malformed"))).status, 422);
  assert.equal((await apply(request(undefined, { "content-type": "text/plain" }))).status, 415);
  assert.equal(reads, 0);
  const result = await apply(request());
  assert.equal(result.status, 200);
  assert.equal(result.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await result.json(), { subject, status: "in_review" });
  assert.equal(reads, 1);
});
