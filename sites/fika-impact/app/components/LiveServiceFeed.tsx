"use client";

import { AnimatePresence, motion } from "framer-motion";
import { IMPACT_CONFIG } from "../config/impactConfig";
import type { DemoTransaction } from "../data/demoTransactions";

function impactLine(event: DemoTransaction) {
  const impacts: string[] = [];
  if (event.coffee) impacts.push(`${IMPACT_CONFIG.groundsPerCoffeeDrinkGrams} g grounds recovered`);
  if (event.milk) impacts.push(`${IMPACT_CONFIG.milkAvoidedPerMilkDrinkMl} ml milk avoided`);
  impacts.push("cup + lid avoided");
  return impacts.join(" · ");
}

export function LiveServiceFeed({ events }: { events: DemoTransaction[] }) {
  return (
    <section className="service-feed section-shell" aria-labelledby="service-feed-title">
      <div className="service-feed__heading">
        <div>
          <span className="service-pulse"><i aria-hidden="true" /> Live from the bar</span>
          <h2 id="service-feed-title">Every serve leaves a lighter footprint.</h2>
        </div>
        <span className="service-feed__location">One Liverpool Street · Today</span>
      </div>
      <ol aria-live="polite">
        <AnimatePresence initial={false}>
          {events.slice(0, 3).map((event, index) => (
            <motion.li key={event.id} layout initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1 - index * 0.23, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: 0.45 }}>
              <span className="service-feed__position">0{index + 1}</span>
              <strong>{event.drink}</strong>
              <span>{impactLine(event)}</span>
              <i>{index === 0 ? "just now" : "moments ago"}</i>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </section>
  );
}
