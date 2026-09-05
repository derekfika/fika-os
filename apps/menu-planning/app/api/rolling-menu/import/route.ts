import { NextRequest, NextResponse } from "next/server";
import { importWorkbook, saveSnapshot, listWeeks, validateWeek } from "@/lib/rolling-menu";
import { readDeliveredInOplocs } from "@/lib/oploc-authority";
import { listCanonicalMenuItems, recordDishSourceAliases } from "@/lib/canonical-menu-repository";
import { applyDishResolutions, parseWorkbookWeekCommencing, resolveDishNames } from "@/lib/legacy-week-importer";
import type { RollingSnapshot } from "@/lib/rolling-menu-types";

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await request.json() as { action?: string; snapshot?: RollingSnapshot; resolutions?: Array<{ sourceName: string; canonicalId?: string; ignored?: boolean; remember?: boolean }> };
      if (body.action !== "commit" || !body.snapshot || !body.resolutions) return NextResponse.json({ error: { message: "Please complete the dish review before importing." } }, { status: 422 });
      const existing = (await listWeeks()).find(week => week.weekCommencing === body.snapshot!.week.weekCommencing);
      if (existing) return NextResponse.json({ error: { message: existing.status === "published" ? "This week has already been published and cannot be overwritten." : "This week already exists. Choose a different week or review it in Week Planner before importing again." } }, { status: 409 });
      const catalogue = await listCanonicalMenuItems();
      const snapshot = applyDishResolutions(body.snapshot, body.resolutions, catalogue);
      const aliasesById: Record<string, string[]> = {};
      for (const resolution of body.resolutions) if (resolution.remember && resolution.canonicalId && !resolution.ignored) aliasesById[resolution.canonicalId] = [...(aliasesById[resolution.canonicalId] || []), resolution.sourceName];
      await recordDishSourceAliases(aliasesById);
      const saved = await saveSnapshot(snapshot);
      return NextResponse.json({ snapshot: saved, weeks: await listWeeks(), blockers: validateWeek(saved) });
    }
    const name = request.headers.get("x-workbook-name") || "uploaded-workbook.xlsx";
    const weekCommencing = parseWorkbookWeekCommencing(name);
    if (!weekCommencing) return NextResponse.json({ error: { message: "We couldn't find a clear Monday week date in that filename. Rename it like WC 31_08_2026.xlsx or choose the week date before trying again." } }, { status: 422 });
    const result = importWorkbook(Buffer.from(await request.arrayBuffer()), name, "historical-importer", await readDeliveredInOplocs(request), weekCommencing);
    if (!result.recognisedEntries) return NextResponse.json({ error: { message: "We couldn't read this spreadsheet. Please check it uses the usual weekly menu format." } }, { status: 422 });
    const catalogue = await listCanonicalMenuItems();
    const resolutions = resolveDishNames(result.snapshot.entries.map(entry => entry.itemLabel), catalogue);
    return NextResponse.json({ snapshot: result.snapshot, resolutions, weeks: await listWeeks(), warnings: result.warnings, recognisedEntries: result.recognisedEntries, catalogue: catalogue.filter(item => item.reviewStatus !== "archived").map(item => ({ id: item.canonicalId, name: item.displayName })) });
  } catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Workbook import failed." } }, { status: 400 }); }
}
