export type DeliveredInAppReadBudget = {
  stage: string;
  upstreamRequests?: number;
  recordsInspected?: number;
  cache?: "hit" | "miss";
  serviceDate?: string;
  oplocId?: string;
  knownId?: boolean;
};

export function recordDeliveredInAppReadBudget(input: DeliveredInAppReadBudget) {
  if (process.env.DELIVERED_IN_APP_READ_BUDGET !== "1") return;
  console.info(JSON.stringify({ type: "delivered_in_app_read_budget", ...input }));
}
