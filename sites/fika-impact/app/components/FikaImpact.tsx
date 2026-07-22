"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownRight,
  Coffee,
  Droplets,
  Gauge,
  Leaf,
  Pause,
  Play,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { IMPACT_CONFIG, type Speed } from "../config/impactConfig";
import type { DemoTransaction } from "../data/demoTransactions";
import { useImpactSimulation, type ImpactTotals } from "../hooks/useImpactSimulation";

const formatImpact = (value: number, type: "mass" | "volume" | "count") => {
  if (type === "mass") {
    if (value >= 1000) return { value: (value / 1000).toFixed(value >= 10_000 ? 1 : 2), unit: "kg" };
    return { value: Math.round(value).toLocaleString("en-GB"), unit: "g" };
  }
  if (type === "volume") {
    if (value >= 1000) return { value: (value / 1000).toFixed(value >= 10_000 ? 1 : 2), unit: "litres" };
    return { value: Math.round(value).toLocaleString("en-GB"), unit: "ml" };
  }
  return { value: Math.round(value).toLocaleString("en-GB"), unit: "items" };
};

function AnimatedNumber({ value, unit }: { value: string; unit: string }) {
  return (
    <span className="metric-number-wrap" aria-label={`${value} ${unit}`}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          className="metric-number"
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -10, opacity: 0, position: "absolute" }}
          transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
      <span className="metric-unit">{unit}</span>
    </span>
  );
}

const metricDefinitions = [
  {
    key: "groundsGrams" as const,
    label: "Coffee grounds recovered",
    description: "Collected for reuse rather than treated as general waste.",
    icon: Coffee,
    type: "mass" as const,
    index: "01",
  },
  {
    key: "milkMl" as const,
    label: "Milk waste avoided",
    description: "Precision dispensing reduces excess milk prepared during service.",
    icon: Droplets,
    type: "volume" as const,
    index: "02",
  },
  {
    key: "cups" as const,
    label: "Paper cups avoided",
    description: "Reusable serviceware replaces single-use paper cups.",
    icon: Gauge,
    type: "count" as const,
    index: "03",
  },
  {
    key: "lids" as const,
    label: "Plastic lids avoided",
    description: "Reusable serviceware removes the need for disposable plastic lids.",
    icon: Sparkles,
    type: "count" as const,
    index: "04",
  },
];

function ImpactMetric({ definition, totals }: { definition: (typeof metricDefinitions)[number]; totals: ImpactTotals }) {
  const Icon = definition.icon;
  const formatted = formatImpact(totals[definition.key], definition.type);
  return (
    <motion.article
      className="impact-metric"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Number(definition.index) * 0.06, duration: 0.6 }}
    >
      <div className="metric-heading">
        <span className="metric-index">{definition.index}</span>
        <Icon size={19} strokeWidth={1.5} aria-hidden="true" />
      </div>
      <AnimatedNumber value={formatted.value} unit={formatted.unit} />
      <h2>{definition.label}</h2>
      <p>{definition.description}</p>
    </motion.article>
  );
}

function EventRow({ event, latest }: { event: DemoTransaction; latest: boolean }) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: latest ? 1 : 0.54, y: 0 }}
      exit={{ opacity: 0, y: 12 }}
      transition={{ duration: 0.45 }}
    >
      <span className="event-pulse" aria-hidden="true" />
      <div className="event-copy">
        <strong>{event.drink} served</strong>
        <span>
          {event.coffee && `+${IMPACT_CONFIG.groundsPerCoffeeDrinkGrams} g grounds`}
          {event.coffee && event.milk && " · "}
          {event.milk && `+${IMPACT_CONFIG.milkAvoidedPerMilkDrinkMl} ml milk`}
          {!event.coffee && "Reusable cup and lid"}
        </span>
      </div>
      <span className="event-avoided">Cup + lid avoided</span>
    </motion.li>
  );
}

function LiveTransactionFeed({ events }: { events: DemoTransaction[] }) {
  return (
    <section className="live-feed" aria-labelledby="live-feed-title">
      <div className="section-label">
        <span id="live-feed-title">Live service</span>
        <span className="live-dot"><i /> receiving</span>
      </div>
      <ul>
        <AnimatePresence initial={false}>
          {events.slice(0, 2).map((event, index) => <EventRow key={event.id} event={event} latest={index === 0} />)}
        </AnimatePresence>
      </ul>
    </section>
  );
}

function ScaleVisual({ cups }: { cups: number }) {
  const dailyEquivalent = Math.max(1, Math.round(cups / 250));
  return (
    <section className="scale-visual" aria-labelledby="scale-title">
      <div className="scale-copy">
        <span className="eyebrow">Impact, made tangible</span>
        <h2 id="scale-title">Small choices, repeated across every service.</h2>
        <p>That is roughly <strong>{dailyEquivalent} full stacks</strong> of takeaway cups never used.</p>
      </div>
      <div className="cup-stack" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((item) => (
          <motion.div
            key={item}
            className="cup-outline"
            initial={{ x: 18, opacity: 0 }}
            animate={{ x: item * -16, opacity: 1 - item * 0.13 }}
            transition={{ delay: item * 0.08, duration: 0.5 }}
          />
        ))}
      </div>
    </section>
  );
}

