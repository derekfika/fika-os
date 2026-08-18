import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { parseWorkbook } from "@/lib/profiler";
import { activity, saveLocalSnapshot, updateState } from "@/lib/repository";

export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  try {
    const actor = await requireActor(req, ["integration-admin", "reviewer"]);
    const form = await req.formData(); const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a spreadsheet file.");
    if (file.size > 10 * 1024 * 1024) throw new Error("Local uploads are limited to 10 MB.");
    const buffer = Buffer.from(await file.arrayBuffer());
    const profile = parseWorkbook(file.name, buffer, actor.uid);
    const snapshotReference = saveLocalSnapshot(`uploads/${profile.fileHash}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`, buffer);
    const state = await updateState(state => {
      if (!state.profiles.some(p => p.fileHash === profile.fileHash)) state.profiles.push(profile);
      if (!state.imports.some(i => i.fileHash === profile.fileHash)) state.imports.push({ importId: profile.importId, sourceKind: "spreadsheet", originalFilename: file.name, fileHash: profile.fileHash, workbook: file.name, uploadedAt: new Date().toISOString(), importedBy: actor.uid, status: "profiled", rawSnapshotReference: snapshotReference });
      state.activity.push(activity(actor, state.profiles.some(p => p.fileHash === profile.fileHash) ? "File re-import inspected" : "File uploaded", profile.importId, "spreadsheet", `${profile.worksheets.length} worksheet(s) profiled; source retained locally.`));
    });
    return NextResponse.json({ profile, state });
  } catch (error) { return errorResponse(error); }
}
