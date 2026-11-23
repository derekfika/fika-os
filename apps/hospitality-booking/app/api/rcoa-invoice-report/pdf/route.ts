import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hubUserFetch } from "@/lib/hub";
import { renderPdfToBuffer } from "@/lib/local-pdf";
import { rcoaInvoiceReportHtml } from "@/lib/rcoa-invoice-report-pdf";
import type { RcoaInvoiceReport } from "@/lib/rcoa-invoice-report-contract";

const RequestBody = z.object({
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  dataDigest: z.string().regex(/^[a-f0-9]{64}$/),
  generatedAt: z.iso.datetime(),
}).strict().refine(value => value.endDate >= value.startDate, { message: "Choose an end date on or after the start date." });

export async function POST(request: NextRequest) {
  const parsed = RequestBody.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: { message: "The report preview is invalid. Generate the report again before downloading." } }, { status: 422 });
  try {
    const params = new URLSearchParams({ startDate: parsed.data.startDate, endDate: parsed.data.endDate });
    // The Hub repeats the exact RCoA manager authorization and reloads the source.
    // A changed dataset cannot silently produce a PDF that differs from the preview.
    const upstream = await hubUserFetch(`/api/rcoa-invoice-report?${params}`, request.headers.get("cookie"));
    const raw = await upstream.text();
    let body: RcoaInvoiceReport | { error?: { message?: string } };
    try { body = raw ? JSON.parse(raw) as typeof body : {}; }
    catch { return NextResponse.json({ error: { message: `The Integration Hub returned an unexpected response (${upstream.status}).` } }, { status: upstream.ok ? 502 : upstream.status }); }
    if (!upstream.ok) return NextResponse.json(body, { status: upstream.status, headers: { "Cache-Control": "no-store, max-age=0" } });
    const report = body as RcoaInvoiceReport;
    if (report.dataDigest !== parsed.data.dataDigest) {
      return NextResponse.json({ error: { message: "Bookings or quotation values changed after this preview. Generate the report again before downloading." } }, { status: 409, headers: { "Cache-Control": "no-store, max-age=0" } });
    }
    const bytes = await renderPdfToBuffer(rcoaInvoiceReportHtml({ ...report, generatedAt: parsed.data.generatedAt }));
    const fileName = `RCoA_Invoice_Summary_${parsed.data.startDate}_to_${parsed.data.endDate}.pdf`;
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "no-store, max-age=0",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  } catch (error) {
    return NextResponse.json({ error: { message: `The report PDF could not be generated: ${(error as Error).message}` } }, { status: 503 });
  }
}
