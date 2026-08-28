import { requireFikaSession, type FikaSessionPrincipal } from "@hub/lib/fika-session";
import { FirestoreAuthModRepository } from "@hub/lib/authmod-core/firestore-repository";
import { requireAppAccess } from "@hub/lib/authmod-core/evaluator";
import type { AuthPrincipal } from "@hub/lib/authmod-core/model";
import { logAuthDiagnostic } from "../../../shared/auth-diagnostics";

export const localLogisticsPrincipal: AuthPrincipal = {
  type: "interactive",
  id: "local-logistics",
  displayName: "Logistics operator (local)",
  email: "logistics@local.fika",
  identityKind: "person",
};

type LogisticsRequest = { cookies: { get(name: string): { value?: string } | undefined }; headers?: { get(name: string): string | null } };
type AuthDependencies = {
  sessionReader?: (request: LogisticsRequest) => Promise<FikaSessionPrincipal>;
  accessChecker?: (principal: AuthPrincipal) => Promise<unknown>;
  allowLocalFallback?: boolean;
};

export async function requireLogisticsAccess(request: LogisticsRequest, dependencies: AuthDependencies = {}) {
  try {
    logAuthDiagnostic(request, { authStage: "logistics-route-session-start", status: 200, code: "LOGISTICS_SESSION_CHECK_STARTED" });
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
    logAuthDiagnostic(request, { authStage: "logistics-route-app-access", status: 200, code: "LOGISTICS_ACCESS_ALLOWED" });
    return principal;
  } catch (error) {
    const status = (error as { status?: number }).status || 500;
    logAuthDiagnostic(request, { authStage: "logistics-route-auth-failure", status, code: (error as { code?: string }).code || "LOGISTICS_AUTH_FAILURE" });
    const allowLocalFallback = dependencies.allowLocalFallback ?? ((process.env.FIKA_RUNTIME_MODE || "local") === "local" && process.env.NODE_ENV !== "production");
    if (allowLocalFallback && (error as { status?: number }).status === 401) return localLogisticsPrincipal;
    throw error;
  }
}
