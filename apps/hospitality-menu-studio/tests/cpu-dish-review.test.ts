import assert from "node:assert/strict";
import test from "node:test";
import { studioDishReviewKey, studioDishReviewSubject, type StudioDishReviewRequest } from "../../shared/hospitality-menu-studio-safety";
import { studioReviewAudience, studioReviewStaging } from "../../shared/hospitality-menu-studio-staging";
import { cpuDishReview } from "../lib/cpu-dish-review";
import { assertStudioDraftCommand, stagedStudioSafetyAvailable } from "../lib/runtime";

const dish = {
  id: "dish:fixture", version: 2, name: "Fixture", category: "other", temperature: null,
  customerDescription: "Customer text", kitchenDescription: "Private kitchen text", assortment: null,
};
const subject = studioDishReviewSubject(dish);
const review: StudioDishReviewRequest = {
  contract: "hospitality-menu-studio.dish-review-request.v1", subject, dish,
  requestedAt: "2026-11-20T11:00:00Z", requestedBy: "author",
};
const claims = {
  sub: studioReviewStaging.studioIdentity.subject, email: studioReviewStaging.studioIdentity.email, email_verified: true,
  exp: 4_000_000_000, aud: studioReviewAudience, iss: "https://accounts.google.com",
};

function metadata(claimsToUse: Record<string, unknown> = claims) {
  const payload = Buffer.from(JSON.stringify(claimsToUse)).toString("base64url");
  return new Response(`header.${payload}.fixture`, { headers: { "Metadata-Flavor": "Google" } });
}

test("staging food-safety access is opt-in and cannot enable publication or activation", () => {
  const env = {
    NODE_ENV: "test" as const, FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev", FIKA_HUB_BASE_URL: "https://staging-os.fikacatering.com",
    FIKA_STUDIO_ORIGIN: "https://menu-studio-staging.fikacatering.com", FIKA_STUDIO_FIRESTORE_DATABASE: "hospitality-menu-studio",
    FIKA_SESSION_COOKIE_DOMAIN: ".fikacatering.com",
  };
  assert.equal(stagedStudioSafetyAvailable(env), false);
  assert.equal(stagedStudioSafetyAvailable({ ...env, FIKA_STUDIO_CPU_REVIEW_ENABLED: "true" }), true);
  assert.throws(() => assertStudioDraftCommand("submit-dish-review"), { code: "STUDIO_WRITE_DENIED" });
  assert.doesNotThrow(() => assertStudioDraftCommand("submit-dish-review", true));
  for (const action of ["publish", "activate-collection", "restore-menu"]) {
    assert.throws(() => assertStudioDraftCommand(action, true), { code: "STUDIO_WRITE_DENIED" });
  }
});

test("Studio sends only the exact saved request to the pinned CPU receiver without forwarding a user session", async () => {
  const hits: string[] = [];
  const client = cpuDishReview(async (input, init) => {
    const url = new URL(String(input));
    hits.push(url.origin);
    if (url.hostname === "metadata.google.internal") {
      assert.equal(url.searchParams.get("audience"), studioReviewAudience);
      assert.equal(new Headers(init?.headers).get("Metadata-Flavor"), "Google");
      return metadata();
    }
    assert.equal(url.toString(), studioReviewAudience);
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).has("cookie"), false);
    assert.match(new Headers(init?.headers).get("authorization") || "", /^Bearer header\./);
    assert.deepEqual(JSON.parse(String(init?.body)), { action: "submit", request: review });
    return Response.json({ subject });
  });
  assert.deepEqual(await client.submit(review), { subject });
  assert.deepEqual(hits, ["http://metadata.google.internal", "https://cpu-staging.fikacatering.com"]);
});

test("Studio rejects a different runtime identity before sending or trusting status", async () => {
  const client = cpuDishReview(async input => {
    assert.equal(new URL(String(input)).hostname, "metadata.google.internal");
    return metadata({ ...claims, sub: "other-staging-service" });
  });
  await assert.rejects(client.submit(review), { code: "DISH_REVIEW_UNAVAILABLE" });
  assert.deepEqual(await client.status(subject), { status: "unavailable" });
});

test("verified food-safety status requires a current fence for the same dish and exact saved revision", async () => {
  const fence = {
    contract: "cpu-production.studio-dish-safety.v1", subject, status: "current",
    releaseId: `cpu-studio-dish-release:${studioDishReviewKey(dish.id, dish.version)}:v1`,
    matrixHash: "c".repeat(64), changedAt: "2026-11-20T11:15:00Z",
  };
  let result: unknown = { subject, status: "verified", fence };
  const client = cpuDishReview(async input => new URL(String(input)).hostname === "metadata.google.internal" ? metadata() : Response.json(result));
  assert.deepEqual(await client.status(subject), { status: "verified" });
  for (const invalid of [
    { subject, status: "verified" },
    { subject: { ...subject, revision: 1 }, status: "verified", fence },
    { subject, status: "verified", fence: { ...fence, status: "revoked" } },
    { subject, status: "verified", fence, inventedApproval: true },
  ]) {
    result = invalid;
    assert.deepEqual(await client.status(subject), { status: "unavailable" });
  }
  result = { subject, status: "revoked", fence: { ...fence, status: "revoked" } };
  assert.deepEqual(await client.status(subject), { status: "revoked" });
});
