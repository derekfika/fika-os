import type { NextRequest } from "next/server";
import { requireAuthmodAdminContext } from "@/lib/authmod-admin-context";
import { handleDevelopmentGet } from "@/lib/development/route";
import { developmentSnapshotService } from "@/lib/development/snapshot";

// Read-only (GET only). Same server-side admission as the Usage Observatory: an active person AUTHMOD Administrator.
export async function GET(request: NextRequest) {
  return handleDevelopmentGet(request, { authorize: requireAuthmodAdminContext, service: developmentSnapshotService });
}
