export type AllergenPageState = "loading" | "error" | "empty" | "ready";

export function allergenPageState(input: {
  date: string;
  projectionLoading: boolean;
  matrixLoading: boolean;
  projectionError: string;
  matrixError: string;
  orderCount: number;
}): AllergenPageState {
  if (!input.date || input.projectionLoading || input.matrixLoading) return "loading";
  if (input.projectionError || input.matrixError) return "error";
  return input.orderCount === 0 ? "empty" : "ready";
}
