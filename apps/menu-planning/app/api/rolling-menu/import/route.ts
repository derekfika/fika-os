import { NextRequest, NextResponse } from "next/server";
import { importWorkbook, saveSnapshotsCreateOnly, listWeeks, validateWeek, planningWeekCommencing } from "@/lib/rolling-menu";
import { readDeliveredInOplocs } from "@/lib/oploc-authority";
import { listCanonicalMenuItems, recordDishSourceAliases } from "@/lib/canonical-menu-repository";
import { applyDishResolutions, parseWorkbookWeekCommencing, resolveDishNames, safeDishKey } from "@/lib/legacy-week-importer";
import type { RollingSnapshot } from "@/lib/rolling-menu-types";

type ResolutionInput = { sourceName: string; canonicalId?: string; ignored?: boolean; remember?: boolean };

async function previewFiles(files: File[], request: NextRequest, weekDates: Record<string, string> = {}) {
  const catalogue = await listCanonicalMenuItems();
  const oplocs = await readDeliveredInOplocs(request);
  const snapshots: RollingSnapshot[] = [];
  const reports: Array<{ fileName: string; weekCommencing?: string; status: "valid" | "needs_attention"; error?: string; recognisedEntries?: number }> = [];
  for (const file of files) {
    const fileName = file.name;
    if (!/\.xlsx?$/i.test(fileName)) { reports.push({ fileName, status: "needs_attention", error: "Choose an Excel workbook (.xlsx or .xls)." }); continue; }
    const weekCommencing = weekDates[fileName] ? planningWeekCommencing(weekDates[fileName]) : parseWorkbookWeekCommencing(fileName);
    if (!weekCommencing) { reports.push({ fileName, status: "needs_attention", error: "We couldn't detect a clear week date from this filename." }); continue; }
    try {
      const result = importWorkbook(Buffer.from(await file.arrayBuffer()), fileName, "historical-importer", oplocs, weekCommencing);
      if (!result.recognisedEntries) { reports.push({ fileName, weekCommencing, status: "needs_attention", error: "We couldn't read the usual weekly menu format." }); continue; }
      snapshots.push(result.snapshot); reports.push({ fileName, weekCommencing, status: "valid", recognisedEntries: result.recognisedEntries });
    } catch { reports.push({ fileName, weekCommencing, status: "needs_attention", error: "We couldn't read this spreadsheet. Please check the usual weekly menu format." }); }
  }
  const weekCounts = new Map<string, number>(); snapshots.forEach(snapshot => weekCounts.set(snapshot.week.weekCommencing, (weekCounts.get(snapshot.week.weekCommencing) || 0) + 1));
  for (const report of reports) if (report.weekCommencing && (weekCounts.get(report.weekCommencing) || 0) > 1) { report.status = "needs_attention"; report.error = "Another selected workbook uses this same week. Remove one before importing."; }
  const names = snapshots.flatMap(snapshot => snapshot.entries.map(entry => entry.itemLabel));
  const resolutions = resolveDishNames(names, catalogue).map(resolution => ({ ...resolution, workbookCount: snapshots.filter(snapshot => snapshot.entries.some(entry => safeDishKey(entry.itemLabel) === safeDishKey(resolution.sourceName))).length }));
  const existingWeeks = await listWeeks();
  const conflicts = snapshots.filter(snapshot => existingWeeks.some(week => week.weekCommencing === snapshot.week.weekCommencing)).map(snapshot => ({ weekCommencing: snapshot.week.weekCommencing, status: existingWeeks.find(week => week.weekCommencing === snapshot.week.weekCommencing)?.status || "existing" }));
  for (const report of reports) { const conflict = conflicts.find(value => value.weekCommencing === report.weekCommencing); if (conflict) { report.status = "needs_attention"; report.error = `This week already exists (${conflict.status}). Remove this workbook before importing.`; } }
  return { files: reports, snapshots, resolutions, conflicts, catalogue: catalogue.filter(item => item.reviewStatus !== "archived").map(item => ({ id: item.canonicalId, name: item.displayName })) };
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await request.json() as { action?: string; snapshot?: RollingSnapshot; snapshots?: RollingSnapshot[]; resolutions?: ResolutionInput[] };
      if (body.action !== "commit" || (!body.snapshot && !body.snapshots) || !body.resolutions) return NextResponse.json({ error: { message: "Please complete the dish review before importing." } }, { status: 422 });
      const snapshots = body.snapshots || [body.snapshot!];
      const existingWeeks = await listWeeks();
      const conflicts = snapshots.filter(snapshot => existingWeeks.some(week => week.weekCommencing === snapshot.week.weekCommencing));
      if (conflicts.length) return NextResponse.json({ error: { message: `These menu weeks already exist: ${conflicts.map(snapshot => snapshot.week.weekCommencing).join(", ")}. Remove them from the import before retrying.` } }, { status: 409 });
      const duplicateWeeks = snapshots.filter((snapshot, index) => snapshots.findIndex(candidate => candidate.week.weekCommencing === snapshot.week.weekCommencing) !== index);
      if (duplicateWeeks.length) return NextResponse.json({ error: { message: "Two selected workbooks use the same week. Remove one before importing." } }, { status: 409 });
      const catalogue = await listCanonicalMenuItems();
      const aliasesById: Record<string, string[]> = {};
      const prepared: RollingSnapshot[] = [];
      for (const source of snapshots) {
        try {
          const snapshot = applyDishResolutions(source, body.resolutions, catalogue);
          for (const resolution of body.resolutions) if (resolution.remember && resolution.canonicalId && !resolution.ignored) aliasesById[resolution.canonicalId] = [...(aliasesById[resolution.canonicalId] || []), resolution.sourceName];
          prepared.push(snapshot);
        } catch (error) { return NextResponse.json({ error: { message: `Week ${source.week.weekCommencing} could not be imported: ${error instanceof Error ? error.message : "Please review this week."}` } }, { status: 422 }); }
      }
      let saved: RollingSnapshot[];
      try { saved = await saveSnapshotsCreateOnly(prepared); } catch (error) { const status = (error as { status?: number }).status === 409 ? 409 : 422; return NextResponse.json({ error: { message: error instanceof Error ? error.message : "The menu weeks could not be imported." } }, { status }); }
      await recordDishSourceAliases(aliasesById);
      return NextResponse.json({ snapshots: saved, weeks: await listWeeks(), blockers: saved.flatMap(snapshot => validateWeek(snapshot)) });
    }
    const form = await request.formData();
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    if (!files.length) return NextResponse.json({ error: { message: "Choose one or more Excel files." } }, { status: 422 });
    let weekDates: Record<string, string> = {};
    try { weekDates = JSON.parse(String(form.get("weekDates") || "{}")) as Record<string, string>; } catch { /* Invalid overrides are treated as absent. */ }
    return NextResponse.json(await previewFiles(files, request, weekDates));
  } catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Workbook import failed." } }, { status: 400 }); }
}
