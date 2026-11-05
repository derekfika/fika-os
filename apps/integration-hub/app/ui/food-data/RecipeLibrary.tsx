"use client";
import { useDeferredValue, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { RecipeGroup, RecipeIndex, RecipeRecord } from "@/lib/food-data/recipes";
import type { FoodManifest } from "@/lib/food-data/manifest";
import type { CompositionLoadResult } from "@/lib/food-data/composition-loader";
import { reconcileCompositionBundle } from "@/lib/food-data/compositions";
import type { IngredientRecord } from "@/lib/food-data/ingredients";
import styles from "./food-data.module.css";
import VirtualList from "./VirtualList";
import { Allergens, Field, Nutrition, blank, integer } from "./shared";

const COLS = "minmax(0,4fr) minmax(0,1fr) minmax(0,2fr)";

export default function RecipeLibrary({ index, manifest, composition, compositionError, ingredients }: { index: RecipeIndex; manifest: FoodManifest; composition?: CompositionLoadResult; compositionError?: string; ingredients: IngredientRecord[] }) {
  const [text, setText] = useState(""); const [selected, setSelected] = useState<string | undefined>();
  const [activeLibrary, setActiveLibrary] = useState<"metadata" | "compositions">("metadata");
  const deferred = useDeferredValue(text); const detail = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => index.search(deferred), [index, deferred]);
  const activeIndex = selected === undefined ? -1 : groups.findIndex(group => group.name === selected);
  const group = activeIndex === -1 ? undefined : groups[activeIndex];

  const compositionData = useMemo(() => composition ? reconcileCompositionBundle(composition.bundle, ingredients) : undefined, [composition, ingredients]);
  const compositionGroups = useMemo(() => compositionData?.groups.filter(({ recipe }) => !deferred || `${recipe.recipeName} ${recipe.reference} ${recipe.list}`.toLocaleLowerCase("en-GB").includes(deferred.toLocaleLowerCase("en-GB"))) || [], [compositionData, deferred]);
  const handleLibraryTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const next = event.key === "Home" ? "metadata" : event.key === "End" ? "compositions" : activeLibrary === "metadata" ? "compositions" : "metadata";
    setActiveLibrary(next);
    document.getElementById(next === "metadata" ? "tab-legacy-recipes" : "tab-recipe-compositions")?.focus();
  };

  return <section aria-label="Recipe Library">
    <div className={styles.tabs} role="tablist" aria-label="Recipe data versions">
      <button id="tab-legacy-recipes" role="tab" aria-selected={activeLibrary === "metadata"} aria-controls="panel-legacy-recipes" tabIndex={activeLibrary === "metadata" ? 0 : -1} className={styles.tab} onClick={() => setActiveLibrary("metadata")} onKeyDown={handleLibraryTabKeyDown}>Legacy metadata snapshot</button>
      <button id="tab-recipe-compositions" role="tab" aria-selected={activeLibrary === "compositions"} aria-controls="panel-recipe-compositions" tabIndex={activeLibrary === "compositions" ? 0 : -1} className={styles.tab} onClick={() => setActiveLibrary("compositions")} onKeyDown={handleLibraryTabKeyDown}>Full compositions v2</button>
    </div>
    <div id="panel-legacy-recipes" role="tabpanel" aria-labelledby="tab-legacy-recipes" hidden={activeLibrary !== "metadata"}>
    <p className={`${styles.note} ${styles.noteWarn}`} role="note"><strong>Legacy recipe metadata.</strong> The 31 October snapshot carries names, allergens, nutrition, yields and costing figures, but no ingredient quantities or method. It remains available as exported and is not part of the FIKA OS Dish Library.</p>
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
    </div>
    <div id="panel-recipe-compositions" role="tabpanel" aria-labelledby="tab-recipe-compositions" hidden={activeLibrary !== "compositions"}>
      <CompositionLibrary composition={composition} error={compositionError} data={compositionData} groups={compositionGroups} searchText={text} onSearch={setText} />
    </div>
  </section>;
}

