import { NextResponse } from "next/server";

export function errorResponse(error: unknown) {
  const e = error as { message?: string; status?: number; code?: string };
  const isLocalDevelopment = process.env.NODE_ENV !== "production";
  const message = e.status && e.status >= 500 && !isLocalDevelopment
    ? "The operation failed safely."
    : (e.message || "Request failed");
  return NextResponse.json({ error: { code: e.code || "INVALID_REQUEST", message } }, { status: e.status || 400 });
}
