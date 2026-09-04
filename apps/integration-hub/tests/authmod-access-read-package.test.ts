import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeReadPackage, encodeReadPackage } from "@fika/server-shared/read-package";
import { validateAuthmodAccessReadPackage } from "../lib/authmod-access-read-package";

const identity = { id: "identity:1", displayName: "Test User", identityKind: "person" as const, identityLinkStatus: "matched" as const, status: "active" as const, fullAccess: false, provenance: "test" as never, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", version: 1 };
const value = { identity, appAssignments: [], siteAssignments: [], authorityGrants: [], delegations: [], custodians: [], securityVersion: 10 };

test("AUTHMOD access package is immutable, scoped and gzip-integrity checked", () => {
  const encoded = encodeReadPackage("integration-hub/authmod-access", 2, value, 1, { contractVersion: "integration-hub.authmod-access.v1", sourceVersion: "authmod-security:10", scope: identity.id });
  assert.equal(decodeReadPackage<typeof value>(encoded.manifest, encoded.bytes).securityVersion, 10);
  const corrupt = Uint8Array.from(encoded.bytes); corrupt[0] ^= 255;
  assert.throws(() => decodeReadPackage(encoded.manifest, corrupt), /integrity check/);
  assert.equal(validateAuthmodAccessReadPackage(value).identity.id, identity.id);
  assert.throws(() => validateAuthmodAccessReadPackage({ ...value, securityVersion: -1 }), /invalid/);
});

test("security head invalidation is explicit in the Firestore repository", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../lib/authmod-core/firestore-repository.ts", import.meta.url), "utf8");
  assert.match(source, /bumpAuthmodAccessHead/);
  assert.match(source, /invalidateAuthmodAdmissionCache/);
  assert.match(source, /await bootstrapAuthmodAccessPackage/);
});

test("missing packages bootstrap once, while stale packages fail closed", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../lib/authmod-access-read-package.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!result\)/);
  assert.match(source, /bootstrapAuthmodAccessPackage\(identityId\)/);
  assert.match(source, /AUTHMOD_ACCESS_PACKAGE_STALE/);
  assert.doesNotMatch(source, /listAuthorityGrants|listAppAssignments|listSiteAssignments|listDelegations/);
  assert.match(source, /inFlight/);
});

test("bulk bootstrap is governed and active-identity scoped", async () => {
  const route = await (await import("node:fs/promises")).readFile(new URL("../app/api/read-packages/rebuild/route.ts", import.meta.url), "utf8");
  const source = await (await import("node:fs/promises")).readFile(new URL("../lib/authmod-access-read-package.ts", import.meta.url), "utf8");
  assert.match(route, /authmod-access-active/);
  assert.match(route, /integration-admin/);
  assert.match(source, /where\("status", "==", "active"\)/);
});
