import { logAuthDiagnostic } from "../../../shared/auth-diagnostics";
import { hostedRuntime, requiredUpstreamUrl } from "./runtime";
import { MOBILE_SESSION_COOKIE, verifyMobilePinSession, type MobileVehicleId } from "./mobile-pin-session";

export type LogisticsPrincipal = {
  type: "interactive";
  id: string;
  authmodIdentityId?: string;
  displayName: string;
  email?: string;
  identityKind?: "person" | "operational";
  representedOplocId?: string;
  primaryCustodianLegendId?: string;
  permittedVehicleIds?: string[];
  maintenanceAuthorities?: string[];
  sessionKind?: "hub" | "mobile-pin";
};
export type FikaSessionPrincipal = Omit<LogisticsPrincipal, "type" | "id"> & { firebaseUid: string; authmodIdentityId: string };

export const localLogisticsPrincipal: LogisticsPrincipal = {
  type: "interactive",
  id: "local-logistics",
  displayName: "Logistics operator (local)",
  email: "logistics@local.fika",
  identityKind: "person",
  permittedVehicleIds: ["van1", "van2"], // Explicit development-only principal.
};
export function logisticsCacheScope(principal: { id: string; identityKind?: string; representedOplocId?: string; primaryCustodianLegendId?: string; permittedVehicleIds?: string[] }) {
  return `logistics:v2:${principal.id}:${principal.identityKind || "unknown"}:${principal.representedOplocId || "organisation"}:${principal.primaryCustodianLegendId || "none"}:${[...(principal.permittedVehicleIds || [])].sort().join(",")}`;
}

type LogisticsRequest = { method?: string; url?: string; cookies: { get(name: string): { value?: string } | undefined }; headers?: { get(name: string): string | null }; nextUrl?: { pathname?: string; searchParams: { get(name: string): string | null } } };
type AuthDependencies = {
  sessionReader?: (request: LogisticsRequest) => Promise<FikaSessionPrincipal>;
  accessChecker?: (principal: LogisticsPrincipal) => Promise<unknown>;
  allowLocalFallback?: boolean;
  mobileSessionReader?: (request: LogisticsRequest) => Promise<{ vehicleId: MobileVehicleId; sessionId: string } | undefined>;
};

const MOBILE_DRIVER_ACTIONS = new Set([
  "arrive-stop", "mark-stop-loaded", "mark-subload-loaded", "mark-subload-delivered",
  "mark-subload-collected", "complete-stop", "undo-completion", "report-issue",
  "resolve-issue", "defer-collection", "dispatch-run", "confirm-returned-to-cpu",
]);
export function assertMobilePinAction(action: string) {
  if (!MOBILE_DRIVER_ACTIONS.has(action)) throw Object.assign(new Error("Vehicle PIN sessions cannot perform planner operations."), { status: 403, code: "LOGISTICS_MOBILE_ACTION_DENIED" });
}

