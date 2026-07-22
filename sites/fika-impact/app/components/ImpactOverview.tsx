"use client";

import { motion } from "framer-motion";
import type { ImpactTotals } from "../hooks/useImpactSimulation";
import { formatImpact, LiveNumber } from "./LiveNumber";

type SupportingMetricProps = {
  label: string;
  description: string;
  value: number;
  type: "volume" | "count";
  tone?: "purple" | "paper";
};

function SupportingMetric({ label, description, value, type, tone = "paper" }: SupportingMetricProps) {
  const formatted = formatImpact(value, type);
  return (
    <motion.article className={`supporting-metric supporting-metric--${tone}`} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.25 }}>
      <span className="metric-label">{label}</span>
      <LiveNumber value={formatted.value} unit={formatted.unit} label={label} />
      <p>{description}</p>
    </motion.article>
  );
}

export function ImpactOverview({ totals }: { totals: ImpactTotals }) {
  const grounds = formatImpact(totals.groundsGrams, "mass");
  return (
    <section className="impact-overview section-shell" aria-labelledby="overview-title">
      <header className="section-intro">
        <span className="section-number">01</span>
        <p>What today’s service has already changed</p>
      </header>
      <div className="impact-overview__grid">
        <motion.article className="primary-impact" initial={{ opacity: 0, y: 32 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.25 }}>
          <span className="metric-label">Coffee grounds recovered</span>
          <LiveNumber value={grounds.value} unit={grounds.unit} label="Coffee grounds recovered" className="primary-impact__number" />
          <h2 id="overview-title">Waste becomes <span className="brand-headline">material.</span></h2>
          <p>Collected for reuse instead of being treated as general waste.</p>
        </motion.article>
        <div className="supporting-impact-grid">
          <SupportingMetric label="Milk waste avoided" description="Prepared precisely, with less left over." value={totals.milkMl} type="volume" tone="purple" />
          <SupportingMetric label="Paper cups avoided" description="Reusable serviceware replaces single use." value={totals.cups} type="count" />
          <SupportingMetric label="Plastic lids avoided" description="No disposable lid is needed." value={totals.lids} type="count" />
        </div>
      </div>
    </section>
  );
}
