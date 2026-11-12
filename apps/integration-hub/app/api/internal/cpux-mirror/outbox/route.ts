import type { NextRequest } from "next/server";
import { requireAuthmodAdminContext } from "../../../../../lib/authmod-admin-context";
import { readHospitalityMirrorOutboxInventory } from "../../../../../lib/cpux-mirror/outbox-inventory";
import { handleHospitalityOutboxInventoryPost } from "../../../../../lib/cpux-mirror/outbox-inventory-http";

export const runtime = "nodejs";
export const maxDuration = 60;

export function POST(request: NextRequest) {
  return handleHospitalityOutboxInventoryPost(request, {
    authorize: requireAuthmodAdminContext,
    inspect: readHospitalityMirrorOutboxInventory,
  });
}
