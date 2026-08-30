export type DeliveredInReadBudget = {
  stage: string;
  canonicalOrderDocs?: number;
  serviceDate?: string;
  knownId?: boolean;
};

export function recordDeliveredInReadBudget(input: DeliveredInReadBudget) {
  if (process.env.DELIVERED_IN_READ_BUDGET !== "1") return;
  console.info(JSON.stringify({ type: "integration_hub_delivered_in_read_budget", ...input }));
}
