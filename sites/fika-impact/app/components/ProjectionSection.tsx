"use client";

import { motion } from "framer-motion";
import type { ImpactTotals } from "../hooks/useImpactSimulation";
import { formatImpact, LiveNumber } from "./LiveNumber";

export function ProjectionSection({ totals }: { totals: ImpactTotals }) {
  const cups = formatImpact(totals.cups, "count");
  const grounds = formatImpact(totals.groundsGrams, "mass");
  const milk = formatImpact(totals.milkMl, "volume");
  return (
    <section className="projection" aria-labelledby="projection-title">
      <div className="projection__topline">
        <span className="section-number">04</span>
        <span>Modelled monthly projection</span>
        <span>Based on today’s service pattern</span>
      </div>
      <div className="projection__main">
        <div>
          <span className="metric-label">Single-use cups avoided</span>
          <LiveNumber value={cups.value} label="Projected monthly single-use cups avoided" className="projection__number" />
        </div>
        <h2 id="projection-title">One day’s choices,<br /><span className="brand-headline">carried forward.</span></h2>
      </div>
      <div className="projection__support">
        <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
          <LiveNumber value={grounds.value} unit={grounds.unit} label="Projected monthly grounds recovered" />
          <span>grounds recovered</span>
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.08 }}>
          <LiveNumber value={milk.value} unit={milk.unit} label="Projected monthly milk waste avoided" />
          <span>milk waste avoided</span>
        </motion.div>
        <p>This projection is indicative, not a measured total. It uses the live daily service run rate and a consistent modelled multiplier.</p>
      </div>
    </section>
  );
}
