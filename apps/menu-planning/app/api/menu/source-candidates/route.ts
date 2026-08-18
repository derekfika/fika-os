import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { promoteSourceCandidate } from "@/lib/canonical-menu-repository";
import { listCandidateReviews, setCandidateReview } from "@/lib/source-candidate-repository";
import type { MenuItem } from "@/lib/domain";

async function candidates() {
  const file = path.join(process.cwd(), "fixtures", "brian-recipe-candidates.json");
  const data = JSON.parse(await readFile(file, "utf8")) as { candidates?: MenuItem[] };
  return data.candidates || [];
}

export async function GET() {
  const [items, reviews] = await Promise.all([candidates(), listCandidateReviews()]);
  const byId = new Map(reviews.map((review) => [review.candidateId, review]));
  return NextResponse.json({ candidates: items.map((item) => ({ ...item, review: byId.get(item.canonicalId) || { state: "unreviewed" } })) });
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { action?: "promote" | "ignore"; candidateId?: string; reason?: string };
    if (!body.candidateId || !body.action) return NextResponse.json({ error: { message: "Candidate and review action are required." } }, { status: 422 });
    const item = (await candidates()).find((candidate) => candidate.canonicalId === body.candidateId);
    if (!item) return NextResponse.json({ error: { message: "Source candidate was not found." } }, { status: 404 });
    if (body.action === "promote") {
      const canonical = await promoteSourceCandidate(item);
      const review = await setCandidateReview(item.canonicalId, "promoted");
      return NextResponse.json({ canonical, review });
    }
    const review = await setCandidateReview(item.canonicalId, "ignored", body.reason);
    return NextResponse.json({ review });
  } catch (error) { return NextResponse.json({ error: { message: (error as Error).message } }, { status: 500 }); }
}

