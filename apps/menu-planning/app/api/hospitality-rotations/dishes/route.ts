import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAndLinkHospitalityDish } from "@/lib/hospitality-dish-command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function POST(request: NextRequest) {
  try {
    if (Number(request.headers.get("content-length")) > 20_000) throw Object.assign(new Error("Request too large"), { status: 413 });
    const { status, ...body } = await createAndLinkHospitalityDish(request.headers.get("cookie"), await request.json());
    return NextResponse.json(body, { status, headers });
  } catch (error) {
    const status = error instanceof z.ZodError || error instanceof SyntaxError ? 422 : Number((error as { status?: number }).status) || 503;
    return NextResponse.json({ error: { message: error instanceof z.ZodError ? "The hospitality dish request is invalid." : status >= 500 ? "Hospitality dish service is unavailable." : (error as Error).message } }, { status, headers });
  }
}
