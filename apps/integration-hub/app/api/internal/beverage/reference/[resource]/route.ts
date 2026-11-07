import type { NextRequest } from "next/server";
import { OAuth2Client } from "google-auth-library";
import { getStorage } from "firebase-admin/storage";
import { decideBeverageRequestAuthority } from "@/lib/beverage-admission-request";
import { beverageReferenceConfig } from "@/lib/beverage-reference-config";
import { handleBeverageReference } from "@/lib/beverage-reference";
import { readBoundedBeverageObject } from "@/lib/beverage-reference-object";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const google = new OAuth2Client();

export async function GET(request: NextRequest, context: { params: Promise<{ resource: string }> }) {
  const config = beverageReferenceConfig();
  const { resource } = await context.params;
  return handleBeverageReference(request, resource, {
    config,
    async verifyCaller(idToken, audience) {
      return (await google.verifyIdToken({ idToken, audience })).getPayload();
    },
    decide: input => decideBeverageRequestAuthority(request, input),
    async readFoodObject(name, maxBytes) {
      if (!config?.food) throw new Error("Beverage Food Data is disabled.");
      const stream = getStorage().bucket(config.food.bucket).file(config.food.prefix + name).createReadStream({ decompress: false });
      return readBoundedBeverageObject(stream, maxBytes);
    },
  });
}
