import assert from "node:assert/strict";
import test from "node:test";
import { fikaBuildIdentity } from "@fika/server-shared/build-identity";

test("build identity prefers the explicitly injected source SHA and never exposes unrelated environment values", () => {
  assert.deepEqual(fikaBuildIdentity({ FIKA_BUILD_SHA: "abc123", GITHUB_SHA: "older", K_REVISION: "rev-1" } as unknown as NodeJS.ProcessEnv), { buildSha: "abc123", runtimeRevision: "rev-1", source: "FIKA_BUILD_SHA" });
  assert.equal(fikaBuildIdentity({} as unknown as NodeJS.ProcessEnv).buildSha, "unknown");
});
