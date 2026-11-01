import { NextResponse } from "next/server";
import { errorResponse } from "../api";
import type { DevelopmentSnapshot } from "./types";

type RouteRequest = Request & { nextUrl?: { searchParams: URLSearchParams } };
export interface DevelopmentRouteDeps { authorize: (request: Request) => Promise<unknown>; service: { get(options: { refresh?: boolean }): Promise<DevelopmentSnapshot> } }

/**
 * Read-only. Authorisation runs first and fails closed: when it throws (401/403 or any unexpected error),
 * the snapshot service is never called and the body carries no development metadata.
 */
export async function handleDevelopmentGet(request: RouteRequest, deps: DevelopmentRouteDeps) {
  try {
    await deps.authorize(request);
  } catch (error) {
    const status = (error as { status?: number }).status;
    return errorResponse(status === 401 || status === 403 ? error : Object.assign(new Error("Access denied."), { status: 403, code: "DEVELOPMENT_ACCESS_DENIED" }));
  }
  try {
    const url = new URL(request.url);
    const snapshot = await deps.service.get({ refresh: url.searchParams.get("refresh") === "1" });
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return errorResponse(Object.assign(new Error("Development data could not be loaded."), { status: 502, code: "DEVELOPMENT_LOAD_FAILED" }));
  }
}
