import { NextRequest, NextResponse } from "next/server";

const isHosted = () => ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");
const hubUrl = () => (process.env.FIKA_HUB_BASE_URL || "").replace(/\/$/, "");

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
  target.searchParams.set("returnTo", request.nextUrl.href);
  return NextResponse.redirect(target);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|css|js|map)$).*)"] };
