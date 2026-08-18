import { NextRequest, NextResponse } from "next/server";
import { addMenuSlot, createEntry, duplicateWeek, emptyWeek, getWeek, listWeeks, removeMenuSlot, saveSnapshot, updateEntry, validateWeek } from "@/lib/rolling-menu";

export async function GET(request: NextRequest) {
  const snapshot = getWeek(request.nextUrl.searchParams.get("weekId") || undefined);
  return NextResponse.json({ snapshot, weeks: listWeeks(), blockers: validateWeek(snapshot) });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    if (action === "create-week") {
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
    if (action === "publish") {
      const snapshot = getWeek(String(body.weekId)); const blockers = validateWeek(snapshot);
      if (blockers.length) return NextResponse.json({ error: { message: blockers.join(" ") } }, { status: 422 });
      snapshot.week.status = "published"; snapshot.week.version += 1; snapshot.week.audit.push({ action: "week-published", at: new Date().toISOString(), by: "local-menu-planner" });
      const saved = saveSnapshot(snapshot); return NextResponse.json({ snapshot: saved, weeks: listWeeks(), blockers: [] });
    }
    return NextResponse.json({ error: { message: "Unknown rolling menu command." } }, { status: 400 });
  } catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Rolling menu command failed." } }, { status: 400 }); }
}
