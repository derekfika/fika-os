import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GET } from "../app/api/build-info/route";

const provenanceKeys = ["FIKA_BUILD_SHA", "GIT_COMMIT_SHA", "GITHUB_SHA", "__NEXT_PRIVATE_STANDALONE_CONFIG", "NEXT_BUILD_ID"] as const;

test("GET exposes only the validated Logistics build identity without caching", async () => {
  const previous = new Map(provenanceKeys.map(key => [key, process.env[key]]));
  const sha = "a".repeat(40);
  process.env.FIKA_BUILD_SHA = sha;
  try {
    const response = await GET();
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    assert.deepEqual(await response.json(), { appId: "logistics", buildSha: sha });
  } finally {
    for (const key of provenanceKeys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("GET fails closed when build provenance is missing or invalid", async () => {
  const previous = new Map(provenanceKeys.map(key => [key, process.env[key]]));
  const previousCwd = process.cwd();
  const isolatedCwd = mkdtempSync(path.join(os.tmpdir(), "fika-build-info-"));
  for (const key of provenanceKeys) delete process.env[key];
  process.env.NEXT_BUILD_ID = "not-a-full-git-sha";
  try {
    process.chdir(isolatedCwd);
    const response = await GET();
    assert.equal(response.status, 503);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    assert.deepEqual(await response.json(), { code: "BUILD_PROVENANCE_UNAVAILABLE" });
  } finally {
    process.chdir(previousCwd);
    rmSync(isolatedCwd, { recursive: true, force: true });
    for (const key of provenanceKeys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
