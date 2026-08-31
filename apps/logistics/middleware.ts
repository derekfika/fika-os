import { NextRequest, NextResponse } from "next/server";
import { hostedRuntime } from "./lib/runtime";
import { admissionFailure, admissionJson, parseAdmissionBody } from "../../shared/admission";
import { logAuthDiagnostic, requestIdFor } from "../../shared/auth-diagnostics";

export async function middleware(request: NextRequest) {
  if (!hostedRuntime()) return NextResponse.next();
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
