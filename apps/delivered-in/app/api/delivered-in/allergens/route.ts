import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Deliberately retained as a tombstone so old clients fail closed.  Allergen
 * data is available only as part of the signed daily CPU packet projection;
 * this manager-facing reconstruction endpoint must not be revived.
 */
export async function GET() {
  return NextResponse.json({ error: { message: "The manager-facing Delivered-In allergen endpoint has been retired. Use the signed daily packet projection." } }, { status: 410, headers: { "Cache-Control": "no-store, max-age=0" } });
}
