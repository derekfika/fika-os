"use client";

import { useMemo, useState } from "react";
import { BoxIcon, ChevronLeftIcon, ChevronRightIcon, GripIcon, SearchIcon } from "./icons";
import type { PlannerStatus, QueueItemView } from "./model";
import styles from "./queue.module.css";

type Filter = "all" | "delivery" | "collection";

export function UnassignedWorkQueue({ items, status = "ready", collapsed, onToggleCollapsed, onOpen, onNewCollection }: {
  items: QueueItemView[];
  status?: PlannerStatus;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onOpen?: (itemId: string) => void;
  /** Standalone collection: becomes ordinary assignable queue work (maps to New movement). */
  onNewCollection?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [term, setTerm] = useState("");
  const counts = useMemo(() => ({ all: items.length, delivery: items.filter((item) => item.kind === "delivery").length, collection: items.filter((item) => item.kind === "collection").length }), [items]);
  const needle = term.trim().toLocaleLowerCase("en-GB");
  const visible = items.filter((item) => (filter === "all" || item.kind === filter) && (!needle || [item.destination, item.description, item.quantity, item.window].some((value) => value?.toLocaleLowerCase("en-GB").includes(needle))));
  if (collapsed) return <aside className={`${styles.rail}`} aria-label="Unassigned work (collapsed)" data-logistics-planning-queue-rail>
    <button type="button" className={styles.railButton} onClick={onToggleCollapsed} aria-label="Expand unassigned work" aria-expanded="false"><ChevronRightIcon /></button>
    <span className={styles.railCount} aria-label={`${items.length} unassigned`}>{items.length}</span>
    <span className={styles.railLabel}>Unassigned</span>
  </aside>;
  return <aside className={`${styles.queue}`} aria-label="Unassigned work" data-logistics-planning-queue>
    <div className={styles.heading}>
      <h2>Unassigned work</h2><span aria-label={`${items.length} items`}>({items.length})</span>
      <button type="button" className={`${styles.railButton} ${styles.collapseButton}`} onClick={onToggleCollapsed} aria-label="Collapse unassigned work" aria-expanded="true"><ChevronLeftIcon size={18} /></button>
    </div>
    <p className={styles.hint}>Drag to a run, or click for details.</p>
    <div className={styles.filters} role="group" aria-label="Work type">
      {(["all", "delivery", "collection"] as const).map((key) => <button key={key} type="button" className={styles.filter} aria-pressed={filter === key} onClick={() => setFilter(key)}>{key === "all" ? "All" : key === "delivery" ? "Deliveries" : "Collections"} <b>{counts[key]}</b></button>)}
    </div>
    <label className={styles.search}><SearchIcon size={18} /><span className={styles.srOnly}>Search unassigned work</span><input type="search" value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Search by site, item or source…" /></label>
    {status === "loading" ? <div aria-busy="true" aria-label="Loading unassigned work">{[0, 1, 2, 3, 4].map((index) => <div key={index} className={styles.skeleton} />)}</div>
      : <ul className={styles.list} aria-label="Unassigned work items">
        {visible.length === 0 && <li className={styles.empty}><strong>{items.length === 0 ? "No unassigned work" : "No matching work"}</strong>{items.length === 0 ? "Everything for this day is on a run." : "Try a different filter or search."}</li>}
        {visible.map((item) => <li key={item.id} className={styles.item} data-timeline-queue-id={item.id} data-kind={item.kind} data-pending={item.pending ? "true" : undefined}>
          <span className={styles.grip} aria-hidden="true"><GripIcon /></span>
          <button type="button" className={styles.body} onClick={() => onOpen?.(item.id)} aria-label={`${item.destination}, ${item.kind}${item.window ? `, ${item.window}` : ""}. Open details`}>
            <span className={styles.name} title={item.destination}>{item.destination}</span>
            <span className={styles.desc}>{item.description}</span>
            {(item.window || item.quantity) && <span className={styles.meta} title={[item.window, item.quantity].filter(Boolean).join(" · ")}>{item.window ?? item.quantity}</span>}
            {item.attention && <span className={styles.attention}>⚠ {item.attention}</span>}
          </button>
          <span className={styles.badge} data-kind={item.kind}><BoxIcon size={15} />{item.kind === "delivery" ? "Delivery" : "Collection"}</span>
        </li>)}
      </ul>}
    {onNewCollection && <button type="button" className={styles.newCollection} onClick={onNewCollection}>+ New collection</button>}
  </aside>;
}
