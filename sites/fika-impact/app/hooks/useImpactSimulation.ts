"use client";

import { useCallback, useEffect, useState } from "react";
import { IMPACT_CONFIG, type Speed } from "../config/impactConfig";
import { transactionAt, type DemoTransaction } from "../data/demoTransactions";

export type ImpactTotals = {
  drinks: number;
  groundsGrams: number;
  milkMl: number;
  cups: number;
  lids: number;
};

export function useImpactSimulation() {
  const [totals, setTotals] = useState<ImpactTotals>({ ...IMPACT_CONFIG.openingTotals });
  const [events, setEvents] = useState<DemoTransaction[]>([
    transactionAt(2),
    transactionAt(1),
    transactionAt(0),
  ]);
  const [index, setIndex] = useState(3);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<Speed>(10);

  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => {
      const transaction = transactionAt(index);
      setTotals((current) => ({
        drinks: current.drinks + 1,
        groundsGrams:
          current.groundsGrams +
          (transaction.coffee ? IMPACT_CONFIG.groundsPerCoffeeDrinkGrams : 0),
        milkMl:
          current.milkMl +
          (transaction.milk ? IMPACT_CONFIG.milkAvoidedPerMilkDrinkMl : 0),
        cups: current.cups + IMPACT_CONFIG.cupAvoidedPerDrink,
        lids: current.lids + IMPACT_CONFIG.lidAvoidedPerDrink,
      }));
      setEvents((current) => [transaction, ...current].slice(0, 3));
      setIndex((current) => current + 1);
    }, IMPACT_CONFIG.baseIntervalMs / speed);
    return () => window.clearTimeout(timer);
  }, [index, paused, speed]);

  const restart = useCallback(() => {
    setTotals({ ...IMPACT_CONFIG.openingTotals });
    setEvents([transactionAt(2), transactionAt(1), transactionAt(0)]);
    setIndex(3);
    setPaused(false);
  }, []);

  return { totals, events, paused, speed, setPaused, setSpeed, restart };
}
