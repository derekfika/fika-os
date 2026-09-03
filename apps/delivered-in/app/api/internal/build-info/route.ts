import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { fikaBuildIdentity } from "@fika/server-shared/build-identity";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const expected = process.env.FIKA_INTERNAL_API_TOKEN?.trim();
  const supplied = request.headers.get("x-fika-internal-token") || "";
  if (!expected) return NextResponse.json({ code: "BUILD_INFO_TOKEN_NOT_CONFIGURED" }, { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } });
  const expectedBytes = Buffer.from(expected); const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) return NextResponse.json({ code: "BUILD_INFO_TOKEN_MISMATCH" }, { status: 403, headers: { "Cache-Control": "no-store, max-age=0" } });
  return NextResponse.json({ appId: "delivered-in", ...fikaBuildIdentity() }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
