import { readRollingState, updateRollingState } from "./operational-store";

export type LegacyMenuPlan = {
  id: string;
  name: string;
  weekStarting: string;
  weeks: Array<{ weekStarting: string; days: Array<{ date: string; day: string; entries: Array<Record<string, unknown>> }> }>;
  sourceImports?: Array<{ fileName: string; importedAt: string; candidateCount: number; sheets: string[] }>;
  updatedAt: string;
};
type LegacyPlanState = { legacyMenuPlans?: LegacyMenuPlan[] };
export function listLegacyMenuPlans() { return (readRollingState<LegacyPlanState>().legacyMenuPlans || []).map(plan => structuredClone(plan)); }
export function saveLegacyMenuPlan(plan: LegacyMenuPlan) { updateRollingState<LegacyPlanState>(state => { state.legacyMenuPlans = [...(state.legacyMenuPlans || []).filter(item => item.id !== plan.id), structuredClone(plan)]; }); return structuredClone(plan); }