function CompositionLibrary({ composition, error, data, groups, searchText, onSearch }: { composition?: CompositionLoadResult; error?: string; data?: ReturnType<typeof reconcileCompositionBundle>; groups: NonNullable<ReturnType<typeof reconcileCompositionBundle>>["groups"]; searchText: string; onSearch: (value: string) => void }) {
  const [selected, setSelected] = useState<number>();
  const active = selected === undefined ? -1 : groups.findIndex(({ recipe }) => recipe.sourceGroupIndex === selected);
  const selectedGroup = active >= 0 ? groups[active] : undefined;
  if (!composition || !data) return <div className={styles.state} role="status"><h2>Full recipe compositions aren’t available</h2><p>{error || "The separate v2 snapshot has not been imported to this environment yet."} The legacy metadata snapshot remains available above.</p></div>;
  return <>
    <p className={`${styles.note} ${styles.noteWarn}`} role="note"><strong>Review snapshot · NOT APPROVED FOR FOOD LABELS.</strong> This 3 November export preserves source group boundaries and rows. It is not chef approved; allergen declarations, preparation, yield, units and food safety require qualified review.</p>
    <p className={styles.count} role="status" aria-live="polite">{integer.format(groups.length)} of {integer.format(data.groups.length)} source recipe groups · {integer.format(composition.bundle.sourceRows)} ingredient lines · {integer.format(data.counts.matched)} uniquely linked by supplier code · {integer.format(data.counts.ambiguous)} ambiguous · {integer.format(data.counts.missing)} unmatched · {integer.format(data.counts.nestedRecipe)} nested recipe references.</p>
    {composition.warning && <p className={`${styles.note} ${styles.noteWarn}`} role="status">{composition.warning}</p>}
    {data.counts.ambiguous + data.counts.missing + data.counts.nestedRecipe > 0 && <p className={`${styles.note} ${styles.noteWarn}`} role="note">Ingredient names are never used to decide a link. Ambiguous, missing and nested recipe references remain explicitly flagged. No allergen or declaration is inferred.</p>}
    <form className={styles.toolbar} role="search" style={{ gridTemplateColumns: "minmax(0,2fr) auto" }} onSubmit={event => event.preventDefault()}>
      <Field id="comp-search" label="Search recipe name, reference or list"><input id="comp-search" type="search" value={searchText} onChange={event => onSearch(event.target.value)} autoComplete="off" /></Field>
      <span className={`${styles.badge} ${styles.badgeInfo}`}>Snapshot {composition.manifest.exportDate}</span>
    </form>
    <div className={styles.layout}>
      <div className={styles.listCard} aria-label="Composition source groups">
        {groups.length === 0 ? <div className={styles.state}><h2>No composition groups match</h2><p>Try another search or use the search field in the legacy recipe list.</p></div> : groups.map(({ recipe }) => <button key={recipe.sourceGroupIndex} type="button" className={styles.compositionItem} aria-current={selected === recipe.sourceGroupIndex ? "true" : undefined} onClick={() => setSelected(recipe.sourceGroupIndex)}>
          <strong>{recipe.recipeName || "(no name)"}</strong><span>Group {recipe.sourceGroupIndex + 1} · rows {recipe.sourceRowStart}–{recipe.sourceRowEnd}</span><span>Reference {recipe.reference || "not recorded"} · List {recipe.list || "not recorded"}</span>
        </button>)}
      </div>
      <div className={styles.detail} tabIndex={-1} role="region" aria-label="Recipe composition detail">
        {selectedGroup ? <CompositionDetail group={selectedGroup} exportDate={composition.manifest.exportDate} /> : <div><h2>Recipe composition</h2><p className={styles.muted}>Select a source group to inspect every ingredient line, quantity, unit and supplier identifier.</p></div>}
      </div>
    </div>
  </>;
}

function CompositionDetail({ group, exportDate }: { group: NonNullable<ReturnType<typeof reconcileCompositionBundle>>["groups"][number]; exportDate: string }) {
  const { recipe, lines } = group;
  const steps = Object.entries(recipe.metadata).filter(([key, value]) => /^step\s*\d+/i.test(key) && value.trim());
  return <div>
    <h2>{recipe.recipeName || "(no name)"}</h2>
    <p className={styles.muted}>Source group {recipe.sourceGroupIndex + 1} · {recipe.reference ? `Reference ${recipe.reference}` : "No reference"} · {recipe.list ? `List ${recipe.list}` : "No list"} · Kafoodle snapshot {exportDate}</p>
    <p className={`${styles.note} ${styles.noteWarn}`}><strong>NOT APPROVED FOR FOOD LABELS.</strong> This source group does not certify ingredient declarations, allergens, yield, preparation completeness or food-safety compliance.</p>
    <h3>Ingredients ({lines.length} source lines)</h3>
    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th scope="col">Source row</th><th scope="col">Ingredient</th><th scope="col">Ingredient ID</th><th scope="col">Supplier code</th><th scope="col">Quantity</th><th scope="col">Unit</th><th scope="col">Reference check</th></tr></thead>
      <tbody>{lines.map(({ line, match }) => <tr key={line.sourceRow}><th scope="row">{line.sourceRow}</th><td>{line.ingredientName || <span className={styles.muted}>not recorded</span>}{match.status === "matched" && <div className={styles.muted}>v1 product: {match.candidate.name || "(no product name)"}{match.candidate.productCode ? ` · product code ${match.candidate.productCode}` : ""}{match.candidate.supplier ? ` · ${match.candidate.supplier}` : ""}</div>}{match.status === "matched" && match.candidate.declaration && <div className={styles.muted}>Product declaration as exported: {match.candidate.declaration}</div>}</td><td>{line.ingredientId || <span className={styles.muted}>not recorded</span>}</td><td>{line.supplierCode || <span className={styles.muted}>not recorded</span>}{line.supplierName && <div className={styles.muted}>{line.supplierName}</div>}</td><td>{line.quantityRaw || <span className={styles.muted}>not recorded</span>}</td><td>{line.unitRaw || <span className={styles.muted}>not recorded</span>}</td><td><MatchStatus status={match.status} candidates={match.status === "ambiguous" ? match.candidates.length : undefined} /></td></tr>)}</tbody>
    </table></div>
    <h3>Preparation text</h3>
    {steps.length ? <ol>{steps.map(([key, value]) => <li key={key}><strong>{key}:</strong> {value}</li>)}</ol> : <p className={`${styles.note} ${styles.noteWarn}`}>No preparation steps are recorded for this group.</p>}
    <p className={styles.muted}>Exported fields and line order are preserved. Units are shown exactly as exported; no conversion, scaling, ingredient order change or serving yield is inferred.</p>
  </div>;
}

function MatchStatus({ status, candidates }: { status: "matched" | "ambiguous" | "missing" | "nested-recipe"; candidates?: number }) {
  if (status === "matched") return <span className={`${styles.badge} ${styles.badgeOk}`}>Unique supplier code match</span>;
  if (status === "ambiguous") return <span className={`${styles.badge} ${styles.badgeWarn}`}>Ambiguous · {candidates} candidates</span>;
  if (status === "nested-recipe") return <span className={`${styles.badge} ${styles.badgeWarn}`}>Recipe reference · review</span>;
  return <span className={`${styles.badge} ${styles.badgeWarn}`}>Unmatched · review</span>;
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
