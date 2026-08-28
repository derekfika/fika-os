import { requireFikaSession, type FikaSessionPrincipal } from "@hub/lib/fika-session";
import { FirestoreAuthModRepository } from "@hub/lib/authmod-core/firestore-repository";
import { requireAppAccess } from "@hub/lib/authmod-core/evaluator";
import type { AuthPrincipal } from "@hub/lib/authmod-core/model";

export const localLogisticsPrincipal: AuthPrincipal = {
  type: "interactive",
  id: "local-logistics",
  displayName: "Logistics operator (local)",
  email: "logistics@local.fika",
  identityKind: "person",
};

type LogisticsRequest = { cookies: { get(name: string): { value?: string } | undefined } };
type AuthDependencies = {
  sessionReader?: (request: LogisticsRequest) => Promise<FikaSessionPrincipal>;
  accessChecker?: (principal: AuthPrincipal) => Promise<unknown>;
  allowLocalFallback?: boolean;
};

export async function requireLogisticsAccess(request: LogisticsRequest, dependencies: AuthDependencies = {}) {
  try {
    const session = await (dependencies.sessionReader || requireFikaSession)(request);
    const principal: AuthPrincipal = {
      type: "interactive",
      id: session.authmodIdentityId,
      displayName: session.displayName,
      email: session.email,
      identityKind: session.identityKind,
      ...(session.representedOplocId ? { representedOplocId: session.representedOplocId } : {}),
    };
    await (dependencies.accessChecker || ((value: AuthPrincipal) => requireAppAccess(new FirestoreAuthModRepository(), { principal: value, appId: "logistics" })))(principal);
    return principal;
  } catch (error) {
    const allowLocalFallback = dependencies.allowLocalFallback ?? ((process.env.FIKA_RUNTIME_MODE || "local") === "local" && process.env.NODE_ENV !== "production");
    if (allowLocalFallback && (error as { status?: number }).status === 401) return localLogisticsPrincipal;
    throw error;
  }
}
