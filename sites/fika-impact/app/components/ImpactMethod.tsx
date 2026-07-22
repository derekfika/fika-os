"use client";

import { motion } from "framer-motion";

const methods = [
  { number: "01", verb: "Recover", title: "Coffee grounds", copy: "Captured after every extraction and collected for reuse." },
  { number: "02", verb: "Prepare", title: "Milk precisely", copy: "Measured dispensing means less excess milk in every service." },
  { number: "03", verb: "Reuse", title: "Serviceware", copy: "Cups and lids stay out of the waste stream altogether." },
];

export function ImpactMethod() {
  return (
    <section className="impact-method section-shell" aria-labelledby="method-title">
      <header className="method-heading">
        <span className="section-number">02</span>
        <h2 id="method-title">Impact is designed<br /><span className="brand-headline">into the service.</span></h2>
      </header>
      <div className="method-list">
        {methods.map((method, index) => (
          <motion.article key={method.number} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.4 }} transition={{ delay: index * 0.09 }}>
            <div className="method-marker"><span>{method.number}</span><i /></div>
            <span className="method-verb">{method.verb}</span>
            <h3>{method.title}</h3>
            <p>{method.copy}</p>
          </motion.article>
        ))}
      </div>
    </section>
  );
}
