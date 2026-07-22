"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import type { ImpactTotals } from "../hooks/useImpactSimulation";
import { LiveNumber } from "./LiveNumber";

const stories = [
  ["Grounds recovered", "Every coffee gives its grounds another use."],
  ["Milk prepared precisely", "Less excess milk, measured with every pour."],
  ["Serviceware reused", "No paper cup. No plastic lid. Every time."],
] as const;

export function ImpactHero({ totals }: { totals: ImpactTotals }) {
  const [story, setStory] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setStory((current) => (current + 1) % stories.length), 12_000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="impact-hero" id="top" aria-labelledby="impact-title">
      <motion.div className="impact-hero__headline" initial="hidden" animate="visible" variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.1 } },
      }}>
        <motion.span className="kicker" variants={{ hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0 } }}>
          Live impact today
        </motion.span>
        <h1 id="impact-title">
          <motion.span variants={{ hidden: { opacity: 0, y: 28 }, visible: { opacity: 1, y: 0 } }}>Coffee with an impact</motion.span>
          <motion.span className="brand-headline" variants={{ hidden: { opacity: 0, y: 28 }, visible: { opacity: 1, y: 0 } }}>you can see.</motion.span>
        </h1>
      </motion.div>

      <div className="impact-hero__count" aria-live="polite">
        <LiveNumber value={Math.round(totals.drinks).toLocaleString("en-GB")} label="Drinks served today" className="hero-number" />
        <span className="impact-hero__count-label">drinks served today</span>
      </div>

      <div className="rotating-story" aria-live="polite">
        <span className="rotating-story__index">0{story + 1} / 03</span>
        <AnimatePresence mode="wait">
          <motion.div key={story} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.45 }}>
            <strong>{stories[story][0]}</strong>
            <p>{stories[story][1]}</p>
          </motion.div>
        </AnimatePresence>
        <div className="rotating-story__progress" aria-hidden="true">
          {stories.map((_, index) => <i key={index} className={story === index ? "active" : ""} />)}
        </div>
      </div>
    </section>
  );
}
