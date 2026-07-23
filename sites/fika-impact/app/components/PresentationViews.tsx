"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { IMPACT_CONFIG } from "../config/impactConfig";
import type { DemoTransaction } from "../data/demoTransactions";
import type { ImpactTotals } from "../hooks/useImpactSimulation";
import { formatImpact, LiveNumber } from "./LiveNumber";

const reveal = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

export function LiveServiceView({ totals }: { totals: ImpactTotals }) {
  return (
    <section className="view view--live" aria-labelledby="live-view-title">
      <div className="coffee-atmosphere" aria-hidden="true"><i /><i /><i /></div>
      <div className="hero-statement">
        <motion.div className="view-kicker" variants={reveal}>Live impact today</motion.div>
        <h1 id="live-view-title">
          <motion.span variants={reveal}>Coffee creates</motion.span>
          <motion.span className="brand-headline" variants={reveal}>measurable<br />impact.</motion.span>
        </h1>
        <motion.p className="view-support" variants={reveal}>Every serve creates a little less waste.</motion.p>
      </div>
      <motion.div className="live-hero-total" variants={reveal} aria-live="polite">
        <LiveNumber value={Math.round(totals.drinks).toLocaleString("en-GB")} label="Coffees served today" />
        <span>coffees<br />today</span>
      </motion.div>
    </section>
  );
}

function Metric({ label, value, unit, note, index }: { label: string; value: string; unit?: string; note: string; index: string }) {
  return (
    <motion.article className="presentation-metric" variants={reveal}>
      <span className="metric-index">{index}</span>
      <span className="metric-label">{label}</span>
      <LiveNumber value={value} unit={unit} label={label} />
      <p>{note}</p>
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
        <motion.span className="view-kicker" variants={reveal}>Today&apos;s impact so far</motion.span>
        <motion.h2 id="today-view-title" className="brand-headline" variants={reveal}>Four changes.<br />One service.</motion.h2>
      </div>
      <div className="impact-composition" aria-label="Today's environmental impact">
        <Metric index="01" label="Coffee grounds recovered" value={grounds.value} unit={grounds.unit} note="Collected for reuse" />
        <Metric index="02" label="Milk waste avoided" value={milk.value} unit={milk.unit} note="Less excess in every pour" />
        <Metric index="03" label="Paper cups avoided" value={cups.value} note="Single-use cups not used" />
        <Metric index="04" label="Plastic lids avoided" value={lids.value} note="Single-use lids not used" />
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
        <motion.h2 id="method-view-title" className="brand-headline" variants={reveal}>Purpose,<br /><span>poured daily.</span></motion.h2>
      </div>
      <div className="presentation-methods">
        {methods.map(([number, verb, title, copy]) => (
          <motion.article key={number} variants={reveal}>
            <span className="method-symbol" aria-hidden="true"><i /><b>{number}</b></span>
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
  const projectedCups = Math.round(monthTotals.cups).toLocaleString("en-GB");
  return (
    <section className="view view--tangible" aria-labelledby="tangible-view-title">
      <div className="tangible-copy">
        <motion.div className="view-kicker" variants={reveal}>Impact made tangible</motion.div>
        <motion.h2 id="tangible-view-title" className="brand-headline" variants={reveal}>Small choices.<br /><span>Massive<br />difference.</span></motion.h2>
        <motion.p variants={reveal}>At today&apos;s pace, one month of coffee at One Liverpool Street could avoid:</motion.p>
      </div>
      <motion.div className="tangible-equivalent" variants={reveal}>
        <LiveNumber value={projectedCups} label="Modelled paper cups avoided this month" />
        <strong>paper cups</strong>
        <span>avoided this month</span>
        <small>Modelled projection / around {stacks} full stacks avoided today</small>
      </motion.div>
      <div className="cup-rhythm" aria-hidden="true">{Array.from({ length: 11 }, (_, index) => <i key={index} />)}</div>
    </section>
  );
}

function eventImpact(event: DemoTransaction) {
  const details: string[] = [];
  if (event.coffee) details.push(`${IMPACT_CONFIG.groundsPerCoffeeDrinkGrams} g grounds`);
  if (event.milk) details.push(`${IMPACT_CONFIG.milkAvoidedPerMilkDrinkMl} ml milk`);
  details.push("cup + lid avoided");
  return details.join(" / ");
}

export function LivePulseView({ events, totals }: { events: DemoTransaction[]; totals: ImpactTotals }) {
  const grounds = formatImpact(totals.groundsGrams, "mass");
  const reducedMotion = useReducedMotion();
  return (
    <section className="view view--pulse" aria-labelledby="pulse-view-title">
      <div className="view-heading">
        <motion.span className="view-kicker live-kicker" variants={reveal}><i aria-hidden="true" /> Live from the coffee bar</motion.span>
        <motion.h2 id="pulse-view-title" className="brand-headline" variants={reveal}>The coffee bar<br /><span>is live right now.</span></motion.h2>
      </div>
      <motion.ol className="pulse-feed" variants={reveal} aria-live="polite">
        <AnimatePresence initial={false}>
          {events.slice(0, 3).map((event, index) => (
            <motion.li key={event.id} layout initial={{ opacity: 0, y: reducedMotion ? 0 : -10 }} animate={{ opacity: 1 - index * .22, y: 0 }} exit={{ opacity: 0, y: reducedMotion ? 0 : 10 }}>
              <span className="pulse-dot" aria-hidden="true" /><strong>{event.drink}</strong><p>{eventImpact(event)}</p><em>{index === 0 ? "just now" : "moments ago"}</em>
            </motion.li>
          ))}
        </AnimatePresence>
      </motion.ol>
      <motion.aside className="pulse-outlook" variants={reveal}>
        <span>Grounds recovered today</span>
        <strong>{grounds.value}<small>{grounds.unit}</small></strong>
        <p>live total from today&apos;s service</p>
      </motion.aside>
    </section>
  );
}
