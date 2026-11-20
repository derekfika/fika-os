import assert from "node:assert/strict";
import test from "node:test";
import { deliverStudioPublication, readStudioPublicationPilot } from "../lib/hub-publication";
import { assertStudioDraftCommand } from "../lib/runtime";
import { studioPublicationAudience, studioReviewStaging } from "../../shared/hospitality-menu-studio-staging";

const pilot = { publish: true, activateSeasonal: false, activateCollection: false,
  oplocId: "oploc:fixture", menuId: "menu:fixture", firstDate: "2026-12-01", lastDate: "2027-01-15", generation: 0 };
const manifest = { id: "publication-fixture-v1", menuId: pilot.menuId, menuName: "Fictional menu", revision: 1,
  effectiveDate: pilot.firstDate, sourceDraftVersion: 1, scope: {}, contentHash: "a".repeat(64),
  publishedAt: "2026-11-20T12:00:00Z", publishedBy: "synthetic-publisher" };

test("Hub publication scope is pinned and independent of ordinary Studio authoring", async () => {
  const verified = await readStudioPublicationPilot("staging=fictional", async (input, init) => {
    assert.equal(input, studioPublicationAudience);
    assert.equal(new Headers(init?.headers).get("cookie"), "staging=fictional");
    return Response.json(pilot);
  });
  assert.deepEqual(verified, pilot);
  assert.equal(await readStudioPublicationPilot("unused", async () => Response.json({ publish: true })), undefined);
  assert.throws(() => assertStudioDraftCommand("publish", true), { code: "STUDIO_WRITE_DENIED" });
  assert.doesNotThrow(() => assertStudioDraftCommand("publish", true, true));
  assert.throws(() => assertStudioDraftCommand("activate-collection", true, true), { code: "STUDIO_WRITE_DENIED" });
});

test("delivery preserves bytes and requires Hub's matching id and hash receipt", async () => {
  const claims = { email: studioReviewStaging.studioIdentity.email, sub: studioReviewStaging.studioIdentity.subject,
    email_verified: true, aud: studioPublicationAudience, exp: 4_000_000_000, iss: "https://accounts.google.com" };
  const metadata = `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.fixture`;
  const send = (hash: string) => deliverStudioPublication(manifest, "exact-package-bytes", async (input, init) => {
    const url = new URL(String(input));
    if (url.hostname === "metadata.google.internal") {
      assert.equal(url.searchParams.get("audience"), studioPublicationAudience);
      return new Response(metadata, { headers: { "Metadata-Flavor": "Google" } });
    }
    assert.equal(url.toString(), studioPublicationAudience);
    assert.equal(new Headers(init?.headers).has("cookie"), false);
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${metadata}`);
    assert.deepEqual(JSON.parse(String(init?.body)), { manifest, body: "exact-package-bytes" });
    return Response.json({ publicationId: manifest.id, contentHash: hash });
  });
  await send(manifest.contentHash);
  await assert.rejects(send("b".repeat(64)), { code: "STUDIO_PUBLICATION_DELIVERY_PENDING" });
});
