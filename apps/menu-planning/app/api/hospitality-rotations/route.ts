import { forwardRotations } from "@/lib/hospitality-rotations-hub";
import { requireOrganisationMutationActor, resolveMenuActor } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) { return forwardRotations(request, "GET"); }
export async function POST(request: Request) {
  try {
    requireOrganisationMutationActor(await resolveMenuActor(request));
    return forwardRotations(request, "POST");
  } catch (error) {
    return Response.json({ error: { message: (error as Error).message } }, { status: (error as { status?: number }).status || 503 });
  }
}
