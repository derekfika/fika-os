import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import { eventsOperatingReadContract } from "@/lib/events-read-contract";

const Query = z.object({ ids: z.string().max(5000).optional() }).strict();
export async function GET(request: NextRequest) { try { const actor = await requireActor(request); assertPermission(actor, "canonical.view"); const query = Query.parse(Object.fromEntries(request.nextUrl.searchParams)); const ids = (query.ids || "").split(",").map(value => value.trim()).filter(Boolean).slice(0, 100); return NextResponse.json(await eventsOperatingReadContract(ids), { headers: { "Cache-Control": "no-store, max-age=0" } }); } catch (error) { return errorResponse(error); } }
