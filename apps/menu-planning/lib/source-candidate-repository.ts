import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertOperationalStoreAvailable } from "./hosted-runtime";

export type CandidateReviewState = "unreviewed" | "ignored" | "promoted";
export type CandidateReview = { candidateId: string; state: CandidateReviewState; reason?: string; reviewedAt: string; reviewedBy: string };
const filePath = path.join(process.cwd(), "local-data", "menu-planning", "source-candidate-reviews.json");

async function readReviews(): Promise<CandidateReview[]> {
  assertOperationalStoreAvailable();
  try { const value = JSON.parse(await readFile(filePath, "utf8")) as { reviews?: CandidateReview[] }; return Array.isArray(value.reviews) ? value.reviews : []; } catch { return []; }
}
async function writeReviews(reviews: CandidateReview[]) { assertOperationalStoreAvailable(); await mkdir(path.dirname(filePath), { recursive: true }); await writeFile(filePath, JSON.stringify({ version: 1, reviews }, null, 2) + "\n", "utf8"); }

export async function listCandidateReviews() { return readReviews(); }
export async function setCandidateReview(candidateId: string, state: CandidateReviewState, reason?: string, reviewedBy = "local-menu-reviewer") {
  const reviews = await readReviews();
  const next = { candidateId, state, reason, reviewedAt: new Date().toISOString(), reviewedBy };
  const index = reviews.findIndex((review) => review.candidateId === candidateId);
  if (index >= 0) reviews[index] = next; else reviews.push(next);
  await writeReviews(reviews);
  return next;
}
