import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { handleFoodDataManifest, liveFoodDataDeps } from "@/lib/food-data/service";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return withDataTrace({ app: "integration-hub", action: "food-data.manifest", path: new URL(request.url).pathname, dataset: "integration-hub/food-data-manifest", requestId: request.headers.get("x-request-id") || undefined }, () => handleFoodDataManifest(request, liveFoodDataDeps()));
}
