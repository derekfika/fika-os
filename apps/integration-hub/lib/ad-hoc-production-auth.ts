import type { NextRequest } from "next/server";
import type { Actor } from "@/lib/auth";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { createAuthModEvaluationContext, resolveUserAccess } from "@/lib/authmod-core/evaluator";
import { requireFikaSession } from "@/lib/fika-session";
import { filterAuthorizedOplocs, resolvePermittedOplocIds } from "@/lib/oploc-authorization";
import { getOplocReadPackage, validateOplocReadPackage } from "@/lib/oploc-read-package";
import { internalProductionRequestAllowed } from "@/lib/production-internal-auth";
import type { AdHocAccess, AdHocOploc } from "../../shared/ad-hoc-production-contract";

const APP_ID = "ad-hoc-production";

/**
 * The unauthenticated local-development identity is possible only for a local,
 * non-production, non-hosted Hub. Staging and production always require a real
 * session, so no configuration of the caller can activate it there.
 */
export function localAdHocServiceAllowed(env: Record<string, string | undefined> = process.env) {
  if (env.NODE_ENV === "production") return false;
  if ((env.FIKA_RUNTIME_MODE || "local") !== "local") return false;
  if (env.K_SERVICE || env.FUNCTION_TARGET || env.FIREBASE_CONFIG || env.GAE_ENV) return false;
  return true;
}

export type AdHocCaller = { actor: Actor; access: AdHocAccess };

const isActive = (oploc: { lifecycleStatus?: string }) => !oploc.lifecycleStatus || oploc.lifecycleStatus.toLowerCase() === "active";

async function authorisedOplocs(scope: Awaited<ReturnType<typeof resolvePermittedOplocIds>> | "all") {
  const value = validateOplocReadPackage((await getOplocReadPackage()).value);
  const filtered = scope === "all" ? value : filterAuthorizedOplocs(value, scope);
  return { oplocs: filtered.oplocs.filter(isActive) as AdHocOploc[], ...(filtered.redirects && Object.keys(filtered.redirects).length ? { redirects: filtered.redirects } : {}) };
}

/**
 * Admits a caller: a real FIKA session whose AUTHMOD identity has Ad-Hoc
 * Production access, scoped to the OPLOCs it may use. Login alone is not enough.
 */
export async function adHocCaller(request: NextRequest): Promise<AdHocCaller> {
  let session;
  try { session = await requireFikaSession(request); }
  catch (error) {
    if ((error as { status?: number }).status === 401 && localAdHocServiceAllowed()) {
      const local = { id: "local-ad-hoc", displayName: "Operations user (local)" };
      return { actor: { uid: local.id, name: local.displayName, role: "reviewer", synthetic: true }, access: { principal: local, ...(await authorisedOplocs("all")) } };
    }
    throw error;
  }
  const repository = new FirestoreAuthModRepository();
  const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
  const context = createAuthModEvaluationContext(repository, principal);
  const app = await resolveUserAccess(repository, { principal, appId: APP_ID }, context);
  if (!app.allowed) throw Object.assign(new Error("Your account does not currently have Ad-Hoc Production access."), { status: app.reasonCode === "store-unavailable" ? 503 : 403 });
  const scope = await resolvePermittedOplocIds({ repository, principal, appId: APP_ID });
  return {
    actor: { uid: principal.id, name: principal.displayName, ...(principal.email ? { email: principal.email } : {}), role: "reviewer", synthetic: false },
    access: { principal: { id: principal.id, displayName: principal.displayName, email: principal.email }, ...(await authorisedOplocs(scope)) },
  };
}

/** Privileged order operations additionally require the calling service's shared token (fail closed). */
export function requireAdHocService(request: Pick<NextRequest, "headers">) {
  if (!internalProductionRequestAllowed(request)) throw Object.assign(new Error("Ad-Hoc Production service authentication is required."), { status: 403, code: "AD_HOC_SERVICE_AUTH" });
}
