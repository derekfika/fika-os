"use client";

import { motion } from "framer-motion";

export function TangibleImpact({ cups }: { cups: number }) {
  const stacks = Math.max(1, Math.round(cups / 250));
  return (
    <section className="tangible-impact" aria-labelledby="tangible-title">
      <div className="tangible-impact__copy">
        <span className="section-number">03</span>
        <h2 id="tangible-title">Small choices.<br /><span className="brand-headline">Repeated at scale.</span></h2>
        <p>Today’s reusable serviceware has replaced roughly</p>
      </div>
      <div className="tangible-impact__equivalent">
        <span className="equivalent-mark">≈</span>
        <strong>{stacks}</strong>
        <span>full stacks of<br />takeaway cups</span>
      </div>
      <div className="material-field" aria-hidden="true">
        {Array.from({ length: 16 }, (_, index) => (
          <motion.i key={index} initial={{ scaleY: 0 }} whileInView={{ scaleY: 1 }} viewport={{ once: true }} transition={{ duration: 0.55, delay: index * 0.025 }} />
        ))}
      </div>
    </section>
  );
}
