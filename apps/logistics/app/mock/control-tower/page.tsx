"use client";

import { useState } from "react";

/*
 * Visual prototype only: this route intentionally uses static example data.
 * Real Logistics data, actions and persistence are not wired yet. It is the
 * proposed implementation target for the production desktop planner.
 */

type QueueType = "delivery" | "collection" | "transfer";
type QueueItem = {
  id: string;
  time: string;
  type: QueueType;
  destination: string;
  route: string;
  load: string;
  state: "Ready" | "Planned" | "Attention";
  note?: string;
};
type Stop = {
  id: string;
  time?: string;
  window?: string;
  destination: string;
  type: QueueType;
  load: string;
  attention?: string;
};
type Run = { id: string; label: string; driver: string; status: string; stops: Stop[] };

const queue: QueueItem[] = [
  { id: "q1", time: "09:30 – 11:00", type: "delivery", destination: "Haleon", route: "FIKA DC → Haleon, Weybridge", load: "2 pallets", state: "Ready" },
  { id: "q2", time: "11:00 – 12:30", type: "collection", destination: "FIKA Xchange", route: "FIKA Xchange → FIKA DC", load: "6 cages", state: "Ready" },
  { id: "q3", time: "13:00 – 15:00", type: "delivery", destination: "MNK", route: "FIKA DC → MNK, Hounslow", load: "3 pallets", state: "Planned" },
  { id: "q4", time: "15:30 – 16:30", type: "transfer", destination: "Angel Court", route: "FIKA DC → Angel Court", load: "1 pallet", state: "Attention", note: "Source amended" },
  { id: "q5", time: "16:30 – 17:30", type: "collection", destination: "Angel Court", route: "Angel Court → FIKA DC", load: "2 pallets", state: "Ready" },
];

const runs: Run[] = [
  {
    id: "run-101", label: "Run 101", driver: "Franco", status: "READY", stops: [
      { id: "s1", time: "07:00", destination: "Depot", type: "delivery", load: "Base load" },
      { id: "s2", time: "09:00", window: "09:00 – 10:00", destination: "Haleon", type: "delivery", load: "2 pallets" },
      { id: "s3", time: "10:30", window: "10:30 – 11:30", destination: "FIKA Xchange", type: "collection", load: "6 cages" },
      { id: "s4", time: "12:30", window: "12:30 – 13:30", destination: "MNK", type: "delivery", load: "3 pallets" },
      { id: "s5", time: "14:00", window: "14:00 – 15:00", destination: "Angel Court", type: "transfer", load: "1 pallet", attention: "Amended" },
      { id: "s6", time: "15:30", window: "15:30 – 16:30", destination: "Angel Court", type: "delivery", load: "2 pallets" },
      { id: "s7", destination: "Unassigned", type: "delivery", load: "2 pallets" },
    ],
  },
  {
    id: "run-102", label: "Run 102", driver: "Dee", status: "PLANNED", stops: [
      { id: "s8", time: "07:15", destination: "Depot", type: "delivery", load: "Base load" },
      { id: "s9", time: "08:30", window: "08:30 – 09:30", destination: "MNK", type: "delivery", load: "2 pallets" },
      { id: "s10", time: "10:00", window: "10:00 – 11:00", destination: "Haleon", type: "collection", load: "4 cages" },
      { id: "s11", time: "11:30", window: "11:30 – 12:30", destination: "FIKA Xchange", type: "delivery", load: "1 pallet" },
      { id: "s12", time: "13:30", window: "13:30 – 14:30", destination: "Angel Court", type: "delivery", load: "1 pallet" },
      { id: "s13", destination: "Unassigned", type: "collection", load: "3 pallets" },
      { id: "s14", time: "16:45", window: "16:45 – 17:15", destination: "Haleon", type: "delivery", load: "2 pallets" },
    ],
  },
];

