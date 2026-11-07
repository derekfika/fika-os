import { getFikaRuntimeConfig } from "@fika/server-shared/runtime-config";

export type BeverageAction = "View" | "Contribute" | "Manage" | "Approve";
export type BeverageActor = {
  authmodIdentityId: string;
  identityKind: "person";
  displayName: "Fictional Beverage local test actor";
  action: BeverageAction;
  scopeOplocIds: readonly string[];
  synthetic: true;
};

function localRuntime() {
  const env = {
    ...process.env,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || "demo-fika-os",
    // Beverage uses its own emulator port so it cannot silently attach to another app's test store.
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8294",
  };
  const runtime = getFikaRuntimeConfig(env);
  if (runtime.mode !== "local") throw Object.assign(new Error("Beverage Stage B storage is available only in explicit local development mode."), { status: 503, code: "BEVERAGE_LOCAL_RUNTIME_REQUIRED" });
  if (process.env.NODE_ENV === "production") throw Object.assign(new Error("Beverage local storage cannot run in a production build."), { status: 503, code: "BEVERAGE_PRODUCTION_RUNTIME_DISABLED" });
  if (runtime.projectId !== "demo-fika-os" && runtime.projectId !== "fika-os-local") throw Object.assign(new Error("Beverage local storage requires an approved demo Firebase project."), { status: 503, code: "BEVERAGE_UNSAFE_PROJECT" });
  return runtime;
}

export function beverageFirestoreHost() {
  return localRuntime().firestoreHost;
}

export function requireLocalBeverageActor(request: Request, action: BeverageAction, oplocId?: string): BeverageActor {
  localRuntime();
  const host = new URL(request.url).hostname.toLowerCase();
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") throw Object.assign(new Error("Beverage Stage B accepts requests from a local browser only."), { status: 403, code: "BEVERAGE_LOCAL_REQUEST_REQUIRED" });
  if (process.env.FIKA_BEVERAGE_LOCAL_AUTH !== "fixture") throw Object.assign(new Error("Enable the explicit local AUTHMOD fixture adapter to use Beverage."), { status: 503, code: "BEVERAGE_LOCAL_AUTH_DISABLED" });

  const actorId = process.env.FIKA_BEVERAGE_LOCAL_ACTOR_ID?.trim() || "fixture:beverage-local-operator";
  if (!/^fixture:[a-z0-9:_-]{3,120}$/.test(actorId)) throw Object.assign(new Error("The local Beverage actor must be a fictional fixture identity."), { status: 503, code: "BEVERAGE_LOCAL_ACTOR_INVALID" });
  const actions = new Set((process.env.FIKA_BEVERAGE_LOCAL_AUTH_ACTIONS || "View,Contribute,Manage,Approve").split(",").map(value => value.trim()).filter(Boolean));
  if (!actions.has(action)) throw Object.assign(new Error("The local AUTHMOD fixture does not grant this Beverage action."), { status: 403, code: "AUTHMOD_DENIED" });
  const scopes = (process.env.FIKA_BEVERAGE_LOCAL_OPLOC_IDS || "fixture-oploc:munich,fixture-oploc:frankfurt,fixture-oploc:london,fixture-oploc:amsterdam").split(",").map(value => value.trim()).filter(Boolean);
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
