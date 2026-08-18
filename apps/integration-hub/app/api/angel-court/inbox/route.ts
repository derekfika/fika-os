import { NextRequest, NextResponse } from "next/server";
import { assertLocalSafety } from "@/lib/safety";
import { parseAngelCourtWorkbook } from "@/lib/angel-court-inbox";

/**
 * Local-only compatibility adapter. It accepts an exported XLSX attachment and
 * returns parsed source evidence. Gmail access and canonical writes are
 * deliberately not part of this route.
 */
export async function POST(request: NextRequest) {
  try {
    assertLocalSafety();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Upload an XLSX attachment as file." }, { status: 400 });
    const messageId = String(form.get("messageId") || "local-upload");
    const attachmentName = String(form.get("attachmentName") || file.name);
    const candidate = parseAngelCourtWorkbook(Buffer.from(await file.arrayBuffer()), {
      messageId,
      attachmentName,
      threadId: String(form.get("threadId") || "") || undefined,
      receivedAt: String(form.get("receivedAt") || "") || undefined,
      from: String(form.get("from") || "") || undefined,
      subject: String(form.get("subject") || "") || undefined,
    });
    return NextResponse.json({ dryRun: true, canonicalWrite: "disabled", candidate }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Angel Court inbox parse failed." }, { status: 400 });
  }
}

