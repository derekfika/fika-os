import type { NextRequest } from "next/server";
import { createAllergenAuthorityStore } from "./allergen-authority-store";
import type { ReuseOrchestrationDeps } from "./allergen-reuse-orchestrator";
import { emitCpuPlanChange } from "./cpu-plan-change-effects";
import { productionOrderDetail } from "./production-http-client";
import { createProductionPlanRepository } from "./production-plan-repository";

/** Production wiring of the reuse orchestration for internal (outbox / reconciliation) entry points. */
export function reuseRuntimeDeps(request: NextRequest): ReuseOrchestrationDeps {
  return {
    plans: createProductionPlanRepository(),
    store: createAllergenAuthorityStore(),
    loadOrder: async orderId => (await productionOrderDetail(request, orderId)) ?? undefined,
    emit: input => emitCpuPlanChange(request, input),
  };
}
