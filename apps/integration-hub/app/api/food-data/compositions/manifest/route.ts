import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { handleCompositionManifest, liveFoodDataDeps } from "@/lib/food-data/service";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return withDataTrace({ app: "integration-hub", action: "food-data.compositions.manifest", path: new URL(request.url).pathname, dataset: "integration-hub/food-data-compositions-v2-manifest", requestId: request.headers.get("x-request-id") || undefined }, () => handleCompositionManifest(request, liveFoodDataDeps()));
}
