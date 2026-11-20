import { NextResponse } from "next/server";
import { publicationBlockers } from "@/lib/domain";
import { getMenuSnapshot, runMenuCommand } from "@/lib/store";
import { actorCanWriteOneOff, requireMutationActor, requirePublicationActor, resolveMenuActor } from "@/lib/auth";
import { requireSharedMenuWriter } from "@/lib/menu-mutation-scope";

function fail(error: unknown) { return NextResponse.json({ error: { message: (error as Error).message } }, { status: (error as { status?: number }).status || 500 }); }

export async function GET(request: Request) {
  try {
    const actor = await resolveMenuActor(request);
    if (!actor.allOplocs) throw Object.assign(new Error("This legacy menu contains organisation-wide planning data."), { status: 403 });
    const snapshot = getMenuSnapshot();
    return NextResponse.json({ snapshot, blockers: publicationBlockers(snapshot) });
  } catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    const actor = requireMutationActor(await resolveMenuActor(request));
    requireSharedMenuWriter(actor);
    const command = await request.json();
    if (command.action === "inspect-workbook") return NextResponse.json({ message: "Use the workbook inspection endpoint with the file body." });
    if (command.action === "publish" || command.action === "approve-menu" || command.action === "new-revision") {
      requirePublicationActor(actor);
      if (!actorCanWriteOneOff(actor, "publish")) throw Object.assign(new Error("This legacy command requires organisation-wide Menu Publish authority."), { status: 403 });
    }
    const snapshot = runMenuCommand(command, actor.uid);
    return NextResponse.json({ snapshot, blockers: publicationBlockers(snapshot) });
  } catch (error) { return fail(error); }
}
