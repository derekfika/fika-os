export type AdHocReadBudget = {
  stage: string;
  requestDocs?: number;
  serviceDateStart?: string;
  serviceDateEndExclusive?: string;
  knownId?: boolean;
};

export function recordAdHocReadBudget(input: AdHocReadBudget) {
  if (process.env.AD_HOC_PRODUCTION_READ_BUDGET !== "1") return;
  console.info(JSON.stringify({ type: "ad_hoc_production_read_budget", ...input }));
}
