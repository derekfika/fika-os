import { useState } from "react";
import type { Dish, Section } from "../lib/contract";
import { assignWeeks, copyWeeks } from "./rotation-workspace-model";
import { Button, title } from "./studio-ui";
import styles from "./rotation-workspace.module.css";

const numbers = [0, 1, 2, 3, 4, 5];
export function RotationWorkspace({ section, dishes, week, canManage, update, chooseWeek, loadMore, busy, createDish }: {
  section: Section; dishes: Dish[]; week: number; canManage: boolean;
  update: (change: Partial<Section>) => void; chooseWeek: (week: number) => void;
  loadMore?: () => void; busy: boolean; createDish: () => void;
}) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [targets, setTargets] = useState<number[]>([week]);
  const [source, setSource] = useState(week);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const allIds = Array.from(new Set(section.weeks.flat()));
  const byId = new Map(dishes.map((dish) => [dish.id, dish]));
  const matches = dishes.filter((dish) => dish.name.toLocaleLowerCase("en-GB").includes(search.trim().toLocaleLowerCase("en-GB")));
  const toggle = <T,>(values: T[], value: T) => values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
  const apply = (remove: boolean) => { update({ weeks: assignWeeks(section.weeks, picked, targets, remove) }); setPicked([]); };
  const copyTargets = targets.filter((target) => target !== source);
  const populated = copyTargets.filter((target) => section.weeks[target]?.length);
  const snapshot = JSON.stringify(section.weeks);
  return <div className={styles.workspace}>
    <section aria-label="Six-week rotation">
      <h2>Six-week rotation</h2>
      <p>Change a dish in one week using its checkbox. Open a week to change the order.</p>
      <div className={styles.weekLinks}>{numbers.map((i) => <Button key={i} onClick={() => chooseWeek(i)}>Week {i + 1} · {section.weeks[i]?.length || 0} choices</Button>)}</div>
      {allIds.length === 0 && <p>No dishes assigned yet. Select dishes below to begin.</p>}
      <div className={styles.rows}>{allIds.map((id) => {
        const name = byId.get(id)?.name || "Dish unavailable";
        return <fieldset className={styles.row} key={id}><legend>{name}</legend><div className={styles.weeks}>{numbers.map((i) => <label key={i}><input type="checkbox" disabled={!canManage} checked={section.weeks[i]?.includes(id) || false} onChange={(event) => update({ weeks: assignWeeks(section.weeks, [id], [i], !event.target.checked) })} /> W{i + 1}</label>)}</div></fieldset>;
      })}</div>
    </section>
    <section aria-label="Bulk dish assignment" className={styles.panel}>
      <h2>Add or remove dishes</h2>
      <label className="fika-field">Search dishes<input className="fika-input" type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <div className={styles.actions}><Button disabled={!canManage || !matches.length} onClick={() => setPicked(Array.from(new Set([...picked, ...matches.map((dish) => dish.id)])))}>Select all {matches.length} shown</Button><Button disabled={!picked.length} onClick={() => setPicked([])}>Clear dish selection</Button><span>{picked.length} selected</span></div>
      <div className={styles.picker}>{matches.map((dish) => <label key={dish.id}><input type="checkbox" disabled={!canManage} checked={picked.includes(dish.id)} onChange={() => setPicked(toggle(picked, dish.id))} /> <span>{dish.name} <small>· {title(dish.category)}</small></span></label>)}{!matches.length && <p>No dishes match this search.</p>}</div>
      {loadMore && <Button disabled={busy} onClick={loadMore}>Load more dishes</Button>}<Button disabled={!canManage} onClick={createDish}>Create dish</Button>
      <fieldset><legend>Apply to weeks</legend><div className={styles.weeks}>{numbers.map((i) => <label key={i}><input type="checkbox" checked={targets.includes(i)} onChange={() => { setTargets(toggle(targets, i)); setConfirmation(null); }} /> W{i + 1}</label>)}</div></fieldset>
      <div className={styles.actions}><Button onClick={() => { setTargets(numbers); setConfirmation(null); }}>Select all weeks</Button><Button onClick={() => { setTargets([]); setConfirmation(null); }}>Clear week selection</Button><Button primary disabled={!canManage || !picked.length || !targets.length} onClick={() => apply(false)}>Add {picked.length} dishes to {targets.length} weeks</Button><Button disabled={!canManage || !picked.length || !targets.length} onClick={() => apply(true)}>Remove {picked.length} dishes from {targets.length} weeks</Button></div>
    </section>
    <section aria-label="Copy rotation weeks" className={styles.panel}>
      <h2>Copy a week</h2><p>Copy the source into the selected weeks above. Existing choices in those weeks will be replaced.</p>
      <label className="fika-field">Copy from<select className="fika-select" value={source} onChange={(event) => { setSource(Number(event.target.value)); setConfirmation(null); }}>{numbers.map((i) => <option key={i} value={i}>Week {i + 1}</option>)}</select></label>
      {populated.length > 0 && <label className={styles.confirm}><input type="checkbox" checked={confirmation === snapshot} onChange={(event) => setConfirmation(event.target.checked ? snapshot : null)} /> Replace choices in {populated.map((i) => `week ${i + 1}`).join(", ")}</label>}
      <Button disabled={!canManage || !copyTargets.length || (populated.length > 0 && confirmation !== snapshot)} onClick={() => { const result = copyWeeks(section.weeks, source, copyTargets, confirmation); if (result) update({ weeks: result }); setConfirmation(null); }}>Copy week {source + 1} to {copyTargets.length} weeks</Button>
    </section>
  </div>;
}
