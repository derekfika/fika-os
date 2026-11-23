import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hubUserFetch } from "@/lib/hub";

const Range = z.object({ startDate: z.iso.date(), endDate: z.iso.date() }).strict().refine(value => value.endDate >= value.startDate, {
  message: "Choose an end date on or after the start date.",
});

export async function GET(request: NextRequest) {
  const parsed = Range.safeParse({
    startDate: request.nextUrl.searchParams.get("startDate"),
    endDate: request.nextUrl.searchParams.get("endDate"),
  });
  if (!parsed.success) return NextResponse.json({ error: { message: "Choose a valid reporting range with an end date on or after the start date." } }, { status: 422 });
  try {
    const params = new URLSearchParams(parsed.data);
    const upstream = await hubUserFetch(`/api/rcoa-invoice-report?${params}`, request.headers.get("cookie"));
    const content = await upstream.text();
    try {
      return NextResponse.json(content ? JSON.parse(content) : {}, { status: upstream.status, headers: { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow" } });
    } catch {
      return NextResponse.json({ error: { message: `The Integration Hub returned an unexpected response (${upstream.status}).` } }, { status: upstream.ok ? 502 : upstream.status });
    }
  } catch (error) {
    return NextResponse.json({ error: { message: (error as Error).message } }, { status: 503 });
  }
}
