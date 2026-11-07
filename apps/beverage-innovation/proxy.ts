import { NextRequest, NextResponse } from "next/server";
import { beveragePreviewRouteDecision } from "@/lib/preview-routing";

/** The preview can expose only its build identity and the gated OPLOC read. */
export function proxy(request: NextRequest) {
  const decision = beveragePreviewRouteDecision(request.nextUrl.pathname, request.nextUrl.hostname, process.env, request.method);
  if (decision === "pass-through") return NextResponse.next();
  if (decision === "unavailable") {
    return new NextResponse("Beverage preview runtime is not configured for this environment.", { status: 503, headers: { "cache-control": "no-store" } });
  }

  if (decision === "build-info" || decision === "oploc-read") return NextResponse.next();
  if (decision === "hide-api") return new NextResponse(null, { status: 404, headers: { "cache-control": "no-store" } });
  if (decision === "mock" && request.nextUrl.pathname !== "/mock" && !request.nextUrl.pathname.startsWith("/mock/")) {
    const destination = new URL("/mock", request.url);
    return NextResponse.rewrite(destination, { headers: { "cache-control": "no-store" } });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|css|js|map|otf|ttf|webmanifest)$).*)"],
};
