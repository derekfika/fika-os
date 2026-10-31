"use client";
import { useDeferredValue, useMemo, useRef, useState } from "react";
import type { RecipeGroup, RecipeIndex, RecipeRecord } from "@/lib/food-data/recipes";
import type { FoodManifest } from "@/lib/food-data/manifest";
import styles from "./food-data.module.css";
import VirtualList from "./VirtualList";
import { Allergens, Field, Nutrition, blank, integer } from "./shared";

const COLS = "minmax(0,4fr) minmax(0,1fr) minmax(0,2fr)";

export default function RecipeLibrary({ index, manifest }: { index: RecipeIndex; manifest: FoodManifest }) {
  const [text, setText] = useState(""); const [selected, setSelected] = useState<string | undefined>();
  const deferred = useDeferredValue(text); const detail = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => index.search(deferred), [index, deferred]);
  const activeIndex = selected === undefined ? -1 : groups.findIndex(group => group.name === selected);
  const group = activeIndex === -1 ? undefined : groups[activeIndex];

  return <section aria-label="Recipe Library">
    <p className={`${styles.note} ${styles.noteWarn}`} role="note"><strong>Recipe metadata, not production recipes.</strong> The Kafoodle recipe export carries names, allergens, nutrition, yields and costing figures. It has no ingredient quantities or method, so nothing here can be used to prepare a dish, and these records are not part of the FIKA OS Dish Library.</p>
    <form className={styles.toolbar} role="search" style={{ gridTemplateColumns: "minmax(0,2fr) auto" }} onSubmit={event => event.preventDefault()}>
      <Field id="rl-search" label="Search recipe name"><input id="rl-search" type="search" value={text} onChange={event => setText(event.target.value)} autoComplete="off" /></Field>
      <button type="button" className={styles.button} disabled={!text} onClick={() => setText("")}>Clear search</button>
    </form>
    <p className={styles.count} role="status" aria-live="polite">{integer.format(groups.length)} of {integer.format(index.groups.length)} recipe names{text ? " match" : ""}, covering {integer.format(index.records.length)} exported rows. Rows with the same exact name are grouped for browsing; none are removed.</p>
    <div className={styles.layout}>
      <div className={styles.listCard}>
        <div className={styles.listHead} style={{ ["--cols" as string]: COLS, ["--colsSmall" as string]: "minmax(0,3fr) minmax(0,1fr)" }} aria-hidden="true"><span>Recipe name</span><span>Rows</span><span className={styles.hideSmall}>Data check</span></div>
        {groups.length === 0
          ? <div className={styles.state}><h2>No recipes match</h2><p>Try a shorter name or clear the search.</p></div>
          : <VirtualList count={groups.length} label="Recipes" key={deferred} activeIndex={activeIndex === -1 ? undefined : activeIndex} onActivate={position => { setSelected(groups[position].name); detail.current?.focus(); }}
              renderRow={(position, props) => {
                const item = groups[position];
                return <button type="button" {...props} style={{ ["--cols" as string]: COLS, ["--colsSmall" as string]: "minmax(0,3fr) minmax(0,1fr)" }}>
                  <span className={`${styles.cell} ${styles.cellStrong}`}>{item.name || "(no name)"}</span>
                  <span className={styles.cell}>{item.members.length}</span>
                  <span className={`${styles.cell} ${styles.hideSmall}`}>{item.conflicts.length ? <span className={`${styles.badge} ${styles.badgeWarn}`}>{item.conflicts.length} field{item.conflicts.length === 1 ? "" : "s"} differ</span> : item.members.length > 1 ? <span className={`${styles.badge} ${styles.badgeOk}`}>Rows identical</span> : <span className={styles.muted}>Single row</span>}</span>
                </button>;
              }} />}
      </div>
      <div className={styles.detail} ref={detail} tabIndex={-1} role="region" aria-label="Recipe detail">
        {group ? <RecipeDetail group={group} index={index} manifest={manifest} /> : <div><h2>Recipe detail</h2><p className={styles.muted}>Select a recipe to compare its exported rows, allergens, nutrition, yields and costing.</p></div>}
      </div>
    </div>
  </section>;
}

