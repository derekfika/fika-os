"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { IMPACT_CONFIG } from "../config/impactConfig";
import { useImpactSimulation, type ImpactTotals } from "../hooks/useImpactSimulation";
import { DemoControls } from "./DemoControls";
import { ImpactFooter } from "./ImpactFooter";
import { ImpactHeader } from "./ImpactHeader";
import { ImpactHero } from "./ImpactHero";
import { ImpactMethod } from "./ImpactMethod";
import { ImpactOverview } from "./ImpactOverview";
import { LiveServiceFeed } from "./LiveServiceFeed";
import { ProjectionSection } from "./ProjectionSection";
import { TangibleImpact } from "./TangibleImpact";

export default function FikaImpact() {
  const [controlsVisible, setControlsVisible] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "1",
  );
  const { totals, events, paused, speed, setPaused, setSpeed, restart } = useImpactSimulation();
  const monthTotals = useMemo(() => {
    const factor = IMPACT_CONFIG.timeframeFactors.month;
    return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value * factor])) as ImpactTotals;
  }, [totals]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "d") setControlsVisible((visible) => !visible);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <main className="impact-app">
      <div className="hero-shell section-shell">
        <ImpactHeader />
        <ImpactHero totals={totals} />
      </div>
      <LiveServiceFeed events={events} />
      <ImpactOverview totals={totals} />
      <ImpactMethod />
      <TangibleImpact cups={totals.cups} />
      <ProjectionSection totals={monthTotals} />
      <ImpactFooter />

      <button className="control-reveal" type="button" aria-label="Reveal demonstration controls" onClick={() => setControlsVisible((visible) => !visible)} />
      <AnimatePresence>
        {controlsVisible && (
          <motion.div className="demo-controls-wrap" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
            <DemoControls paused={paused} speed={speed} onPause={() => setPaused(!paused)} onRestart={restart} onSpeed={setSpeed} onClose={() => setControlsVisible(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
