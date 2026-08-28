import { NextRequest, NextResponse } from "next/server";
import { hostedRuntime } from "./lib/runtime";

export async function middleware(request: NextRequest) {
  if (!hostedRuntime()) return NextResponse.next();
  const hub = process.env.FIKA_HUB_BASE_URL?.trim();
  if (!hub) return NextResponse.json({ error: { message: "Logistics authentication service is not configured." } }, { status: 503 });
  const response = await fetch(`${hub.replace(/\/$/, "")}/api/logistics/access?mode=admission`, { headers: { cookie: request.headers.get("cookie") || "" }, cache: "no-store" }).catch(() => undefined);
  if (response?.ok) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: { message: response?.status === 403 ? "Logistics access is denied." : "Logistics authentication service is unavailable." } }, { status: response?.status === 403 ? 403 : response?.status === 401 ? 401 : 503 });
  const target = new URL(process.env.NEXT_PUBLIC_FIKA_HUB_URL || hub);
  target.searchParams.set("returnTo", request.nextUrl.href);
  return NextResponse.redirect(target);
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|css|js|map)$).*)"] };
