"use client";

import { AnimatePresence, motion } from "framer-motion";
import { IMPACT_CONFIG } from "../config/impactConfig";
import type { DemoTransaction } from "../data/demoTransactions";
import type { ImpactTotals } from "../hooks/useImpactSimulation";
import { formatImpact, LiveNumber } from "./LiveNumber";

const reveal = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};

export function LiveServiceView({ totals }: { totals: ImpactTotals }) {
  return (
    <section className="view view--live" aria-labelledby="live-view-title">
      <motion.div className="view-kicker" variants={reveal}>Live impact today</motion.div>
      <h1 id="live-view-title">
        <motion.span variants={reveal}>Today’s coffee service is creating</motion.span>
        <motion.span className="brand-headline" variants={reveal}>measurable impact.</motion.span>
      </h1>
      <motion.div className="live-hero-total" variants={reveal} aria-live="polite">
        <LiveNumber value={Math.round(totals.drinks).toLocaleString("en-GB")} label="Drinks served today" />
        <span>drinks served<br />today</span>
      </motion.div>
      <motion.p className="view-support" variants={reveal}>Every serve creates a little less waste.</motion.p>
    </section>
  );
}

function Metric({ label, value, unit, className = "" }: { label: string; value: string; unit?: string; className?: string }) {
  return (
    <motion.article className={`presentation-metric ${className}`} variants={reveal}>
      <span>{label}</span>
      <LiveNumber value={value} unit={unit} label={label} />
    </motion.article>
  );
}

export function ImpactTodayView({ totals }: { totals: ImpactTotals }) {
  const grounds = formatImpact(totals.groundsGrams, "mass");
  const milk = formatImpact(totals.milkMl, "volume");
  const cups = formatImpact(totals.cups, "count");
  const lids = formatImpact(totals.lids, "count");
  return (
    <section className="view view--today" aria-labelledby="today-view-title">
      <div className="view-heading">
        <motion.span className="view-kicker" variants={reveal}>Impact today</motion.span>
        <motion.h2 id="today-view-title" variants={reveal}>One service.<br /><span className="brand-headline">Four changes.</span></motion.h2>
      </div>
      <div className="impact-composition">
        <Metric label="Coffee grounds recovered" value={grounds.value} unit={grounds.unit} className="presentation-metric--hero" />
        <div className="impact-composition__support">
          <Metric label="Milk waste avoided" value={milk.value} unit={milk.unit} />
          <Metric label="Paper cups avoided" value={cups.value} />
          <Metric label="Plastic lids avoided" value={lids.value} />
        </div>
      </div>
    </section>
  );
}

const methods = [
  ["01", "Recover", "Coffee grounds", "Collected for reuse."],
  ["02", "Prepare", "Milk precisely", "Less excess in every pour."],
  ["03", "Reuse", "Serviceware", "No paper cup. No plastic lid."],
] as const;

export function ImpactMethodView() {
  return (
    <section className="view view--method" aria-labelledby="method-view-title">
      <div className="view-heading">
        <motion.span className="view-kicker" variants={reveal}>How impact is created</motion.span>
        <motion.h2 id="method-view-title" variants={reveal}>Designed into<br /><span className="brand-headline">every serve.</span></motion.h2>
      </div>
      <div className="presentation-methods">
        {methods.map(([number, verb, title, copy]) => (
          <motion.article key={number} variants={reveal}>
            <span className="method-number">{number}</span>
            <span className="method-verb">{verb}</span>
            <h3>{title}</h3>
            <p>{copy}</p>
          </motion.article>
        ))}
      </div>
    </section>
  );
}

export function TangibleImpactView({ totals, monthTotals }: { totals: ImpactTotals; monthTotals: ImpactTotals }) {
  const stacks = Math.max(1, Math.round(totals.cups / 250));
  return (
    <section className="view view--tangible" aria-labelledby="tangible-view-title">
      <motion.div className="view-kicker" variants={reveal}>Impact made tangible</motion.div>
      <motion.h2 id="tangible-view-title" variants={reveal}>Small choices.<br /><span className="brand-headline">Repeated at scale.</span></motion.h2>
      <motion.div className="tangible-equivalent" variants={reveal}>
        <span>≈</span><strong>{stacks}</strong><p>full stacks of<br />takeaway cups<br /><em>avoided today</em></p>
      </motion.div>
      <motion.div className="tangible-projection" variants={reveal}>
        <span>Modelled monthly projection</span>
        <strong>{Math.round(monthTotals.cups).toLocaleString("en-GB")}</strong>
        <p>single-use cups avoided</p>
      </motion.div>
      <div className="tangible-bars" aria-hidden="true">{Array.from({ length: 14 }, (_, index) => <i key={index} />)}</div>
    </section>
  );
}

function eventImpact(event: DemoTransaction) {
  const details: string[] = [];
  if (event.coffee) details.push(`${IMPACT_CONFIG.groundsPerCoffeeDrinkGrams} g grounds`);
  if (event.milk) details.push(`${IMPACT_CONFIG.milkAvoidedPerMilkDrinkMl} ml milk`);
  details.push("cup + lid avoided");
  return details.join(" · ");
}

export function LivePulseView({ events, monthTotals }: { events: DemoTransaction[]; monthTotals: ImpactTotals }) {
  const grounds = formatImpact(monthTotals.groundsGrams, "mass");
  return (
    <section className="view view--pulse" aria-labelledby="pulse-view-title">
      <div className="view-heading">
        <motion.span className="view-kicker live-kicker" variants={reveal}><i aria-hidden="true" /> Live from the coffee bar</motion.span>
        <motion.h2 id="pulse-view-title" variants={reveal}>Every drink leaves<br /><span className="brand-headline">a lighter footprint.</span></motion.h2>
      </div>
      <motion.ol className="pulse-feed" variants={reveal} aria-live="polite">
        <AnimatePresence initial={false}>
          {events.slice(0, 3).map((event, index) => (
            <motion.li key={event.id} layout initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1 - index * .22, y: 0 }} exit={{ opacity: 0, y: 10 }}>
              <span>0{index + 1}</span><strong>{event.drink}</strong><p>{eventImpact(event)}</p><em>{index === 0 ? "just now" : "moments ago"}</em>
            </motion.li>
          ))}
        </AnimatePresence>
      </motion.ol>
      <motion.aside className="pulse-outlook" variants={reveal}>
        <span>Monthly outlook · modelled</span>
        <strong>{grounds.value}<small>{grounds.unit}</small></strong>
        <p>coffee grounds recovered</p>
      </motion.aside>
    </section>
  );
}
