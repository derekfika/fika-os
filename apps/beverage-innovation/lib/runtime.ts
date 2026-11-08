import { getFikaRuntimeConfig } from "@fika/server-shared/runtime-config";

const BEVERAGE_ACTIONS = ["View", "Contribute", "Manage", "Approve"] as const;
const fixtureOplocId = /^fixture-oploc:[a-z0-9][a-z0-9:_-]{0,120}$/;
export type BeverageAction = (typeof BEVERAGE_ACTIONS)[number];
export type BeverageActor = {
  authmodIdentityId: string;
  identityKind: "person";
  displayName: "Fictional Beverage local test actor";
  action: BeverageAction;
  scopeOplocIds: readonly string[];
  synthetic: true;
};

function localRuntime() {
  if (process.env.FIKA_RUNTIME_MODE !== "local") throw Object.assign(new Error("Beverage Stage B storage is available only in explicit local development mode."), { status: 503, code: "BEVERAGE_LOCAL_RUNTIME_REQUIRED" });
  if (process.env.NODE_ENV === "production") throw Object.assign(new Error("Beverage local storage cannot run in a production build."), { status: 503, code: "BEVERAGE_PRODUCTION_RUNTIME_DISABLED" });
  if (process.env.FIKA_BEVERAGE_LOCAL_AUTH !== "fixture") throw Object.assign(new Error("Enable the explicit local AUTHMOD fixture adapter to use Beverage."), { status: 503, code: "BEVERAGE_LOCAL_AUTH_DISABLED" });
  const env = {
    ...process.env,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || "demo-fika-os",
    // Beverage uses its own emulator port so it cannot silently attach to another app's test store.
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8294",
  };
  const runtime = getFikaRuntimeConfig(env);
  if (runtime.projectId !== "demo-fika-os" && runtime.projectId !== "fika-os-local") throw Object.assign(new Error("Beverage local storage requires an approved demo Firebase project."), { status: 503, code: "BEVERAGE_UNSAFE_PROJECT" });
  if (runtime.authMode !== "emulator") throw Object.assign(new Error("Beverage fixture access requires emulator Auth configuration."), { status: 503, code: "BEVERAGE_LOCAL_AUTH_EMULATOR_REQUIRED" });
  return runtime;
}

export function beverageFirestoreHost() {
  return localRuntime().firestoreHost;
}

export function requireLocalBeverageActor(request: Request, action: BeverageAction, oplocId?: string): BeverageActor {
  localRuntime();
  const host = new URL(request.url).hostname.toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") throw Object.assign(new Error("Beverage Stage B accepts requests from a local browser only."), { status: 403, code: "BEVERAGE_LOCAL_REQUEST_REQUIRED" });
  const actorId = process.env.FIKA_BEVERAGE_LOCAL_ACTOR_ID?.trim() || "fixture:beverage-local-operator";
  if (!/^fixture:[a-z0-9:_-]{3,120}$/.test(actorId)) throw Object.assign(new Error("The local Beverage actor must be a fictional fixture identity."), { status: 503, code: "BEVERAGE_LOCAL_ACTOR_INVALID" });
  const actions = new Set((process.env.FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS || "").split(",").map(value => value.trim()).filter(Boolean));
  if ([...actions].some(value => !BEVERAGE_ACTIONS.some(action => action === value))) throw Object.assign(new Error("Use only registered Beverage fixture actions."), { status: 503, code: "BEVERAGE_LOCAL_ACTIONS_INVALID" });
  if (!actions.has(action)) throw Object.assign(new Error("The local AUTHMOD fixture does not grant this Beverage action."), { status: 403, code: "AUTHMOD_DENIED" });
  const scopes = [...new Set((process.env.FIKA_BEVERAGE_LOCAL_OPLOC_IDS || "").split(",").map(value => value.trim()).filter(Boolean))];
  if (scopes.some(value => !fixtureOplocId.test(value))) throw Object.assign(new Error("Use only fictional fixture OPLOC identifiers."), { status: 503, code: "BEVERAGE_LOCAL_SCOPE_INVALID" });
  if (oplocId && !scopes.includes(oplocId)) throw Object.assign(new Error("The local AUTHMOD fixture does not grant the requested fixture OPLOC."), { status: 403, code: "AUTHMOD_OPLOC_DENIED" });
  return { authmodIdentityId: actorId, identityKind: "person", displayName: "Fictional Beverage local test actor", action, scopeOplocIds: scopes, synthetic: true };
}

export function beverageError(error: unknown) {
  const value = error as { status?: number; code?: string | number; message?: unknown; name?: string };
  if (value?.name === "ZodError") return { status: 400, body: { error: { code: "BEVERAGE_REQUEST_INVALID", message: "Review the supplied Beverage fields and try again." } } };
  const code = String(value?.code || "");
  const unavailable = /^(14|UNAVAILABLE|DEADLINE_EXCEEDED|ECONNREFUSED|ETIMEDOUT)$/i.test(code) || (typeof value?.message === "string" && /UNAVAILABLE:|ECONNREFUSED|deadline exceeded/i.test(value.message));
  const status = Number.isInteger(value?.status) ? value.status! : unavailable ? 503 : 422;
  const message = unavailable ? "The isolated Beverage local service is unavailable. Check the loopback emulator and retry." : typeof value?.message === "string" ? value.message : "Unable to complete the Beverage request.";
  return { status, body: { error: { code: value?.status ? code || "BEVERAGE_REQUEST_FAILED" : unavailable ? "BEVERAGE_LOCAL_SERVICE_UNAVAILABLE" : code || "BEVERAGE_REQUEST_FAILED", message } } };
}