function RecipeDetail({ group, index, manifest }: { group: RecipeGroup; index: RecipeIndex; manifest: FoodManifest }) {
  const rows = group.members.map(position => index.records[position]);
  // Identical rows are shown once; every source row is still listed by number.
  const variants = [...rows.reduce((map, row, position) => { const key = JSON.stringify(row.row); const entry = map.get(key) || { rows: [] as RecipeRecord[], positions: [] as number[] }; entry.rows.push(row); entry.positions.push(position + 1); return map.set(key, entry); }, new Map<string, { rows: RecipeRecord[]; positions: number[] }>()).values()];
  return <div>
    <h2>{group.name || "(no name)"}</h2>
    <p className={styles.muted} style={{ margin: 0 }}>{rows.length} exported row{rows.length === 1 ? "" : "s"} · Kafoodle snapshot {manifest.snapshot}</p>
    {group.exactDuplicateRows > 0 && <p className={`${styles.note}`}>{group.exactDuplicateRows} row{group.exactDuplicateRows === 1 ? " is" : "s are"} an exact duplicate of another row in this group. {group.exactDuplicateRows === 1 ? "It is" : "They are"} kept as exported.</p>}
    {group.conflicts.length > 0 && <>
      <h3>Differences between rows</h3>
      <p className={`${styles.note} ${styles.noteWarn}`}>These rows disagree. The export does not say which is current, so none has been chosen.</p>
      <table className={styles.table}><thead><tr><th scope="col">Field</th>{rows.map((_, position) => <th scope="col" key={position}>Row {position + 1}</th>)}</tr></thead>
        <tbody>{group.conflicts.map(conflict => <tr key={conflict.column}><th scope="row">{conflict.column}</th>{rows.map(row => <td key={row.index}>{row.row[index.columns.indexOf(conflict.column)] || <span className={styles.muted}>blank</span>}</td>)}</tr>)}</tbody></table>
    </>}
    {variants.map(variant => <RecipeRow key={variant.rows[0].index} row={variant.rows[0]} label={rows.length === 1 ? "Exported row" : variant.rows.length > 1 ? `Rows ${variant.positions.join(", ")} (identical)` : `Row ${variant.positions[0]}`} sourceRows={variant.rows.map(item => item.index + 1)} />)}
  </div>;
}

function RecipeRow({ row, label, sourceRows }: { row: RecipeRecord; label: string; sourceRows: number[] }) {
  return <details open style={{ marginTop: 16 }}>
    <summary style={{ minHeight: 44, display: "flex", alignItems: "center", fontWeight: 600, cursor: "pointer" }}>{label} · source row{sourceRows.length === 1 ? "" : "s"} {sourceRows.join(", ")}</summary>
    <dl className={styles.dl}>
      <dt>Reference</dt><dd>{blank(row.reference)}</dd><dt>Description</dt><dd>{blank(row.description)}</dd><dt>Menu</dt><dd>{blank(row.menu)}</dd>
      {row.yields.map(item => <><dt key={`t${item.label}`}>{item.label}</dt><dd key={`d${item.label}`}>{blank(item.value)}</dd></>)}
    </dl>
    <h3>Costing (as exported)</h3>
    <dl className={styles.dl}>{row.costing.map(item => <><dt key={`t${item.label}`}>{item.label}</dt><dd key={`d${item.label}`}>{blank(item.value)}</dd></>)}<dt>Cost entered manually</dt><dd>{blank(row.manualCost)}</dd></dl>
    <p className={styles.muted} style={{ fontSize: "var(--text-xs)" }}>Figures are Kafoodle’s own. The export does not state what quantity or VAT basis each cost covers, so they are not recalculated here.</p>
    <h3>Allergens</h3>
    <Allergens allergens={row.allergens} recorded={row.allergensRecorded} />
    <h3>Nutrition</h3>
    <Nutrition items={row.nutrition} basis={`Per: ${row.yields.find(item => item.label === "Values per")?.value || "not stated"} (from the export). Entered manually: ${row.manualNutrition || "blank"}.`} />
    <h3>Flags marked Yes</h3>
    {row.flags.length ? <ul className={styles.chips}>{row.flags.map(flag => <li key={flag} className={styles.badge}>{flag}</li>)}</ul> : <p className={styles.muted} style={{ margin: 0 }}>None.</p>}
  </details>;
}
