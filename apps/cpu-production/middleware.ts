import { NextRequest, NextResponse } from "next/server";

const isHosted = () => ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");
const hubUrl = () => (process.env.FIKA_HUB_BASE_URL || "").replace(/\/$/, "");

function publicRequestUrl(request: NextRequest) {
  const configured = process.env.CPU_PUBLIC_BASE_URL || process.env.CPU_PRODUCTION_BASE_URL;
  if (configured) {
    try {
      const base = new URL(configured);
      if (["http:", "https:"].includes(base.protocol)) return new URL(`${request.nextUrl.pathname}${request.nextUrl.search}${request.nextUrl.hash}`, base);
    } catch {
      // Fall through to the proxy's public forwarded origin.
    }
  }
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwardedProto && forwardedHost && ["http", "https"].includes(forwardedProto)) {
    return new URL(`${request.nextUrl.pathname}${request.nextUrl.search}${request.nextUrl.hash}`, `${forwardedProto}://${forwardedHost}`);
  }
  return request.nextUrl;
}

export async function middleware(request: NextRequest) {
  if (!isHosted()) return NextResponse.next();
  const response = await fetch(`${hubUrl()}/api/cpu-production/access`, {
    headers: { cookie: request.headers.get("cookie") || "" },
    cache: "no-store",
  }).catch(() => undefined);
  if (response?.ok) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: { message: response?.status === 403 ? "CPU Production access is denied." : "FIKA OS authentication service is unavailable." } },
      { status: response?.status === 403 ? 403 : response?.status === 401 ? 401 : 503 },
    );
  }
  const target = new URL(process.env.NEXT_PUBLIC_FIKA_HUB_URL || hubUrl() || request.nextUrl.origin);
  target.searchParams.set("returnTo", publicRequestUrl(request).href);
  return NextResponse.redirect(target);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|css|js|map)$).*)"] };
