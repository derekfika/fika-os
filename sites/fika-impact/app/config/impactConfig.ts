export const IMPACT_CONFIG = {
  groundsPerCoffeeDrinkGrams: 18,
  milkAvoidedPerMilkDrinkMl: 20,
  cupAvoidedPerDrink: 1,
  lidAvoidedPerDrink: 1,
  milkDrinkShare: 0.72,
  coffeeDrinkShare: 0.88,
  simulation: {
    openingDrinks: { min: 30, max: 70 },
    increment: { min: 1, max: 5 },
    intervalMs: { min: 1_500, max: 5_000 },
  },
  timeframeFactors: {
    today: 1,
    month: 18.4,
    annual: 247,
  },
} as const;

export type Timeframe = keyof typeof IMPACT_CONFIG.timeframeFactors;
export type Speed = 1 | 5 | 10;
