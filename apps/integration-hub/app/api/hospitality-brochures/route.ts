import crypto from "node:crypto";
import JSZip from "jszip";
import { NextRequest, NextResponse } from "next/server";
import { requireActor } from "@/lib/auth";
import { errorResponse } from "@/lib/api";
import { activity, saveLocalSnapshot, updateState } from "@/lib/repository";
import { generateCanonicalId } from "@/lib/canonical-identities";
import { stableDocumentId } from "@/lib/canonical-editor";
import { db } from "@/lib/firebase-admin";
import { sha256 } from "@/lib/profiler";
import type { CanonicalRecord } from "@/lib/types";

export const runtime = "nodejs";
const text = (xml: string) => [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)].map(match => match[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")).join(" ").replace(/\s+/g, " ").trim();
const slideNumber = (name: string) => Number(name.match(/slide(\d+)\.xml$/)?.[1] || 0);

export async function POST(request: NextRequest) {
  try {
    const actor = await requireActor(request, ["integration-admin", "reviewer"]);
    const file = (await request.formData()).get("file");
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".pptx")) throw Object.assign(new Error("Choose a PowerPoint (.pptx) hospitality brochure."), { status: 400 });
    if (file.size > 75 * 1024 * 1024) throw Object.assign(new Error("Local brochure uploads are limited to 75 MB."), { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const zip = await JSZip.loadAsync(buffer);
    const slideNames = Object.keys(zip.files).filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => slideNumber(a) - slideNumber(b));
    const slides = await Promise.all(slideNames.map(async (name, index) => ({ slideNumber: index + 1, sourcePath: name, text: text(await zip.file(name)!.async("string")) })));
    if (!slides.some(slide => slide.text)) throw Object.assign(new Error("No readable slide text was found. Keep the source presentation editable and try again."), { status: 422 });
    const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
    const importId = `brochure:${fileHash.slice(0, 24)}`;
    const snapshot = saveLocalSnapshot(`hospitality-brochures/${fileHash}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`, buffer);
    const extractionSnapshot = saveLocalSnapshot(`hospitality-brochures/${fileHash}.extraction.json`, JSON.stringify({ importId, filename: file.name, extractedAt: new Date().toISOString(), slides }, null, 2));
    const brochureImportId = `hospitality-brochure-import:${fileHash.slice(0, 24)}`;
    const existingImport = await db.collection("integrationHubCanonical").doc(stableDocumentId(brochureImportId)).get();
    if (!existingImport.exists) {
      const now = new Date().toISOString();
      const ownership = { providerOwned: { sourceKind: "brochure-presentation" }, fikaOwned: {} };
      const importRecord = { schemaVersion: "0.1.0", version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid, active: true, externalIdentities: [], provenanceIds: [], ownership, entityType: "Hospitality Brochure Import" as const, canonicalId: brochureImportId, sourceFilename: file.name, sourceHash: fileHash, sourceReference: extractionSnapshot, extractionStatus: "extracted" as const, lifecycleState: "active" as const };
      const batch = db.batch();
      const wrapper = (entityType: CanonicalRecord["entityType"], record: Record<string, unknown>): CanonicalRecord => ({ canonicalId: String(record.canonicalId), entityType, record, dataHash: sha256(JSON.stringify(record)), lifecycleStatus: "draft" });
      batch.create(db.collection("integrationHubCanonical").doc(stableDocumentId(brochureImportId)), wrapper("Hospitality Brochure Import", importRecord));
      for (const slide of slides.filter(slide => slide.text)) {
        const candidateId = generateCanonicalId("Hospitality Brochure Candidate");
        const candidateRecord = { schemaVersion: "0.1.0", version: 1, createdAt: now, createdBy: actor.uid, updatedAt: now, updatedBy: actor.uid, active: true, externalIdentities: [], provenanceIds: [brochureImportId], ownership: { providerOwned: { sourceSlide: slide.slideNumber }, fikaOwned: {} }, entityType: "Hospitality Brochure Candidate" as const, canonicalId: candidateId, brochureImportId, slideNumber: slide.slideNumber, sourceText: slide.text, reviewState: "draft" as const };
        batch.create(db.collection("integrationHubCanonical").doc(stableDocumentId(candidateId)), wrapper("Hospitality Brochure Candidate", candidateRecord));
      }
      await batch.commit();
    }
    const state = await updateState(state => {
      if (!state.imports.some(entry => entry.fileHash === fileHash)) state.imports.push({ importId, sourceKind: "brochure-presentation", originalFilename: file.name, fileHash, uploadedAt: new Date().toISOString(), importedBy: actor.uid, status: "profiled", rawSnapshotReference: snapshot, extractionSnapshotReference: extractionSnapshot });
      state.activity.push(activity(actor, "Hospitality brochure inspected", importId, "brochure-presentation", `${slides.length} slide(s) preserved as local evidence; no menu data published.`, crypto.randomUUID()));
    });
    return NextResponse.json({ importId, filename: file.name, slides, state });
  } catch (error) { return errorResponse(error); }
}