function DemoControls({ paused, speed, onPause, onRestart, onSpeed }: {
  paused: boolean;
  speed: Speed;
  onPause: () => void;
  onRestart: () => void;
  onSpeed: (speed: Speed) => void;
}) {
  return (
    <aside className="demo-controls" aria-label="Demonstration controls">
      <button type="button" onClick={onPause} aria-label={paused ? "Resume demonstration" : "Pause demonstration"}>
        {paused ? <Play size={14} /> : <Pause size={14} />}
      </button>
      <button type="button" onClick={onRestart} aria-label="Restart demonstration"><RefreshCw size={14} /></button>
      <div className="speed-options" aria-label="Demonstration speed">
        {([1, 5, 10] as Speed[]).map((option) => (
          <button key={option} type="button" className={speed === option ? "selected" : ""} onClick={() => onSpeed(option)} aria-label={`Set speed to ${option} times`}>
            {option}×
          </button>
        ))}
      </div>
    </aside>
  );
}

export default function FikaImpact() {
  const [story, setStory] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(false);
  const { totals, events, paused, speed, setPaused, setSpeed, restart } = useImpactSimulation();
  const monthTotals = useMemo(() => {
    const factor = IMPACT_CONFIG.timeframeFactors.month;
    return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, value * factor])) as ImpactTotals;
  }, [totals]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("demo") === "1") setControlsVisible(true);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "d") setControlsVisible((visible) => !visible);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setStory((current) => (current + 1) % 3), 12_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <main className="impact-app">
      <div className="ambient ambient-one" aria-hidden="true" />
      <div className="ambient ambient-two" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="#top" aria-label="FIKA Impact home">
          <span className="brand-mark"><Leaf size={18} strokeWidth={1.6} /></span>
          <span><strong>FIKA</strong> IMPACT</span>
        </a>
        <div className="location"><span>One Liverpool Street</span><span>London · EC2M</span></div>
        <div className="demo-status"><span className="status-live"><i /> Live impact today</span></div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <span className="eyebrow">Today’s service · live impact</span>
          <h1>Today’s coffee service is creating <em>measurable impact.</em></h1>
          <p>Making the impact of every coffee visible.</p>
        </div>
        <div className="served-today" aria-live="polite">
          <div className="served-orbit" aria-hidden="true"><span /><span /><span /></div>
          <AnimatePresence mode="wait">
            {story === 0 && (
              <motion.div className="served-value" key="today" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
                <span className="served-label">Drinks served today</span>
                <strong>{Math.round(totals.drinks).toLocaleString("en-GB")}</strong>
                <span className="served-period">and counting</span>
              </motion.div>
            )}
            {story === 1 && (
              <motion.div className="served-value story-value" key="month" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
                <span className="served-label">This month</span>
                <strong>{Math.round(monthTotals.cups).toLocaleString("en-GB")}</strong>
                <span className="served-period">single-use cups avoided</span>
              </motion.div>
            )}
            {story === 2 && (
              <motion.div className="served-value story-value how-value" key="how" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }}>
                <span className="served-label">How impact is made</span>
                <strong><Coffee size={31} strokeWidth={1.4} /> + <Droplets size={31} strokeWidth={1.4} /></strong>
                <span className="served-period">recovery · precision · reuse</span>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="story-progress" aria-hidden="true">{[0,1,2].map((item) => <i key={item} className={story === item ? "active" : ""} />)}</div>
          <ArrowDownRight className="served-arrow" size={24} strokeWidth={1.3} aria-hidden="true" />
        </div>
      </section>

      <div className="metrics-heading">
        <span>Live environmental impact today</span>
        <span className="metrics-note">Every drink makes a difference</span>
      </div>
      <motion.section className="metrics-grid" layout>
        {metricDefinitions.map((definition) => <ImpactMetric key={definition.key} definition={definition} totals={totals} />)}
      </motion.section>

      <div className="lower-grid">
        <LiveTransactionFeed events={events} />
        <ScaleVisual cups={totals.cups} />
      </div>

      <footer><span>FIKA · Better coffee, thoughtfully served.</span><span>Prototype display · modelled service data</span></footer>
      <button className="control-reveal" type="button" aria-label="Reveal demonstration controls" onClick={() => setControlsVisible((visible) => !visible)} />
      <AnimatePresence>
        {controlsVisible && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
            <DemoControls paused={paused} speed={speed} onPause={() => setPaused(!paused)} onRestart={restart} onSpeed={setSpeed} />
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
