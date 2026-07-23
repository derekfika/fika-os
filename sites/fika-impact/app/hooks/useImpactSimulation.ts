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

function randomInteger(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function totalsForDrinks(drinks: number): ImpactTotals {
  return {
    drinks,
    groundsGrams: Math.round(drinks * IMPACT_CONFIG.coffeeDrinkShare * IMPACT_CONFIG.groundsPerCoffeeDrinkGrams),
    milkMl: Math.round(drinks * IMPACT_CONFIG.milkDrinkShare * IMPACT_CONFIG.milkAvoidedPerMilkDrinkMl),
    cups: drinks * IMPACT_CONFIG.cupAvoidedPerDrink,
    lids: drinks * IMPACT_CONFIG.lidAvoidedPerDrink,
  };
}

function randomOpeningDrinks() {
  const { min, max } = IMPACT_CONFIG.simulation.openingDrinks;
  return randomInteger(min, max);
}

function randomDrinkIncrement() {
  const roll = randomInteger(1, 100);
  if (roll <= 45) return 1;
  if (roll <= 70) return 2;
  if (roll <= 85) return 3;
  if (roll <= 95) return 4;
  return 5;
}

const STATIC_OPENING_DRINKS = 50;

export function useImpactSimulation() {
  const [totals, setTotals] = useState<ImpactTotals>(() => totalsForDrinks(STATIC_OPENING_DRINKS));
  const [events, setEvents] = useState<DemoTransaction[]>([
    transactionAt(2),
    transactionAt(1),
    transactionAt(0),
  ]);
  const [index, setIndex] = useState(3);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);

  const [ready, setReady] = useState(false);

  useEffect(() => {
    const initialise = window.setTimeout(() => {
      setTotals(totalsForDrinks(randomOpeningDrinks()));
      setReady(true);
    }, 0);
    return () => window.clearTimeout(initialise);
  }, []);

  useEffect(() => {
    if (paused || !ready) return;

    const interval = IMPACT_CONFIG.simulation.intervalMs;
    const delay = randomInteger(interval.min, interval.max) / speed;
    const timer = window.setTimeout(() => {
      const increment = randomDrinkIncrement();
      const batch = Array.from({ length: increment }, (_, offset) => transactionAt(index + offset));
      const coffeeDrinks = batch.filter((transaction) => transaction.coffee).length;
      const milkDrinks = batch.filter((transaction) => transaction.milk).length;

      setTotals((current) => ({
        drinks: current.drinks + increment,
        groundsGrams: current.groundsGrams + coffeeDrinks * IMPACT_CONFIG.groundsPerCoffeeDrinkGrams,
        milkMl: current.milkMl + milkDrinks * IMPACT_CONFIG.milkAvoidedPerMilkDrinkMl,
        cups: current.cups + increment * IMPACT_CONFIG.cupAvoidedPerDrink,
        lids: current.lids + increment * IMPACT_CONFIG.lidAvoidedPerDrink,
      }));
      setEvents((current) => [...batch].reverse().concat(current).slice(0, 3));
      setIndex((current) => current + increment);
    }, delay);

    return () => window.clearTimeout(timer);
  }, [index, paused, ready, speed]);

  const restart = useCallback(() => {
    setTotals(totalsForDrinks(randomOpeningDrinks()));
    setEvents([transactionAt(2), transactionAt(1), transactionAt(0)]);
    setIndex(3);
    setPaused(false);
  }, []);

  return { totals, events, paused, speed, setPaused, setSpeed, restart };
}
