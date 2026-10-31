import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { handleFoodDataBundle, liveFoodDataDeps } from "@/lib/food-data/service";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ dataset: string }> }) {
  const { dataset } = await context.params;
  return withDataTrace({ app: "integration-hub", action: `food-data.bundle.${dataset}`, path: new URL(request.url).pathname, dataset: "integration-hub/food-data-bundle", requestId: request.headers.get("x-request-id") || undefined }, () => handleFoodDataBundle(request, dataset, liveFoodDataDeps()));
}
