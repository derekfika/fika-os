import { NextRequest, NextResponse } from "next/server";
import { addMenuSlot, assertWeekDateAvailable, cleanDuplicateEntries, createEntry, duplicateWeek, emptyWeek, getWeek, listWeeks, removeMenuSlot, saveSnapshot, updateEntry, validateWeek } from "@/lib/rolling-menu";
import { archivePublishedDayMatrix, createPublishedMenuDay, getMenuPublication, publicationDayBlockers, publicationPreview, type MenuPublicationSignoff } from "@/lib/menu-publication";

export async function GET(request: NextRequest) {
  const snapshot = getWeek(request.nextUrl.searchParams.get("weekId") || undefined);
  const previewDayId = request.nextUrl.searchParams.get("dayId") || undefined;
  return NextResponse.json({ snapshot, weeks: listWeeks(), blockers: validateWeek(snapshot), ...(request.nextUrl.searchParams.get("publicationPreview") === "true" ? { publicationPreview: publicationPreview(snapshot, previewDayId), dayBlockers: previewDayId ? publicationDayBlockers(snapshot, previewDayId) : [] } : {}) });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    if (action === "create-week") {
      assertWeekDateAvailable(String(body.weekCommencing));
      const snapshot = saveSnapshot(emptyWeek(String(body.weekCommencing), "local-menu-planner"));
      return NextResponse.json({ snapshot, weeks: listWeeks(), blockers: validateWeek(snapshot) });
    }
    if (action === "duplicate-week") {
      const snapshot = duplicateWeek(String(body.weekId), String(body.weekCommencing));
      return NextResponse.json({ snapshot, weeks: listWeeks(), blockers: validateWeek(snapshot) });
    }
    if (action === "update-entry") {
      const snapshot = updateEntry(String(body.weekId), String(body.entryId), (body.patch || {}) as never);
      return NextResponse.json({ snapshot, weeks: listWeeks(), blockers: validateWeek(snapshot) });
    }
    if (action === "create-entry") {
      const snapshot = createEntry(String(body.weekId), String(body.dayId), String(body.slot) as never, String(body.itemLabel || ""), "local-menu-planner", body.itemId ? String(body.itemId) : undefined);
      return NextResponse.json({ snapshot, weeks: listWeeks(), blockers: validateWeek(snapshot) });
    }
    if (action === "add-menu-slot") {
      const snapshot = addMenuSlot(String(body.weekId), String(body.slot || ""));
      return NextResponse.json({ snapshot, weeks: listWeeks(), blockers: validateWeek(snapshot) });
    }
    if (action === "remove-menu-slot") {
      const snapshot = removeMenuSlot(String(body.weekId), String(body.slot || ""));
      return NextResponse.json({ snapshot, weeks: listWeeks(), blockers: validateWeek(snapshot) });
    }
    if (action === "clean-duplicate-entries") {
      const result = cleanDuplicateEntries(String(body.weekId));
      return NextResponse.json({ snapshot: result.snapshot, removed: result.removed, weeks: listWeeks(), blockers: validateWeek(result.snapshot) });
    }
    if (action === "publish") {
      const snapshot = getWeek(String(body.weekId));
      const dayId = String(body.dayId || "");
      const publication = createPublishedMenuDay(String(body.weekId), dayId, (body.signoff || {}) as MenuPublicationSignoff);
      const publishedDay = publication.days.find(day => day.sourceDayId === dayId && day.status === "published");
      if (publishedDay) await archivePublishedDayMatrix(publication.publicationId, publishedDay.publicationDayId);
      const saved = getWeek(String(body.weekId)); return NextResponse.json({ snapshot: saved, publication: getMenuPublication(publication.publicationId), weeks: listWeeks(), blockers: validateWeek(snapshot) });
    }
    return NextResponse.json({ error: { message: "Unknown rolling menu command." } }, { status: 400 });
  } catch (error) { const status = error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 400; return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Rolling menu command failed." } }, { status }); }
}
