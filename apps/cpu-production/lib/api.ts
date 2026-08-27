import { NextResponse } from "next/server";
import { z } from "zod";

function readableErrorMessage(error: unknown) {
  const candidate = error as { message?: unknown; status?: unknown };
  const status = typeof candidate.status === "number" ? candidate.status : undefined;
  if (error instanceof z.ZodError) {
    const paths = error.issues.map(issue => issue.path.map(String).join(".")).filter(Boolean);
    if (paths.includes("expectedVersion")) return "This booking has changed since you opened it. Refresh the page and try again.";
    if (paths.includes("reason")) return "Please enter a short reason before saving this change.";
    if (paths.includes("action")) return "That action is no longer available. Refresh the page and try again.";
    return "Some booking information was incomplete. Refresh the page and try again.";
  }
  if (status === 401) return "Your session has expired. Refresh the page and sign in again.";
  if (status === 403) return "You do not have permission to make this change.";
  if (status === 404) return "We could not find that booking. Refresh the page and try again.";
  if (status === 409) return "This booking changed elsewhere. Refresh the page before trying again.";
  if (status && status >= 500) return "We couldn’t complete that request. Please try again, and report it if it keeps happening.";
  return typeof candidate.message === "string" && candidate.message.trim() ? candidate.message.trim() : "We couldn’t complete that request. Please try again, and report it if it keeps happening.";
}

export function errorResponse(error: unknown) {
  const value = error as { message?: string; status?: number; code?: string };
  return NextResponse.json({ error: { code: value.code || "INVALID_REQUEST", message: readableErrorMessage(error) } }, { status: value.status || 400 });
}
