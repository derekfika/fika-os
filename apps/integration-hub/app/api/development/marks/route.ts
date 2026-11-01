import type { NextRequest } from "next/server";
import { requireAuthmodAdminContext } from "@/lib/authmod-admin-context";
import { assertSameOrigin } from "@/lib/csrf";
import { createRateLimiter } from "@/lib/development/marks";
import { handleMarksHistoryGet, handleMarksPost } from "@/lib/development/marks-route";
import { developmentSnapshotService } from "@/lib/development/snapshot";
import { developmentMarksStore } from "@/lib/development/marks-store";

// Owner-recorded assertions only. Same admission as GET /api/development (an active person AUTHMOD Administrator),
// same-origin required, JSON only, server-derived actor. No deploy, GitHub write or issue close is reachable from here.
const rateLimiter = createRateLimiter(20, 60_000);

export async function POST(request: NextRequest) {
  return handleMarksPost(request, { authorize: requireAuthmodAdminContext, assertSameOrigin, service: developmentSnapshotService, marks: developmentMarksStore, rateLimiter });
}
export async function GET(request: NextRequest) {
  return handleMarksHistoryGet(request, { authorize: requireAuthmodAdminContext, marks: developmentMarksStore });
}
