import { NextRequest, NextResponse } from "next/server";
import { admissionFailure, admissionJson, parseAdmissionBody } from "./lib/admission";

const isHosted = () => ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");
const hubUrl = () => (process.env.FIKA_HUB_BASE_URL || "").replace(/\/$/, "");

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/internal/menu-planning-diagnostic") return NextResponse.next();
  if (!isHosted()) return NextResponse.next();
  const totalStarted = performance.now();
  const accessStarted = performance.now();
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  const response = await fetch(`${hubUrl()}/api/menu-planning/access?mode=admission`, { headers: { cookie: request.headers.get("cookie") || "", "x-request-id": requestId }, cache: "no-store" }).catch(() => undefined);
  console.info("Menu Planning middleware timing", { hubAccessMs: performance.now() - accessStarted, totalMs: performance.now() - totalStarted, status: response?.status || 503 });
  if (response?.ok) {
    const admission = await response.clone().json().catch(() => undefined);
    const identity = typeof admission?.principal?.id === "string" ? admission.principal.id : "";
    const next = NextResponse.next();
    if (identity) next.headers.set("x-fika-menu-identity", identity);
    return next;
  }
  const failure = admissionFailure("Menu Planning", response?.status || 503, response ? await parseAdmissionBody(response) : undefined, requestId);
  console.warn("FIKA hosted admission failed", { timestamp: new Date().toISOString(), appId: "menu-planning", status: failure.status, code: failure.code, runtimeMode: process.env.FIKA_RUNTIME_MODE || "unknown", requestId });
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json(admissionJson(failure, requestId), { status: failure.status, headers: { "x-request-id": requestId } });
  if (failure.status === 401) { const target = new URL(process.env.NEXT_PUBLIC_FIKA_HUB_URL || hubUrl() || request.nextUrl.origin); target.searchParams.set("returnTo", request.nextUrl.href); target.searchParams.set("launchError", failure.code); target.searchParams.set("appId", "menu-planning"); return NextResponse.redirect(target); }
  const target = new URL("/admission-error", request.url); target.searchParams.set("code", failure.code); target.searchParams.set("message", failure.message); if (failure.supportingText) target.searchParams.set("supportingText", failure.supportingText); target.searchParams.set("requestId", requestId); return NextResponse.rewrite(target);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|css|js|map)$).*)"] };
