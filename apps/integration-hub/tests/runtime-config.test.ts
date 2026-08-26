import assert from "node:assert/strict";
import test from "node:test";
import { getFikaRuntimeConfig, hasFirebaseClientConfig } from "../lib/runtime-config";

const base = {
  FIREBASE_PROJECT_ID: "fika-os-local",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:8085",
};

test("local runtime defaults to the Auth and Firestore emulators", () => {
  const runtime = getFikaRuntimeConfig(base);
  assert.equal(runtime.authMode, "emulator");
  assert.equal(runtime.authProjectId, "fika-os-local");
  assert.equal(runtime.authHost, "127.0.0.1:9099");
  assert.equal(runtime.secureCookies, false);
});

test("local Workspace Auth is opt-in and keeps Firestore local", () => {
  const runtime = getFikaRuntimeConfig({
    ...base,
    FIKA_LOCAL_GOOGLE_AUTH: "true",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "fika-os-staging",
  });
  assert.equal(runtime.authMode, "cloud");
  assert.equal(runtime.authProjectId, "fika-os-staging");
  assert.equal(runtime.firestoreHost, "127.0.0.1:8085");
  assert.equal(runtime.authHost, undefined);
  assert.equal(runtime.secureCookies, false);
});

test("local Workspace Auth cannot be combined with the Auth emulator", () => {
  assert.throws(() => getFikaRuntimeConfig({
    ...base,
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    FIKA_LOCAL_GOOGLE_AUTH: "true",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "fika-os-staging",
  }), /cannot be used with the Firebase Auth emulator/);
});

test("browser Firebase configuration is complete only when every public field exists", () => {
  assert.equal(hasFirebaseClientConfig({
    NEXT_PUBLIC_FIREBASE_API_KEY: "public-key",
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "fika-os-staging.firebaseapp.com",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "fika-os-staging",
    NEXT_PUBLIC_FIREBASE_APP_ID: "app-id",
  }), true);
  assert.equal(hasFirebaseClientConfig({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: "fika-os-staging" }), false);
});

test("Firebase Admin can be imported repeatedly without reapplying Firestore settings", async () => {
  const first = await import("../lib/firebase-admin");
  const repeatedModule = "../lib/firebase-admin?repeat=1";
  const second = await import(repeatedModule);
  assert.equal(first.db, second.db);
  assert.equal(first.auth, second.auth);
});
