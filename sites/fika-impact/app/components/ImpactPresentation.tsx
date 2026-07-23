"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Speed } from "../config/impactConfig";
import type { DemoTransaction } from "../data/demoTransactions";
import type { ImpactTotals } from "../hooks/useImpactSimulation";
import { DemoControls } from "./DemoControls";
import { ImpactMethodView, ImpactTodayView, LivePulseView, LiveServiceView, TangibleImpactView } from "./PresentationViews";
import { PresentationFrame } from "./PresentationFrame";

const VIEW_DURATIONS = [12_000, 14_000, 12_000, 14_000, 12_000] as const;
const VIEW_TONES = ["purple", "ink", "ink", "purple", "ink"] as const;

type Simulation = {
  totals: ImpactTotals;
  events: DemoTransaction[];
  paused: boolean;
  speed: Speed;
  setPaused: (paused: boolean) => void;
  setSpeed: (speed: Speed) => void;
  restart: () => void;
};

export function ImpactPresentation({ simulation, monthTotals }: { simulation: Simulation; monthTotals: ImpactTotals }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [rotationPaused, setRotationPaused] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const pointerStart = useRef<number | null>(null);
  const reducedMotion = useReducedMotion();
  const totalViews = VIEW_DURATIONS.length;

  const goTo = useCallback((index: number) => setActiveIndex((index + totalViews) % totalViews), [totalViews]);
  const next = useCallback(() => setActiveIndex((current) => (current + 1) % totalViews), [totalViews]);
  const previous = useCallback(() => setActiveIndex((current) => (current - 1 + totalViews) % totalViews), [totalViews]);
  const restartPresentation = useCallback(() => { setActiveIndex(0); setRotationPaused(false); }, []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("demo") !== "1") return;
    const revealControls = window.setTimeout(() => setControlsVisible(true), 0);
    return () => window.clearTimeout(revealControls);
  }, []);

  useEffect(() => {
    if (rotationPaused) return;
    const timer = window.setTimeout(next, VIEW_DURATIONS[activeIndex]);
    return () => window.clearTimeout(timer);
  }, [activeIndex, next, rotationPaused]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("button, input, select, textarea, [contenteditable='true']")) return;
      if (event.key.toLowerCase() === "d") setControlsVisible((visible) => !visible);
      if (event.key === "ArrowLeft") previous();
      if (event.key === "ArrowRight") next();
      if (event.code === "Space") { event.preventDefault(); setRotationPaused((paused) => !paused); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [next, previous]);

  const views = [
    <LiveServiceView key="live" totals={simulation.totals} />,
    <ImpactTodayView key="today" totals={simulation.totals} />,
    <ImpactMethodView key="method" />,
    <TangibleImpactView key="tangible" totals={simulation.totals} monthTotals={monthTotals} />,
    <LivePulseView key="pulse" events={simulation.events} totals={simulation.totals} />,
  ];

  return (
    <PresentationFrame activeIndex={activeIndex} total={totalViews} tone={VIEW_TONES[activeIndex]} onRevealControls={() => setControlsVisible((visible) => !visible)}>
      <div
        className="view-swipe-surface"
        onPointerDown={(event) => { pointerStart.current = event.clientX; }}
        onPointerUp={(event) => {
          if (pointerStart.current === null) return;
          const distance = event.clientX - pointerStart.current;
          if (Math.abs(distance) > 55) {
            if (distance > 0) previous();
            else next();
          }
          pointerStart.current = null;
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeIndex}
            className="view-transition"
            variants={{
              hidden: { opacity: 0, x: reducedMotion ? 0 : 32 },
              visible: { opacity: 1, x: 0, transition: { duration: reducedMotion ? 0.2 : 0.72, ease: [0.22, 1, 0.36, 1], staggerChildren: reducedMotion ? 0 : 0.08 } },
              exit: { opacity: 0, x: reducedMotion ? 0 : -24, transition: { duration: reducedMotion ? 0.15 : 0.45 } },
            }}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            {views[activeIndex]}
          </motion.div>
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {controlsVisible && (
          <motion.div className="demo-controls-wrap" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }}>
            <DemoControls
              paused={simulation.paused}
              rotationPaused={rotationPaused}
              speed={simulation.speed}
              activeIndex={activeIndex}
              totalViews={totalViews}
              onPauseSimulation={() => simulation.setPaused(!simulation.paused)}
              onPauseRotation={() => setRotationPaused((paused) => !paused)}
              onRestartSimulation={simulation.restart}
              onRestartPresentation={restartPresentation}
              onPrevious={previous}
              onNext={next}
              onView={goTo}
              onSpeed={simulation.setSpeed}
              onClose={() => setControlsVisible(false)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </PresentationFrame>
  );
}
