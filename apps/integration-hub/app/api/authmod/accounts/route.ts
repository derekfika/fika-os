import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireAuthmodAdminContext } from "@/lib/authmod-admin-context";
import { buildAuthmodAccounts } from "@/lib/authmod-admin-read-model";

export async function GET(request: NextRequest) {
  try { const context = await requireAuthmodAdminContext(request); const q = request.nextUrl.searchParams; return NextResponse.json({ accounts: await buildAuthmodAccounts(context.repository, { search: q.get("search") || undefined, kind: q.get("kind") || undefined, status: q.get("status") || undefined, siteId: q.get("siteId") || undefined, appId: q.get("appId") || undefined, special: q.get("special") === "true", expiringSoon: q.get("expiringSoon") === "true" }) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return errorResponse(error); }
}
