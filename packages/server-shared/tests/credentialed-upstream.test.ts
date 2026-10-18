import assert from "node:assert/strict";
import test from "node:test";
import { approvedCredentialedUpstream, CredentialedUpstreamError } from "../src/credentialed-upstream";

const prodHub = "https://fika-os-prod-hub--fika-os.europe-west4.hosted.app";
const stagingHub = "https://staging-os.fikacatering.com";

test("production accepts only the approved production origins for the named service", () => {
  assert.equal(approvedCredentialedUpstream("hub", `${prodHub}/`, "production"), prodHub);
  assert.equal(approvedCredentialedUpstream("hub", "https://os.fikacatering.com", "production"), "https://os.fikacatering.com");
  assert.equal(approvedCredentialedUpstream("delivered-in", "https://delivered-in.fikacatering.com", "production"), "https://delivered-in.fikacatering.com");
  for (const rejected of [stagingHub, "https://hospitality-staging.fikacatering.com", "http://localhost:3200", "https://evil.example", `${prodHub}.evil.example`]) {
    assert.throws(() => approvedCredentialedUpstream("hub", rejected, "production"), CredentialedUpstreamError, rejected);
  }
});

test("production rejects a production origin supplied for the wrong service", () => {
  assert.throws(() => approvedCredentialedUpstream("hub", "https://fika-os-prod-cpu--fika-os.europe-west4.hosted.app", "production"), /not the approved production service/);
});

test("production rejects insecure, credentialed or decorated upstream URLs", () => {
  for (const rejected of [
    prodHub.replace("https:", "http:"),
    prodHub.replace("https://", "https://user:secret@"),
    `${prodHub}?next=https://evil.example`,
    `${prodHub}#fragment`,
    "not a url",
  ]) {
    assert.throws(() => approvedCredentialedUpstream("hub", rejected, "production"), CredentialedUpstreamError, rejected);
  }
});

test("staging may use staging services but never forwards to a production origin", () => {
  assert.equal(approvedCredentialedUpstream("hub", stagingHub, "staging"), stagingHub);
  assert.equal(approvedCredentialedUpstream("cpu", "https://cpu-staging.fikacatering.com/", "staging"), "https://cpu-staging.fikacatering.com");
  assert.throws(() => approvedCredentialedUpstream("hub", prodHub, "staging"), /resolves to a production service/);
  assert.throws(() => approvedCredentialedUpstream("hub", "https://os.fikacatering.com", "staging"), /resolves to a production service/);
  assert.throws(() => approvedCredentialedUpstream("menu", "https://fika-os-prod-menu--fika-os.europe-west4.hosted.app", "staging"), CredentialedUpstreamError);
});

test("local runtime keeps loopback and developer URLs usable", () => {
  assert.equal(approvedCredentialedUpstream("hub", "http://localhost:3200/", "local"), "http://localhost:3200");
  assert.equal(approvedCredentialedUpstream("hub", "http://127.0.0.1:3200", undefined), "http://127.0.0.1:3200");
});

test("rejections never echo the configured URL (it may carry embedded credentials)", () => {
  try { approvedCredentialedUpstream("hub", "https://user:topsecret@evil.example/", "production"); assert.fail("expected rejection"); }
  catch (error) { assert.ok(error instanceof CredentialedUpstreamError); assert.doesNotMatch(error.message, /topsecret|evil\.example/); }
});
