import assert from "node:assert/strict";
import test from "node:test";
import { containArtifactLinks } from "../lib/artifact-containment";

test("response containment suppresses nested stored Drive and local links without altering signed evidence", () => {
  const original = { status: "signed", cpuReview: { drivePdfUrl: "/api/review?download=pdf", signatures: [{ actor: "chef" }] }, siteMenu: { artifact: { driveFileId: "prod-id", driveUrl: "https://drive.google.com/file/d/prod", status: "ready" } }, packet: { pdf: { url: "https://drive.google.com/file/d/prod", fileId: "prod-id", sha256: "hash" } } };
  const snapshot = structuredClone(original);
  const safe = containArtifactLinks(original, true);
  assert.equal(safe.cpuReview.drivePdfUrl, undefined);
  assert.equal(safe.siteMenu.artifact.driveFileId, undefined);
  assert.equal(safe.packet.pdf.url, undefined);
  assert.equal(safe.packet.pdf.fileId, undefined);
  assert.equal(safe.packet.pdf.sha256, "hash");
  assert.equal(safe.status, "signed");
  assert.deepEqual(original, snapshot);
  assert.equal(containArtifactLinks(original, false), original);
});
