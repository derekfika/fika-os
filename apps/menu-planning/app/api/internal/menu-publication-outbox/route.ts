import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { replayMenuPublicationOutbox } from "@/lib/menu-publication";
import { forwardProductionMaterialisationEvent } from "@/lib/production-client";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const expected = process.env.FIKA_INTERNAL_API_TOKEN;
  const supplied = request.headers.get("x-fika-internal-token");
  if (!expected) return NextResponse.json({ code: "INTERNAL_TOKEN_NOT_CONFIGURED" }, { status: 503 });
  if (!supplied) return NextResponse.json({ code: "INTERNAL_TOKEN_REQUIRED" }, { status: 401 });
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
    return NextResponse.json({ code: "INTERNAL_TOKEN_MISMATCH" }, { status: 403 });
  }
  const body = await request.json().catch(() => undefined);
  const limit = body?.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
    return NextResponse.json({ code: "INVALID_OUTBOX_LIMIT" }, { status: 422 });
  }
  try {
    const result = await replayMenuPublicationOutbox(forwardProductionMaterialisationEvent, new Date(), { maxEvents: limit });
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Menu publication recovery failed", {
      code: error && typeof error === "object" && "code" in error ? error.code : "OUTBOX_RECOVERY_UNAVAILABLE",
      message: error instanceof Error ? error.message : "Recovery failed",
    });
    return NextResponse.json({ code: "OUTBOX_RECOVERY_UNAVAILABLE" }, { status: 503 });
  }
}