const days = [
  ["Mon 24 Aug", "8", "2", "5", "2", "1", "1"], ["Tue 25 Aug", "7", "2", "4", "2", "0", "0"],
  ["Wed 26 Aug", "9", "3", "6", "2", "1", "1"], ["Thu 27 Aug", "8", "2", "5", "2", "1", "0"], ["Fri 28 Aug", "6", "2", "3", "2", "0", "0"],
];
const hours = ["07:00", "08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];

function typeLabel(type: QueueType) { return type[0].toUpperCase() + type.slice(1); }
function direction(type: QueueType) { return type === "collection" ? "↑" : type === "transfer" ? "↔" : "↓"; }
function timePosition(time?: string) {
  if (!time) return undefined;
  const [hour, minute] = time.split(":").map(Number);
  return ((hour * 60 + minute - 7 * 60) / (11 * 60)) * 100;
}

export default function ControlTowerPrototype() {
  const [filter, setFilter] = useState<"all" | QueueType>("all");
  const [selected, setSelected] = useState<string>();
  const visibleQueue = filter === "all" ? queue : queue.filter((item) => item.type === filter);
  const selectedItem = queue.find((item) => item.id === selected);
  const selectedStop = runs.flatMap((run) => run.stops).find((stop) => stop.id === selected);

  return <main className="mock-tower">
    <header className="mock-shell">
      <div className="mock-brand"><img src="/brand-assets/logos/fika_logo_white_png.png" alt="FIKA" /><span>OS</span></div>
      <div className="mock-context"><span>Operations workspace</span><strong>Logistics</strong></div>
      <span className="mock-chevron">⌄</span>
      <div className="mock-shell-spacer" />
      <div className="mock-environment"><i /> Local development <span>— no cloud data</span></div>
      <div className="mock-bell">♧</div><div className="mock-avatar">DM</div><span className="mock-chevron">⌄</span>
    </header>

    <div className="mock-canvas">
      <section className="mock-heading"><div><h1>Logistics</h1><p>Plan and dispatch daily deliveries.</p></div></section>
      <section className="mock-week-nav" aria-label="Prototype week selector"><button>‹</button><strong>WC 24 Aug — 28 Aug</strong><button className="mock-this-week">This week</button><button>›</button></section>
      <section className="mock-day-cards">{days.map((day, index) => <button key={day[0]} className={index === 0 ? "selected" : ""}>
        <div className="mock-day-title"><strong>{day[0]}</strong>{index === 0 && <b>✓</b>}</div>
        <div className="mock-day-metrics"><span><i className="purple-dot" />{day[1]} loads</span><span><i className="purple-dot" />{day[2]} runs</span><span><i className="green-dot" />{day[3]} deliveries</span><span><i className="blue-dot" />{day[4]} collections</span><span><i className="amber-dot" />{day[5]} transfer</span><span><i className="red-dot" />{day[6]} attention</span></div>
      </button>)}</section>
      <div className="mock-updated">Last updated 14:57 · 20 Aug 2026 <span>● Fulfilment &nbsp; ● OPLOCs &nbsp; ● Production context</span></div>
      <section className="mock-selected-day"><div><span>▣</span><strong>MONDAY 24 AUGUST</strong><small>8 loads · 2 runs &nbsp;·&nbsp; 5 deliveries · 2 collections &nbsp;·&nbsp; 1 transfer · 1 attention</small></div><div className="mock-actions"><button>＋ New run</button><button>＋ New movement</button><button>↻ Refresh</button><button>▦ Driver view</button></div></section>

      <section className="mock-workspace">
        <aside className="mock-queue"><header><div><span>QUEUE</span><h2>Unassigned work <em>({visibleQueue.length})</em></h2></div><button className="mock-filter-icon">⌯</button></header><div className="mock-filter-pills">{(["all", "delivery", "collection", "transfer"] as const).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All" : typeLabel(value)} <b>{value === "all" ? queue.length : queue.filter((item) => item.type === value).length}</b></button>)}</div><div className="mock-queue-list">{visibleQueue.map((item) => <article key={item.id} className="mock-queue-item"><button className="mock-queue-main" onClick={() => setSelected(item.id)}><span className="mock-item-time">{item.time}</span><span className={`mock-type ${item.type}`}><b>{direction(item.type)}</b> {typeLabel(item.type)}</span><strong>{item.destination}</strong><small>{item.route}</small><span className="mock-load">{item.load}</span><span className={`mock-state ${item.state.toLowerCase()}`}>{item.note ? `⚠ ${item.note}` : `● ${item.state}`}</span></button><div className="mock-queue-actions"><button onClick={() => setSelected(item.id)}>Details</button><button>Assign</button><b>⁙</b></div></article>)}</div></aside>

        <section className="mock-schedule"><header className="mock-schedule-head"><div><span>PLANNING SURFACE · MONDAY 24 AUG</span><h2>Dispatch schedule</h2></div><strong>2 runs · 15 stops</strong></header><div className="mock-legend"><span><i className="green-dot" /> Delivery</span><span><i className="blue-dot" /> Collection</span><span><i className="amber-dot" /> Transfer</span><span><i className="red-dot" /> Attention</span><span><i className="unscheduled-dot" /> Unscheduled</span><div><button className="active">Day</button><button>Week</button><button>⚙</button></div></div><div className="mock-timeline"><div className="mock-ruler"><span>Time</span>{hours.map((hour) => <b key={hour}>{hour}</b>)}</div>{runs.map((run) => <div className="mock-driver-row" key={run.id}><div className="mock-driver"><b>{run.driver.slice(0, 2).toUpperCase()}</b><div><strong>{run.driver}</strong><span>{run.label} · {run.status}</span><small>{run.stops.length} stops · 2 loads</small></div></div><div className="mock-track">{hours.map((hour) => <i key={hour} />)}{run.stops.filter((stop) => stop.time).map((stop) => <button key={stop.id} className={`mock-stop ${stop.type} ${stop.attention ? "attention" : ""}`} style={{ left: `${timePosition(stop.time)}%` }} onClick={() => setSelected(stop.id)}><small>{stop.time}</small><strong>{stop.destination}</strong><span>{stop.window || stop.load}</span></button>)}{run.stops.filter((stop) => !stop.time).map((stop) => <button key={stop.id} className="mock-unscheduled" onClick={() => setSelected(stop.id)}>UNSCHEDULED · {stop.load}</button>)}</div></div>)}</div><footer className="mock-summary"><div><b>▣</b><strong>2</strong><span>Active runs</span></div><div><b>⌖</b><strong>15 / 16</strong><span>Stops scheduled</span></div><div><b>◇</b><strong>28</strong><span>Total pallets</span></div><div><b>▦</b><strong>10</strong><span>Cages</span></div><div className="attention"><b>△</b><strong>2</strong><span>Items need attention</span></div></footer></section>
      </section>
    </div>
    {(selectedItem || selectedStop) && <aside className="mock-inspector"><header><div><span>DETAIL INSPECTOR</span><h2>{selectedItem?.destination || selectedStop?.destination}</h2></div><button onClick={() => setSelected(undefined)}>×</button></header><p><b>{selectedItem ? selectedItem.time : selectedStop?.window || selectedStop?.time || "Unscheduled"}</b></p><div className={`mock-type ${selectedItem?.type || selectedStop?.type}`}>{direction(selectedItem?.type || selectedStop!.type)} {typeLabel(selectedItem?.type || selectedStop!.type)}</div><h3>Load summary</h3><p>{selectedItem?.load || selectedStop?.load}</p><h3>Assignment</h3><p>{selectedItem ? "Unassigned work" : runs.find((run) => run.stops.some((stop) => stop.id === selectedStop?.id))?.driver}</p><button className="mock-inspector-action">Assign to run</button></aside>}
  </main>;
}
