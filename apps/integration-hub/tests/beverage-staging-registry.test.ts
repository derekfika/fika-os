import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveBeverageRegistryOperator } from "../lib/beverage-staging-registry";

test("registry provisioning binds verified Google ADC identity to the existing Firebase Google subject", () => {
  const google = { email: "Operator@example.test", email_verified: true, sub: "fixture-google-subject" };
  const firebase = {
    uid: "fixture-firebase-uid", email: "operator@example.test", emailVerified: true, disabled: false,
    providerData: [{ providerId: "google.com", uid: google.sub, email: "operator@example.test" }],
  };
  assert.deepEqual(resolveBeverageRegistryOperator(google, firebase), { uid: firebase.uid, email: firebase.email });
  assert.throws(() => resolveBeverageRegistryOperator({ ...google, email_verified: false }, firebase), /AUTHMOD Administer/);
  assert.throws(() => resolveBeverageRegistryOperator({ ...google, sub: "different-google-subject" }, firebase), /AUTHMOD Administer/);
  assert.throws(() => resolveBeverageRegistryOperator(google, { ...firebase, disabled: true }), /AUTHMOD Administer/);
  assert.throws(() => resolveBeverageRegistryOperator(google, { ...firebase, providerData: [] }), /AUTHMOD Administer/);
  assert.throws(() => resolveBeverageRegistryOperator(google, { ...firebase, providerData: [...firebase.providerData, ...firebase.providerData] }), /AUTHMOD Administer/);
});
