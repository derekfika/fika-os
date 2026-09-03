import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fikaBuildIdentity } from "@fika/server-shared/build-identity";
import { resolveFikaBuildSha } from "@fika/server-shared/build-identity-resolver";

test("build identity prefers the explicitly injected source SHA and never exposes unrelated environment values", () => {
  const sha = "a".repeat(40);
  assert.deepEqual(fikaBuildIdentity({ FIKA_BUILD_SHA: sha, GITHUB_SHA: "older", K_REVISION: "rev-1" } as unknown as NodeJS.ProcessEnv), { buildSha: sha, runtimeRevision: "rev-1", source: "FIKA_BUILD_SHA" });
});

test("build identity reads the SHA embedded in the standalone Next runtime config", () => {
  const sha = "b".repeat(40);
  assert.deepEqual(fikaBuildIdentity({ __NEXT_PRIVATE_STANDALONE_CONFIG: JSON.stringify({ env: { FIKA_BUILD_SHA: sha } }), K_REVISION: "rev-2" } as unknown as NodeJS.ProcessEnv), { buildSha: sha, runtimeRevision: "rev-2", source: "NEXT_STANDALONE_CONFIG" });
});

test("build identity fails visibly when no valid provenance is available", () => {
  assert.throws(() => fikaBuildIdentity({} as unknown as NodeJS.ProcessEnv, path.join(process.cwd(), "tests")), /provenance is unavailable/i);
});

test("build provenance resolves the current repository HEAD", () => {
  assert.match(resolveFikaBuildSha({} as unknown as NodeJS.ProcessEnv), /^[0-9a-f]{40}$/);
});

test("build provenance fails closed when an injected SHA disagrees with git HEAD", () => {
  assert.throws(() => resolveFikaBuildSha({ FIKA_BUILD_SHA: "0000000000000000000000000000000000000000" } as unknown as NodeJS.ProcessEnv), /provenance mismatch/i);
});
