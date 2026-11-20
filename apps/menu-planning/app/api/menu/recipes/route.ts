import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { publicationBlockers } from "@/lib/domain";
import { getMenuSnapshot, runMenuCommand } from "@/lib/store";
import { requireMutationActor, resolveMenuActor } from "@/lib/auth";
import { requireSharedMenuWriter } from "@/lib/menu-mutation-scope";
type Candidate = Record<string, unknown> & { canonicalId: string; displayName: string };
async function loadCandidates(): Promise<Candidate[]> { const file = path.join(process.cwd(), "fixtures", "brian-recipe-candidates.json"); const data = JSON.parse(await readFile(file, "utf8")) as { candidates?: Candidate[] }; return (data.candidates || []).map(({ sourcePath, sourceParagraphs, ...candidate }) => candidate as Candidate); }
export async function GET() { try { const candidates = await loadCandidates(); return NextResponse.json({ source: "Brian regional recipe documents", candidates, count: candidates.length }); } catch (error) { return NextResponse.json({ error: { message: (error as Error).message } }, { status: 500 }); } }
export async function POST(request: Request) {
  try {
    const actor = requireMutationActor(await resolveMenuActor(request));
    requireSharedMenuWriter(actor);
    const body = await request.json() as { action?: string; candidateId?: string };
    if (body.action !== "import-all" && body.action !== "import-one") return NextResponse.json({ error: { message: "Choose a recipe candidate import action." } }, { status: 422 });
    const candidates = await loadCandidates();
    const selected = body.action === "import-one" ? candidates.filter(item => item.canonicalId === body.candidateId) : candidates;
    if (body.action === "import-one" && !selected.length) return NextResponse.json({ error: { message: "Recipe candidate was not found." } }, { status: 404 });
    for (const candidate of selected) runMenuCommand({ action: "import-recipe-candidate", importedCandidate: candidate as never }, actor.uid);
    const snapshot = getMenuSnapshot();
    return NextResponse.json({ imported: selected.length, snapshot, blockers: publicationBlockers(snapshot) });
  } catch (error) { return NextResponse.json({ error: { message: (error as Error).message } }, { status: (error as { status?: number }).status || 500 }); }
}
