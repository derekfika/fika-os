import { NextRequest, NextResponse } from "next/server";
import { hubJson } from "../../../lib/production-http-client";

const isOplocResponse = (value: unknown): value is { oplocs: Array<{ canonicalId: string; label: string; address?: string }> } =>
  Boolean(value && typeof value === "object" && Array.isArray((value as { oplocs?: unknown }).oplocs));

export async function GET(request: NextRequest) {
  try {
    const response = await hubJson(
      request,
      "/api/oplocs",
      { method: "GET", headers: { accept: "application/json" } },
      isOplocResponse,
    );
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 503;
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Integration Hub is unavailable." } }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
