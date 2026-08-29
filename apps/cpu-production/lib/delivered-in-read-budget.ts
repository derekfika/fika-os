export type DeliveredInReadBudget = {
  stage: string;
  canonicalOrderDocs?: number;
  planDocs?: number;
  projectionDocs?: number;
  selectedIds?: number;
  rebuildScopes?: number;
};

export function recordDeliveredInReadBudget(input: DeliveredInReadBudget) {
  if (process.env.DELIVERED_IN_READ_BUDGET !== "1") return;
  console.info(JSON.stringify({ type: "delivered_in_read_budget", ...input }));
}
