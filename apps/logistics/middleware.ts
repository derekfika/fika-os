import { NextRequest, NextResponse } from "next/server";
import { hostedRuntime } from "./lib/runtime";
import { admissionFailure, admissionJson, parseAdmissionBody } from "../../shared/admission";
import { logAuthDiagnostic, requestIdFor } from "../../shared/auth-diagnostics";
import { internalTokenAllowed } from "../shared/internal-auth";

export async function middleware(request: NextRequest) {
  if (!hostedRuntime()) return NextResponse.next();
  const pathname = request.nextUrl.pathname;
  // The fixed-vehicle pages are PIN-entry shells. Their data remains behind
  // the signed vehicle session checked independently at every API boundary.
  if (["/mobile/van1", "/mobile/van2", "/api/logistics/mobile/session"].includes(pathname)) return NextResponse.next();
  // This is only an admission shortcut. The route still verifies the signed,
  // expiring session and derives the single permitted vehicle server-side.
  // Each van has its own session cookie (fika_logistics_mobile_session_van1 / _van2), selected by the van the request names.
  const mobileVehicle = request.headers.get("x-fika-logistics-vehicle");
  if (["/api/logistics", "/api/logistics/vehicles", "/api/logistics/driver-notifications", "/api/logistics/driver-notifications/push"].includes(pathname)
    && request.headers.get("x-fika-logistics-mobile-request") === "1"
    && (mobileVehicle === "van1" || mobileVehicle === "van2")
    && request.cookies.has(`fika_logistics_mobile_session_${mobileVehicle}`)) return NextResponse.next();
  // Service-to-service projection invalidations are authenticated by the
  // internal token at the route boundary. They must not be redirected through
  // the browser/session admission flow, which has no user cookie and would
  // incorrectly return 401 before the route can validate the token.
  // The recovery route verifies a Cloud Scheduler OIDC token itself (signature, audience, service account); this only admits the call.
  if (pathname === "/api/logistics/driver-notifications/process" && /^Bearer\s+\S+$/i.test(request.headers.get("authorization") ?? "")) return NextResponse.next();
  if (internalTokenAllowed(request)) return NextResponse.next();
  const requestId = requestIdFor(request);
  logAuthDiagnostic(request, { authStage: "middleware-admission-request", status: 200, code: "AUTH_ADMISSION_REQUESTED", requestId });
  const hub = process.env.FIKA_HUB_BASE_URL?.trim();
  if (!hub) { const failure = admissionFailure("Logistics", 503, { error: { code: "LOGISTICS_HUB_ENDPOINT_NOT_CONFIGURED" } }, requestId); return request.nextUrl.pathname.startsWith("/api/") ? NextResponse.json(admissionJson(failure, requestId), { status: 503, headers: { "x-request-id": requestId } }) : renderFailure(request, failure, requestId); }
  const query = new URLSearchParams({ mode: "admission", ...(request.nextUrl.searchParams.get("vehicle") ? { vehicle: request.nextUrl.searchParams.get("vehicle")! } : {}) });
  const response = await fetch(`${hub.replace(/\/$/, "")}/api/logistics/access?${query}`, { headers: { cookie: request.headers.get("cookie") || "", "x-request-id": requestId }, cache: "no-store" }).catch(() => undefined);
  if (response?.ok) { logAuthDiagnostic(request, { authStage: "middleware-admission-result", status: response.status, code: "AUTH_ADMISSION_ALLOWED", requestId }); const headers = new Headers(request.headers); headers.set("x-request-id", requestId); return NextResponse.next({ request: { headers } }); }
  const status = response?.status || 503;
  const failure = admissionFailure("Logistics", status, response ? await parseAdmissionBody(response) : undefined, requestId);
  logAuthDiagnostic(request, { authStage: "middleware-admission-result", status: failure.status, code: failure.code, requestId });
  console.warn("FIKA hosted admission failed", { timestamp: new Date().toISOString(), appId: "logistics", status: failure.status, code: failure.code, runtimeMode: process.env.FIKA_RUNTIME_MODE || "unknown", requestId });
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json(admissionJson(failure, requestId), { status: failure.status, headers: { "x-request-id": requestId } });
  if (failure.status === 401) {
    const target = new URL(process.env.NEXT_PUBLIC_FIKA_HUB_URL || hub);
    const forwardedHost = request.headers.get("x-forwarded-host");
    const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
    const returnTo = forwardedHost ? `${forwardedProto}://${forwardedHost}${request.nextUrl.pathname}${request.nextUrl.search}` : request.nextUrl.href;
    target.searchParams.set("returnTo", returnTo);
    target.searchParams.set("launchError", failure.code);
    target.searchParams.set("appId", "logistics");
    return NextResponse.redirect(target);
  }
  return renderFailure(request, failure, requestId);
}

function renderFailure(request: NextRequest, failure: ReturnType<typeof admissionFailure>, requestId: string) { const target = new URL("/admission-error", request.url); target.searchParams.set("code", failure.code); target.searchParams.set("message", failure.message); if (failure.supportingText) target.searchParams.set("supportingText", failure.supportingText); target.searchParams.set("requestId", requestId); return NextResponse.rewrite(target); }

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|css|js|map|otf|ttf)$).*)"] };
