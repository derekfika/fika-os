export type MenuPlanningReadBudget = {
  operation: string;
  reads: Record<string, number | string>;
  writes?: number | string;
};

/** Opt-in, low-cardinality diagnostics for staging/dev read-shape checks. */
export function recordMenuPlanningReadBudget(budget: MenuPlanningReadBudget) {
  if (process.env.MENU_PLANNING_READ_BUDGET === "1") console.info("Menu Planning read budget", budget);
}
