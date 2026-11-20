import { OAuth2Client } from "google-auth-library";
import { handleStagedStudioDishReview } from "../../../../lib/studio-dish-review-staging";
import { StudioDishReviewStore } from "../../../../lib/studio-dish-review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const google = new OAuth2Client();

export async function POST(request: Request) {
  return handleStagedStudioDishReview(request, {
    env: process.env,
    async verifyCaller(idToken, audience) {
      return (await google.verifyIdToken({ idToken, audience })).getPayload();
    },
    async store() {
      const { db } = await import("../../../../lib/firebase-admin");
      return new StudioDishReviewStore(db);
    },
  });
}