export async function requireLogisticsAccess(request: LogisticsRequest, dependencies: AuthDependencies = {}) {
  if (request.headers?.get("x-fika-logistics-mobile-request") === "1") return requireMobilePinAccess(request, dependencies);
  try {
    logAuthDiagnostic(request, { authStage: "logistics-route-session-start", status: 200, code: "LOGISTICS_SESSION_CHECK_STARTED" });
    const session = await (dependencies.sessionReader || requireHubLogisticsSession)(request);
    const principal: LogisticsPrincipal = {
      type: "interactive",
      id: session.authmodIdentityId,
      sessionKind: "hub",
      displayName: session.displayName,
      email: session.email,
      identityKind: session.identityKind,
      ...(session.representedOplocId ? { representedOplocId: session.representedOplocId } : {}),
      ...(session.primaryCustodianLegendId ? { primaryCustodianLegendId: session.primaryCustodianLegendId } : {}),
      ...(session.permittedVehicleIds ? { permittedVehicleIds: session.permittedVehicleIds } : {}),
      ...(session.maintenanceAuthorities ? { maintenanceAuthorities: session.maintenanceAuthorities } : {}),
    };
    await (dependencies.accessChecker || (async () => undefined))(principal);
    const requestedVehicle = request.nextUrl?.searchParams.get("vehicle");
    if (requestedVehicle && !principal.permittedVehicleIds?.includes(requestedVehicle)) throw Object.assign(new Error("This account is not entitled to the requested Logistics vehicle."), { status: 403, code: "AUTHMOD_VEHICLE_DENIED" });
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

async function requireMobilePinAccess(request: LogisticsRequest, dependencies: AuthDependencies): Promise<LogisticsPrincipal> {
  const pathname = request.nextUrl?.pathname || new URL(request.url || "https://logistics.invalid").pathname;
  if (!((request.method || "GET") === "GET" && ["/api/logistics", "/api/logistics/vehicles"].includes(pathname)) && !((request.method || "GET") === "POST" && pathname === "/api/logistics")) {
    throw Object.assign(new Error("This vehicle session cannot access that Logistics operation."), { status: 403, code: "LOGISTICS_MOBILE_ROUTE_DENIED" });
  }
  const session = await (dependencies.mobileSessionReader || (async value => {
    const verifiers = {
      van1: process.env.LOGISTICS_MOBILE_VAN1_PIN_VERIFIER,
      van2: process.env.LOGISTICS_MOBILE_VAN2_PIN_VERIFIER,
    };
    return verifyMobilePinSession(value.cookies.get(MOBILE_SESSION_COOKIE)?.value, { secret: process.env.LOGISTICS_MOBILE_SESSION_SECRET, verifiers });
  }))(request);
  if (!session) throw Object.assign(new Error("A valid vehicle PIN session is required."), { status: 401, code: "LOGISTICS_MOBILE_SESSION_REQUIRED" });
  const requestedVehicle = request.nextUrl?.searchParams.get("vehicle");
  if (requestedVehicle && requestedVehicle !== session.vehicleId) throw Object.assign(new Error("This vehicle session cannot access the requested vehicle."), { status: 403, code: "LOGISTICS_MOBILE_VEHICLE_DENIED" });
  logAuthDiagnostic(request, { authStage: "logistics-mobile-session", status: 200, code: "LOGISTICS_MOBILE_SESSION_ALLOWED" });
  return {
    type: "interactive",
    id: `mobile:${session.vehicleId}:${session.sessionId}`,
    displayName: `${session.vehicleId === "van1" ? "Van 1" : "Van 2"} mobile session`,
    identityKind: "operational",
    permittedVehicleIds: [session.vehicleId],
    sessionKind: "mobile-pin",
  };
}

async function requireHubLogisticsSession(request: LogisticsRequest): Promise<FikaSessionPrincipal> {
  const hub = requiredUpstreamUrl("FIKA_HUB_BASE_URL");
  const query = new URLSearchParams({ mode: "admission", ...(request.nextUrl?.searchParams.get("vehicle") ? { vehicle: request.nextUrl.searchParams.get("vehicle")! } : {}) });
  const response = await fetch(`${hub}/api/logistics/access?${query}`, { headers: { cookie: request.headers?.get("cookie") || "", ...(request.headers?.get("x-request-id") ? { "x-request-id": request.headers.get("x-request-id")! } : {}) }, cache: "no-store", redirect: "error" });
  const body = await response.json().catch(() => null) as { principal?: Omit<FikaSessionPrincipal, "firebaseUid">; error?: { message?: unknown; code?: unknown } } | null;
  if (!response.ok || !body?.principal) {
    const error = body?.error;
    throw Object.assign(new Error(typeof error?.message === "string" ? error.message : "Logistics access could not be verified."), { status: response.ok ? 503 : response.status, code: typeof error?.code === "string" ? error.code : "LOGISTICS_HUB_ADMISSION_FAILED" });
  }
  return { firebaseUid: "hub-admitted", ...body.principal };
}
