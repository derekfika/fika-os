import type { NextRequest } from "next/server";
import type { Actor } from "@/lib/auth";
import { FirestoreAuthModRepository } from "@/lib/authmod-core";
import { createAuthModEvaluationContext, resolveUserAccess } from "@/lib/authmod-core/evaluator";
import { requireFikaSession } from "@/lib/fika-session";
import { filterAuthorizedOplocs, resolvePermittedOplocIds } from "@/lib/oploc-authorization";
import { getOplocReadPackage, validateOplocReadPackage } from "@/lib/oploc-read-package";
import { internalProductionRequestAllowed } from "@/lib/production-internal-auth";
import { adHocOneOffDestinationId, adHocSendKey, type AdHocAccess, type AdHocOploc, type AdHocOrderInput, type AdHocSendCommand } from "../../shared/ad-hoc-production-contract";

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

export type AdHocOplocScope = { oplocs: AdHocOploc[]; redirects?: Record<string, string> };
export type AdHocCaller = { actor: Actor; principal: AdHocAccess["principal"]; loadOplocs: () => Promise<AdHocOplocScope> };

const isActive = (oploc: { lifecycleStatus?: string }) => !oploc.lifecycleStatus || oploc.lifecycleStatus.toLowerCase() === "active";

async function authorisedOplocs(scope: Awaited<ReturnType<typeof resolvePermittedOplocIds>> | "all"): Promise<AdHocOplocScope> {
  const value = validateOplocReadPackage((await getOplocReadPackage()).value);
  const filtered = scope === "all" ? value : filterAuthorizedOplocs(value, scope);
  return { oplocs: filtered.oplocs.filter(isActive) as AdHocOploc[], ...(filtered.redirects && Object.keys(filtered.redirects).length ? { redirects: filtered.redirects } : {}) };
}

/**
 * Admits a caller: a real FIKA session whose AUTHMOD identity has Ad-Hoc
 * Production access. Login alone is not enough. The OPLOC scope is resolved
 * lazily, only for operations that need destinations.
 */
export async function adHocCaller(request: NextRequest): Promise<AdHocCaller> {
  let session;
  try { session = await requireFikaSession(request); }
  catch (error) {
    if ((error as { status?: number }).status === 401 && localAdHocServiceAllowed()) {
      const principal = { id: "local-ad-hoc", displayName: "Operations user (local)" };
      return { actor: { uid: principal.id, name: principal.displayName, role: "reviewer", synthetic: true }, principal, loadOplocs: () => authorisedOplocs("all") };
    }
    throw error;
  }
  const repository = new FirestoreAuthModRepository();
  const principal = { type: "interactive" as const, id: session.authmodIdentityId, displayName: session.displayName, email: session.email, identityKind: session.identityKind };
  const context = createAuthModEvaluationContext(repository, principal);
  const app = await resolveUserAccess(repository, { principal, appId: APP_ID }, context);
  if (!app.allowed) throw Object.assign(new Error("Your account does not currently have Ad-Hoc Production access."), { status: app.reasonCode === "store-unavailable" ? 503 : 403 });
  return {
    actor: { uid: principal.id, name: principal.displayName, ...(principal.email ? { email: principal.email } : {}), role: "reviewer", synthetic: false },
    principal: { id: principal.id, displayName: principal.displayName, email: principal.email },
    loadOplocs: async () => authorisedOplocs(await resolvePermittedOplocIds({ repository, principal, appId: APP_ID })),
  };
}

/**
 * The Hub is the authority for the destination. An OPLOC must be one the caller
 * may use (aliases resolved through Hub redirects) and its label comes from Hub
 * authority, not the caller. A one-off destination must carry exactly the
 * request-scoped identity, so a forged OPLOC-looking id can never pose as one.
 */
export function authoriseAdHocDestination(command: AdHocSendCommand, scope: AdHocOplocScope | undefined): { order: AdHocOrderInput; destination: { oplocId?: string; label: string; address?: string } } {
  const reject = (message: string, code = "AD_HOC_INVALID_ORDER") => Object.assign(new Error(message), { status: 422, code });
  const { order, requestId } = command;
  if (order.sourceEntityId !== requestId) throw reject("The order does not belong to this request.");
  if (order.sourceVersion !== command.requestVersion) throw reject("The order version does not match the request version.");
  if (command.idempotencyKey !== adHocSendKey(requestId, command.requestVersion)) throw reject("The idempotency key does not match the request version.");
  const oneOffId = adHocOneOffDestinationId(requestId);
  if (order.destinationAddress) {
    if (order.destinationOplocId !== oneOffId || order.destinationAddress.identity !== oneOffId) throw reject("A one-off destination must use the request-scoped identity.");
    return { order, destination: { label: order.destinationAddress.label, address: order.destinationAddress.address } };
  }
  if (order.destinationOplocId.startsWith("adhoc-destination:")) throw reject("A one-off destination requires an address snapshot.");
  const canonicalId = scope?.redirects?.[order.destinationOplocId] || order.destinationOplocId;
  const oploc = scope?.oplocs.find(candidate => candidate.canonicalId === canonicalId);
  if (!oploc) throw reject("That destination is not an active OPLOC you are authorised to use.", "AD_HOC_DESTINATION_NOT_AUTHORISED");
  return { order: { ...order, destinationOplocId: oploc.canonicalId, deliveryLocation: oploc.label }, destination: { oplocId: oploc.canonicalId, label: oploc.label, ...(oploc.address ? { address: oploc.address } : {}) } };
}

/** Privileged order operations additionally require the calling service's shared token (fail closed). */
export function requireAdHocService(request: Pick<NextRequest, "headers">) {
  if (!internalProductionRequestAllowed(request)) throw Object.assign(new Error("Ad-Hoc Production service authentication is required."), { status: 403, code: "AD_HOC_SERVICE_AUTH" });
}
