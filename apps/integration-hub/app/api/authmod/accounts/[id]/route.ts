import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireAuthmodAdminContext } from "@/lib/authmod-admin-context";
import { buildAuthmodAccount } from "@/lib/authmod-admin-read-model";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { try { const context = await requireAuthmodAdminContext(request); return NextResponse.json({ account: await buildAuthmodAccount(context.repository, (await params).id) }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return errorResponse(error); } }
