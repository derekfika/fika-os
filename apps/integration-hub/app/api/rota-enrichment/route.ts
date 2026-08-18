import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { activity, updateState } from "@/lib/repository";
import { buildRotaWorkLocationEvidence, matchRotaLegend, normaliseLegendName, parseAllSitesRota, saveRotaEnrichment } from "@/lib/rota-enrichment";
import { sha256 } from "@/lib/profiler";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireActor(req, ["integration-admin", "reviewer"]);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose the All Sites Rota workbook.");
    if (!/\.xlsx?$/i.test(file.name)) throw new Error("The rota cross-check requires an XLSX or XLS workbook.");
    if (file.size > 10 * 1024 * 1024) throw new Error("Local uploads are limited to 10 MB.");
    const snapshot = parseAllSitesRota(Buffer.from(await file.arrayBuffer()));
    saveRotaEnrichment(snapshot);

    let matched = 0, ambiguous = 0, unmatched = 0, canonicalEnriched = 0;
    const state = await updateState(state => {
      const legends = state.staging.filter(record => record.entityType === "Legend" && record.raw.provider === "brighthr");
      const counts = new Map<string, number>();
      for (const record of legends) {
        const key = normaliseLegendName(String(record.normalised.displayName || ""));
        counts.set(key, (counts.get(key) || 0) + 1);
      }
      for (const record of legends) {
        const key = normaliseLegendName(String(record.normalised.displayName || ""));
        const enrichment = matchRotaLegend(String(record.normalised.displayName || ""), snapshot, (counts.get(key) || 0) > 1);
        record.normalised = { ...record.normalised, ...enrichment };
        if (enrichment.rotaSiteMappingStatus === "matched-by-name-review-required") matched += 1;
        else if (enrichment.rotaSiteMappingStatus === "ambiguous-legend-name") ambiguous += 1;
        else unmatched += 1;
        const evidence = buildRotaWorkLocationEvidence(enrichment);
        if (evidence) {
          const providerId = String(record.raw.externalId || "");
          const canonical = state.canonical.find(candidate => candidate.entityType === "Legend" && Array.isArray(candidate.record.externalIdentities) && candidate.record.externalIdentities.some(identity => identity && typeof identity === "object" && String((identity as Record<string, unknown>).provider || "") === "brighthr" && String((identity as Record<string, unknown>).externalId || "") === providerId));
          if (canonical) {
            const ownership = canonical.record.ownership && typeof canonical.record.ownership === "object" ? canonical.record.ownership as Record<string, unknown> : {};
            const fikaOwned = ownership.fikaOwned && typeof ownership.fikaOwned === "object" ? ownership.fikaOwned as Record<string, unknown> : {};
            if (JSON.stringify(fikaOwned.workLocationEvidence) !== JSON.stringify(evidence)) {
              canonical.record.ownership = { ...ownership, fikaOwned: { ...fikaOwned, workLocationEvidence: evidence } };
              canonical.record.version = Number(canonical.record.version || 1) + 1;
              canonical.record.updatedAt = new Date().toISOString();
              canonical.record.updatedBy = actor.uid;
              canonical.dataHash = sha256(JSON.stringify(canonical.record));
              canonicalEnriched += 1;
            }
          }
        }
      }
      if (!state.imports.some(source => source.fileHash === snapshot.sourceFileHash)) state.imports.push({ importId: `import:rota:${snapshot.sourceFileHash.slice(0, 20)}`, sourceKind: "spreadsheet", originalFilename: file.name, fileHash: snapshot.sourceFileHash, workbook: file.name, uploadedAt: snapshot.importedAt, importedBy: actor.uid, status: "completed" });
      state.activity.push(activity(actor, "All Sites Rota cross-check", `import:rota:${snapshot.sourceFileHash.slice(0, 20)}`, "spreadsheet", `${snapshot.worksheetCount} weekly worksheets checked; ${matched} exact Legend matches, ${ambiguous} ambiguous names and ${unmatched} unmatched Legends; ${canonicalEnriched} approved Legends received versioned FIKA-owned workplace evidence. Site names remain reviewable references.`));
    });
    return NextResponse.json({ state, summary: { worksheets: snapshot.worksheetCount, latestWeek: snapshot.latestWeek, matched, ambiguous, unmatched, canonicalEnriched } });
  } catch (error) {
    return errorResponse(error);
  }
}
