export const IMPACT_CONFIG = {
  groundsPerCoffeeDrinkGrams: 18,
  milkAvoidedPerMilkDrinkMl: 20,
  cupAvoidedPerDrink: 1,
  lidAvoidedPerDrink: 1,
  milkDrinkShare: 0.72,
  openingTotals: {
    drinks: 428,
    groundsGrams: 6_822,
    milkMl: 6_160,
    cups: 428,
    lids: 428,
  },
  timeframeFactors: {
    today: 1,
    month: 18.4,
    annual: 247,
  },
  baseIntervalMs: 14_000,
} as const;

export type Timeframe = keyof typeof IMPACT_CONFIG.timeframeFactors;
export type Speed = 1 | 5 | 10;
