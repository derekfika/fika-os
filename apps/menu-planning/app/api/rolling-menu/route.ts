import { NextRequest, NextResponse } from "next/server";
import { addMenuSlot, assertWeekDateAvailable, cleanDuplicateEntries, createEntry, duplicateWeek, emptyWeek, getWeek, listWeeks, publishWeek, removeMenuSlot, saveSnapshot, updateEntry, validateWeek } from "@/lib/rolling-menu";

export async function GET(request: NextRequest) {
  const snapshot = getWeek(request.nextUrl.searchParams.get("weekId") || undefined);
  return NextResponse.json({ snapshot, weeks: listWeeks(), blockers: validateWeek(snapshot) });
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
      const snapshot = getWeek(String(body.weekId)); const blockers = validateWeek(snapshot);
      if (snapshot.week.status === "published") return NextResponse.json({ error: { message: "This menu week is already published." } }, { status: 409 });
      if (blockers.length) return NextResponse.json({ error: { message: blockers.join(" ") } }, { status: 422 });
      const saved = publishWeek(String(body.weekId)); return NextResponse.json({ snapshot: saved, weeks: listWeeks(), blockers: [] });
    }
    return NextResponse.json({ error: { message: "Unknown rolling menu command." } }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Rolling menu command failed." } }, { status: 400 }); }
}
