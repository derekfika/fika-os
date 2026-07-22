"use client";

import { useMemo } from "react";
import { IMPACT_CONFIG } from "../config/impactConfig";
import { useImpactSimulation, type ImpactTotals } from "../hooks/useImpactSimulation";
import { ImpactPresentation } from "./ImpactPresentation";

export default function FikaImpact() {
  const simulation = useImpactSimulation();
  const monthTotals = useMemo(() => {
    const factor = IMPACT_CONFIG.timeframeFactors.month;
    return Object.fromEntries(
      Object.entries(simulation.totals).map(([key, value]) => [key, value * factor]),
    ) as ImpactTotals;
  }, [simulation.totals]);

  return <ImpactPresentation simulation={simulation} monthTotals={monthTotals} />;
}
