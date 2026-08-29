import { NextResponse } from "next/server";
import { z } from "zod";
export function errorResponse(error: unknown) { const value = error as { message?: string; status?: number; code?: string }; const message = error instanceof z.ZodError ? "Some booking information was incomplete. Refresh the page and try again." : value.message || "We couldn’t complete that request. Please try again."; return NextResponse.json({ error: { code: value.code || "INVALID_REQUEST", message } }, { status: value.status || 400 }); }
