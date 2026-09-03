import assert from "node:assert/strict";
import test from "node:test";
import { fikaBuildIdentity } from "@fika/server-shared/build-identity";
import { resolveFikaBuildSha } from "@fika/server-shared/build-identity-resolver";

test("build identity prefers the explicitly injected source SHA and never exposes unrelated environment values", () => {
  assert.deepEqual(fikaBuildIdentity({ FIKA_BUILD_SHA: "abc123", GITHUB_SHA: "older", K_REVISION: "rev-1" } as unknown as NodeJS.ProcessEnv), { buildSha: "abc123", runtimeRevision: "rev-1", source: "FIKA_BUILD_SHA" });
  assert.equal(fikaBuildIdentity({} as unknown as NodeJS.ProcessEnv).buildSha, "unknown");
});

test("build provenance resolves the current repository HEAD", () => {
  assert.match(resolveFikaBuildSha({} as unknown as NodeJS.ProcessEnv), /^[0-9a-f]{40}$/);
});

test("build provenance fails closed when an injected SHA disagrees with git HEAD", () => {
  assert.throws(() => resolveFikaBuildSha({ FIKA_BUILD_SHA: "0000000000000000000000000000000000000000" } as unknown as NodeJS.ProcessEnv), /provenance mismatch/i);
});
