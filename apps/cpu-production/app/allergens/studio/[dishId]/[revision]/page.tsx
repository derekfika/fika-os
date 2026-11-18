import StudioDishChecker from "./studio-dish-checker";

export default async function StudioDishCheckerPage({ params }: { params: Promise<{ dishId: string; revision: string }> }) {
  const { dishId, revision } = await params;
  return <StudioDishChecker key={`${dishId}:${revision}`} endpoint={`/api/studio-dish-review/${encodeURIComponent(dishId)}/${encodeURIComponent(revision)}`} />;
}
