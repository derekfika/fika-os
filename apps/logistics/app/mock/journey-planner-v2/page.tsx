import { Preview } from "./Preview";
import { SCENARIOS, type Scenario } from "./fixtures";

export const metadata = { title: "Journey Planner V3 design preview (fictional data)", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ scenario?: string; run?: string; chrome?: string; expand?: string }> }) {
  const params = await searchParams;
  const scenario = (SCENARIOS as readonly string[]).includes(params.scenario ?? "") ? (params.scenario as Scenario) : "full-day";
  return <Preview key={`${scenario}:${params.run ?? ""}:${params.expand ?? ""}`} initialScenario={scenario} initialRunId={params.run} hideChrome={params.chrome === "0"} initialExpandedKey={params.expand} />;
}
