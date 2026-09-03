import { NextResponse } from "next/server";
import { getCompiledPublicationSnapshot } from "@/lib/menu-publication";
import { actorCanAccessOploc, resolveMenuActor } from "@/lib/auth";

export async function GET(request: Request, { params }: { params: Promise<{ publicationId: string }> }) {
  try {
    const actor = await resolveMenuActor(request as never);
    const { publicationId } = await params;
    const versionValue = new URL(request.url).searchParams.get("version");
    const version = versionValue ? Number(versionValue) : undefined;
    if (versionValue && (!Number.isInteger(version) || version! < 1)) return NextResponse.json({ error: { message: "Publication snapshot version must be a positive integer." } }, { status: 400 });
    const snapshot = await getCompiledPublicationSnapshot(decodeURIComponent(publicationId), version);
    if (!snapshot) return NextResponse.json({ error: { message: "Publication snapshot was not found." } }, { status: 404 });
    if (!actor.allOplocs) {
      snapshot.days = snapshot.days.map(day => ({
        ...day,
        entries: day.entries.map(entry => ({ ...entry, allocations: entry.allocations.filter(allocation => actorCanAccessOploc(actor, allocation.destinationId)) })).filter(entry => entry.allocations.length > 0 || entry.allocations.length === day.entries.find(candidate => candidate.sourceEntryId === entry.sourceEntryId)?.allocations.length),
      })).filter(day => day.entries.length > 0);
      // Recompute the exposed hash after redaction; the organisation-wide hash
      // must not be presented as if it covered this scoped representation.
      snapshot.contentHash = "scoped-redacted";
    }
    return NextResponse.json({ snapshot });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error && typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500;
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Publication snapshot could not be loaded." } }, { status });
  }
}
