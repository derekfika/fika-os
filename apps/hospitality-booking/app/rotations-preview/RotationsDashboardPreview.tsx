"use client";

import { useMemo, useState, type DragEvent } from "react";
import { compareVersions, copyDish, moveDish, rotationWeekForDate, versionForDate } from "../../lib/rotations-ui-model";
import { rotationPreviewFixtures } from "../../lib/rotations-preview-fixtures";
import type { RotationGroup, RotationVersion, RotationWorkspace } from "../../lib/rotations-ui-types";

type DragPayload = { week: number; index: number };
const today = "2026-10-28";

export default function RotationsDashboardPreview({ styles }: { styles: Record<string, string> }) {
  const [workspace, setWorkspace] = useState<RotationWorkspace>(() => structuredClone(rotationPreviewFixtures.workspace));
  const [library] = useState(rotationPreviewFixtures.library);
  const [selectedGroupId, setSelectedGroupId] = useState(workspace.groups[0]?.id ?? "");
  const [selectedVersionId, setSelectedVersionId] = useState(workspace.versions.find((version) => version.status === "draft")?.id ?? "");
  const [compareVersionId, setCompareVersionId] = useState(workspace.versions.find((version) => version.status === "active")?.id ?? "");
  const [search, setSearch] = useState("");
  const [groupName, setGroupName] = useState("");
  const [newGroupCategoryId, setNewGroupCategoryId] = useState(workspace.categories[0]?.id ?? "");
  const [previewDate, setPreviewDate] = useState(today);
  const [feedback, setFeedback] = useState("");
  const [dragPayload, setDragPayload] = useState<DragPayload | null>(null);

  const visibleGroups = workspace.groups.filter((group) => !group.archived);
  const archivedGroups = workspace.groups.filter((group) => group.archived);
  const selectedGroup = visibleGroups.find((group) => group.id === selectedGroupId) ?? visibleGroups[0];
  const selectedVersion = workspace.versions.find((version) => version.id === selectedVersionId) ?? workspace.versions[0];
  const selections = selectedVersion?.weeklySelections ?? {};
  const bankIds = new Set(selectedGroup?.dishBank.map((dish) => dish.canonicalId) ?? []);
  const searchResults = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return library.filter((dish) => !bankIds.has(dish.canonicalId) && (!query || `${dish.name} ${dish.category}`.toLocaleLowerCase().includes(query)));
  }, [bankIds, library, search]);
  const previewVersion = versionForDate(workspace, previewDate);
  const previewWeek = rotationWeekForDate(previewDate, workspace.globalCycle.anchorDate, workspace.globalCycle.lengthWeeks);
  const compareVersion = workspace.versions.find((version) => version.id === compareVersionId && version.id !== selectedVersion?.id)
    ?? workspace.versions.find((version) => version.id !== selectedVersion?.id);
  const versionDifferences = selectedVersion && compareVersion ? compareVersions(workspace, compareVersion.id, selectedVersion.id) : [];

  const updateVersionSelections = (next: RotationVersionSelections) => {
    if (!selectedVersion || selectedVersion.status !== "draft") return;
    setWorkspace((current) => ({ ...current, versions: current.versions.map((version) => version.id === selectedVersion.id ? { ...version, weeklySelections: next } : version) }));
    setFeedback("Preview draft updated in this browser session. Nothing has been saved.");
  };

  const updateGroup = (patch: Partial<RotationGroup>) => {
    if (!selectedGroup) return;
    setWorkspace((current) => ({ ...current, groups: current.groups.map((group) => group.id === selectedGroup.id ? { ...group, ...patch } : group) }));
    setFeedback("Preview changes are local to this browser session.");
  };

  const addGroup = () => {
    const name = groupName.trim();
    if (!name) return;
    const id = `preview-group-${Date.now()}`;
    const group: RotationGroup = {
      id, name, categoryId: newGroupCategoryId, catalogueItemId: null, catalogueItemLabel: null, dishBank: [],
      rules: { guests: { minimum: null, maximum: null, increment: null }, distinctDishes: { minimum: null, maximum: null }, quantityPerDish: { minimum: null, maximum: null, increment: null }, quantityUnit: "" },
    };
    setWorkspace((current) => ({
      ...current,
      groups: [...current.groups, group],
      versions: current.versions.map((version) => ({ ...version, weeklySelections: { ...version.weeklySelections, [id]: { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] } } })),
    }));
    setSelectedGroupId(id);
    setGroupName("");
    setFeedback("Preview group added in this browser session. Nothing has been saved.");
  };

  const addDishToBank = (dishId: string) => {
    const dish = library.find((item) => item.canonicalId === dishId);
    if (!selectedGroup || !dish || bankIds.has(dishId)) return;
    updateGroup({ dishBank: [...selectedGroup.dishBank, dish] });
  };

  const removeDishFromBank = (dishId: string) => {
    if (!selectedGroup) return;
    updateGroup({ dishBank: selectedGroup.dishBank.filter((dish) => dish.canonicalId !== dishId) });
    const next = structuredClone(selectedVersion?.weeklySelections ?? {});
    for (let week = 1; week <= workspace.globalCycle.lengthWeeks; week += 1) {
      const weekDishes = next[selectedGroup.id]?.[week];
      if (weekDishes) next[selectedGroup.id]![week] = weekDishes.filter((id) => id !== dishId);
    }
    updateVersionSelections(next);
  };

  const assignDish = (dishId: string, week: number) => {
    if (!selectedGroup || !selectedVersion || selectedVersion.status !== "draft") return;
    const current = selections[selectedGroup.id]?.[week] ?? [];
    if (!bankIds.has(dishId) || current.includes(dishId)) return;
    const next = structuredClone(selections);
    (next[selectedGroup.id] ??= {})[week] = [...current, dishId];
    updateVersionSelections(next);
  };

  const dropOnWeek = (event: DragEvent<HTMLElement>, week: number) => {
    event.preventDefault();
    const payload = JSON.parse(event.dataTransfer.getData("application/json") || "null") as DragPayload | null;
    const source = payload ?? dragPayload;
    if (!selectedGroup || !selectedVersion || selectedVersion.status !== "draft" || !source) return;
    const current = selections[selectedGroup.id]?.[week] ?? [];
    const next = moveDish(selections, selectedGroup.id, source.week, source.index, week, current.length);
    updateVersionSelections(next);
    setDragPayload(null);
  };

  const reorder = (week: number, index: number, offset: -1 | 1) => {
    if (!selectedGroup || !selectedVersion || selectedVersion.status !== "draft") return;
    const target = index + offset;
    const list = selections[selectedGroup.id]?.[week] ?? [];
    if (target < 0 || target >= list.length) return;
    updateVersionSelections(moveDish(selections, selectedGroup.id, week, index, week, target));
  };

  const duplicateVersion = () => {
    if (!selectedVersion) return;
    const version = { ...structuredClone(selectedVersion), id: `preview-version-${Date.now()}`, name: `${selectedVersion.name} copy`, status: "draft" as const, revision: selectedVersion.revision + 1 };
    setWorkspace((current) => ({ ...current, versions: [...current.versions, version] }));
    setSelectedVersionId(version.id);
    setFeedback("A draft copy was created in this browser session. It has not been saved.");
  };

  const setRule = (ruleSet: "guests" | "distinctDishes" | "quantityPerDish", field: string, value: string) => {
    if (!selectedGroup) return;
    const parsedValue = value === "" ? null : Number(value);
    updateGroup({ rules: { ...selectedGroup.rules, [ruleSet]: { ...selectedGroup.rules[ruleSet], [field]: parsedValue } } });
  };

  const updateVersion = (patch: Partial<RotationVersion>) => {
    if (!selectedVersion || selectedVersion.status !== "draft") return;
    setWorkspace((current) => ({ ...current, versions: current.versions.map((version) => version.id === selectedVersion.id ? { ...version, ...patch } : version) }));
    setFeedback("Preview draft updated in this browser session. Nothing has been saved.");
  };

  if (!selectedGroup || !selectedVersion) return <main className={styles.page}><p>No preview groups are configured.</p></main>;

  return (
    <main className={styles.page}>
      <div className={styles.previewNotice} role="status">
        <strong>Development preview · sample data only</strong>
        <span>This screen is unavailable in production. Changes stay in this browser session and are not saved. The production route requires Sol’s server-enforced permissions and API contract.</span>
      </div>
      <header className={styles.header}>
        <div><p className={styles.eyebrow}>Hospitality · Menu management</p><h1>Rotations</h1><p>One shared six-week cycle for every group.</p></div>
        <div className={styles.cycleSummary} aria-label="Shared rotation calendar">
          <span>Global cycle</span><strong>{workspace.globalCycle.lengthWeeks} weeks</strong><small>Anchor {workspace.globalCycle.anchorDate} · {workspace.globalCycle.timezone}</small>
        </div>
      </header>

      <section className={styles.toolbar} aria-label="Rotation version controls">
        <div className={styles.versionList} role="group" aria-label="Rotation versions">
          {workspace.versions.map((version) => <button key={version.id} type="button" className={`${styles.versionButton} ${version.id === selectedVersion.id ? styles.versionSelected : ""}`} aria-pressed={version.id === selectedVersion.id} onClick={() => setSelectedVersionId(version.id)}>
            <span>{version.name}</span><Status status={version.status} styles={styles} /><small>Revision {version.revision}</small>
          </button>)}
        </div>
        <div className={styles.toolbarActions}>
          <button className={styles.secondaryButton} type="button" onClick={duplicateVersion}>Duplicate version</button>
          <button className={styles.primaryButton} type="button" disabled title="Available when the authoritative activation API is connected">Schedule activation</button>
        </div>
      </section>

      {feedback && <p className={styles.feedback} role="status">{feedback}</p>}
      <div className={styles.layout}>
        <aside className={styles.groupRail} aria-label="Rotation groups">
          <div className={styles.sectionHeading}><div><h2>Groups</h2><span>{workspace.groups.length} configured</span></div></div>
          <nav className={styles.groupList} aria-label="Choose a rotation group">
            {visibleGroups.map((group) => <button key={group.id} type="button" aria-current={group.id === selectedGroup.id ? "page" : undefined} className={`${styles.groupButton} ${group.id === selectedGroup.id ? styles.groupSelected : ""}`} onClick={() => setSelectedGroupId(group.id)}>
              <span>{group.name}</span><small>{group.dishBank.length} dishes</small>
            </button>)}
          </nav>
          {archivedGroups.length > 0 && <details className={styles.archivedGroups}><summary>Archived groups ({archivedGroups.length})</summary><ul>{archivedGroups.map((group) => <li key={group.id}><span>{group.name}</span><button type="button" className={styles.textButton} onClick={() => { setWorkspace((current) => ({ ...current, groups: current.groups.map((item) => item.id === group.id ? { ...item, archived: false } : item) })); setSelectedGroupId(group.id); }}>Restore</button></li>)}</ul></details>}
          <form className={styles.addGroupForm} onSubmit={(event) => { event.preventDefault(); addGroup(); }}>
            <label htmlFor="new-rotation-group">Add a group</label>
            <input id="new-rotation-group" value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="Group name" />
            <label htmlFor="new-rotation-category">Group category</label>
            <select id="new-rotation-category" value={newGroupCategoryId} onChange={(event) => setNewGroupCategoryId(event.target.value)}>{workspace.categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select>
            <button className={styles.secondaryButton} type="submit" disabled={!groupName.trim()}>Add group</button>
          </form>
        </aside>

        <div className={styles.workspace}>
          <section className={styles.panel} aria-labelledby="group-settings-title">
            <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Rotation group</p><h2 id="group-settings-title">{selectedGroup.name}</h2></div><Status status={selectedVersion.status} styles={styles} /></div>
            <div className={styles.settingsGrid}>
              <label>Group name<input value={selectedGroup.name} onChange={(event) => updateGroup({ name: event.target.value })} disabled={selectedVersion.status !== "draft"} /></label>
              <label>Group category<select value={selectedGroup.categoryId} onChange={(event) => updateGroup({ categoryId: event.target.value })} disabled={selectedVersion.status !== "draft"}>{workspace.categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
              <label>Canonical catalogue item ID<input value={selectedGroup.catalogueItemId ?? ""} placeholder="Not linked" onChange={(event) => updateGroup({ catalogueItemId: event.target.value || null })} disabled={selectedVersion.status !== "draft"} /><small>{selectedGroup.catalogueItemLabel ?? "Linking uses the authoritative Hospitality catalogue."}</small></label>
            </div>
            <div className={styles.groupActions}><button className={styles.textButton} type="button" disabled={selectedVersion.status !== "draft"} onClick={() => { setWorkspace((current) => ({ ...current, groups: current.groups.map((group) => group.id === selectedGroup.id ? { ...group, archived: true } : group) })); setSelectedGroupId(visibleGroups.find((group) => group.id !== selectedGroup.id)?.id ?? ""); }}>Archive group</button><span>Archiving behavior is illustrative until the API contract is connected.</span></div>
          </section>

          <section className={styles.panel} aria-labelledby="rules-title">
            <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Customer ordering configuration</p><h2 id="rules-title">Ordering rules</h2></div></div>
            <div className={styles.ruleGrid}>
              <NumberField label="Minimum guests" value={selectedGroup.rules.guests.minimum} disabled={selectedVersion.status !== "draft"} onChange={(value) => setRule("guests", "minimum", value)} />
              <NumberField label="Maximum guests" value={selectedGroup.rules.guests.maximum} disabled={selectedVersion.status !== "draft"} onChange={(value) => setRule("guests", "maximum", value)} />
              <NumberField label="Guest increment" value={selectedGroup.rules.guests.increment} disabled={selectedVersion.status !== "draft"} onChange={(value) => setRule("guests", "increment", value)} />
              <NumberField label="Minimum distinct dishes" value={selectedGroup.rules.distinctDishes.minimum} disabled={selectedVersion.status !== "draft"} onChange={(value) => setRule("distinctDishes", "minimum", value)} />
              <NumberField label="Maximum distinct dishes" value={selectedGroup.rules.distinctDishes.maximum} disabled={selectedVersion.status !== "draft"} onChange={(value) => setRule("distinctDishes", "maximum", value)} />
              <NumberField label="Minimum quantity per dish" value={selectedGroup.rules.quantityPerDish.minimum} disabled={selectedVersion.status !== "draft"} onChange={(value) => setRule("quantityPerDish", "minimum", value)} />
              <NumberField label="Maximum quantity per dish" value={selectedGroup.rules.quantityPerDish.maximum} disabled={selectedVersion.status !== "draft"} onChange={(value) => setRule("quantityPerDish", "maximum", value)} />
              <NumberField label="Quantity increment" value={selectedGroup.rules.quantityPerDish.increment} disabled={selectedVersion.status !== "draft"} onChange={(value) => setRule("quantityPerDish", "increment", value)} />
              <label>Quantity unit<input value={selectedGroup.rules.quantityUnit} onChange={(event) => updateGroup({ rules: { ...selectedGroup.rules, quantityUnit: event.target.value } })} disabled={selectedVersion.status !== "draft"} placeholder="Configured unit" /></label>
            </div>
            <p className={styles.helper}>Values shown here are preview configuration. Eligibility and validation come from the authoritative service.</p>
          </section>

          <section className={styles.panel} aria-labelledby="season-version-title">
            <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Seasonal version</p><h2 id="season-version-title">Version details</h2></div><Status status={selectedVersion.status} styles={styles} /></div>
            <div className={styles.settingsGrid}>
              <label>Version name<input value={selectedVersion.name} disabled={selectedVersion.status !== "draft"} onChange={(event) => updateVersion({ name: event.target.value })} /></label>
              <label>Planned effective date<input type="date" value={selectedVersion.effectiveFrom} disabled={selectedVersion.status !== "draft"} onChange={(event) => updateVersion({ effectiveFrom: event.target.value })} /></label>
            </div>
            <p className={styles.helper}>This date is draft metadata in the preview. The server will resolve activation conflicts and schedule changes.</p>
          </section>

          <section className={styles.panel} aria-labelledby="dish-bank-title">
            <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Canonical Dish Library</p><h2 id="dish-bank-title">Dish bank <span className={styles.count}>{selectedGroup.dishBank.length}</span></h2></div></div>
            <div className={styles.libraryGrid}>
              <div className={styles.bankList}>
                <h3>In this group</h3>
                {selectedGroup.dishBank.length === 0 ? <p className={styles.empty}>No dishes in this group yet.</p> : <ul>{selectedGroup.dishBank.map((dish) => <li key={dish.canonicalId}><span><strong>{dish.name}</strong><small>{dish.category} · {dish.canonicalId}</small></span><button className={styles.textButton} type="button" disabled={selectedVersion.status !== "draft"} onClick={() => removeDishFromBank(dish.canonicalId)}>Remove</button></li>)}</ul>}
              </div>
              <div className={styles.librarySearch}>
                <label htmlFor="dish-library-search">Search Dish Library</label>
                <input id="dish-library-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Dish name or category" />
                <ul>{searchResults.map((dish) => <li key={dish.canonicalId}><span><strong>{dish.name}</strong><small>{dish.category}</small></span><button className={styles.secondaryButton} type="button" disabled={selectedVersion.status !== "draft"} onClick={() => addDishToBank(dish.canonicalId)}>Add</button></li>)}</ul>
                {searchResults.length === 0 && <p className={styles.empty}>No matching dishes. The production library search is not connected in this preview.</p>}
              </div>
            </div>
          </section>

          <section className={styles.panel} aria-labelledby="planner-title">
            <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Shared global calendar</p><h2 id="planner-title">Six-week planner</h2></div><span className={styles.helper}>Drag to move · keyboard buttons also available</span></div>
            <div className={styles.weekGrid}>
              {Array.from({ length: workspace.globalCycle.lengthWeeks }, (_, index) => index + 1).map((week) => {
                const ids = selections[selectedGroup.id]?.[week] ?? [];
                return <section key={week} className={styles.weekCard} aria-labelledby={`week-${week}-title`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => dropOnWeek(event, week)}>
                  <div className={styles.weekHeading}><h3 id={`week-${week}-title`}>Week {week}</h3><span>{ids.length} selected</span></div>
                  <ul className={styles.weekDishes}>
                    {ids.map((dishId, index) => {
                      const dish = selectedGroup.dishBank.find((item) => item.canonicalId === dishId);
                      if (!dish) return null;
                      return <li key={`${dishId}-${index}`} draggable={selectedVersion.status === "draft"} onDragStart={(event) => { const payload = { week, index }; setDragPayload(payload); event.dataTransfer.setData("application/json", JSON.stringify(payload)); event.dataTransfer.effectAllowed = "move"; }}>
                        <span className={styles.dragGrip} aria-hidden="true">⠿</span><span className={styles.dishName}>{dish.name}</span>
                        <div className={styles.itemActions}>
                          <button className={styles.iconButton} type="button" aria-label={`Move ${dish.name} up in week ${week}`} disabled={selectedVersion.status !== "draft" || index === 0} onClick={() => reorder(week, index, -1)}>↑</button>
                          <button className={styles.iconButton} type="button" aria-label={`Move ${dish.name} down in week ${week}`} disabled={selectedVersion.status !== "draft" || index === ids.length - 1} onClick={() => reorder(week, index, 1)}>↓</button>
                          <button className={styles.iconButton} type="button" aria-label={`Copy ${dish.name} to week ${week === workspace.globalCycle.lengthWeeks ? 1 : week + 1}`} disabled={selectedVersion.status !== "draft"} onClick={() => { const target = week === workspace.globalCycle.lengthWeeks ? 1 : week + 1; updateVersionSelections(copyDish(selections, selectedGroup.id, week, index, target, selections[selectedGroup.id]?.[target]?.length ?? 0)); }}>⧉</button>
                          <button className={styles.iconButton} type="button" aria-label={`Remove ${dish.name} from week ${week}`} disabled={selectedVersion.status !== "draft"} onClick={() => { const next = structuredClone(selections); next[selectedGroup.id]![week] = ids.filter((_, dishIndex) => dishIndex !== index); updateVersionSelections(next); }}>×</button>
                        </div>
                      </li>;
                    })}
                  </ul>
                  {selectedGroup.dishBank.length > 0 && <label className={styles.assignField}>Add a bank dish<select aria-label={`Add Dish Library selection to week ${week}`} value="" disabled={selectedVersion.status !== "draft"} onChange={(event) => { if (event.target.value) assignDish(event.target.value, week); }}><option value="">Choose a dish</option>{selectedGroup.dishBank.filter((dish) => !ids.includes(dish.canonicalId)).map((dish) => <option key={dish.canonicalId} value={dish.canonicalId}>{dish.name}</option>)}</select></label>}
                  {ids.length === 0 && <p className={styles.empty}>No dishes planned for this week.</p>}
                </section>;
              })}
            </div>
            {selectedVersion.status !== "draft" && <p className={styles.helper}>Active and scheduled versions are read-only in this preview.</p>}
          </section>

          <section className={styles.panel} aria-labelledby="preview-title">
            <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Event-date preview</p><h2 id="preview-title">Future menu selection</h2></div></div>
            <div className={styles.previewControls}><label htmlFor="event-date">Event date<input id="event-date" type="date" value={previewDate} onInput={(event) => setPreviewDate(event.currentTarget.value)} onChange={(event) => setPreviewDate(event.target.value)} /></label><p>Shared calendar · Week {previewWeek}</p></div>
            {previewVersion ? <div className={styles.previewResult}><div><span>Version</span><strong>{previewVersion.name}</strong><Status status={previewVersion.status} styles={styles} /><small>Effective {previewVersion.effectiveFrom}</small></div><ul>{visibleGroups.map((group) => {
              const ids = previewVersion.weeklySelections[group.id]?.[previewWeek] ?? [];
              return <li key={group.id}><strong>{group.name}</strong><span>{ids.map((id) => group.dishBank.find((dish) => dish.canonicalId === id)?.name ?? "Dish unavailable").join(", ") || "No dishes configured"}</span></li>;
            })}</ul></div> : <p className={styles.empty}>No active or scheduled version covers this date.</p>}
          </section>

          <section className={styles.panel} aria-labelledby="compare-title">
            <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Version comparison</p><h2 id="compare-title">Compare weekly menus</h2></div></div>
            <div className={styles.compareControls}><label htmlFor="compare-version">Compare with<select id="compare-version" value={compareVersion?.id ?? ""} onChange={(event) => setCompareVersionId(event.target.value)}>{workspace.versions.filter((version) => version.id !== selectedVersion.id).map((version) => <option key={version.id} value={version.id}>{version.name} · {version.status}</option>)}</select></label><span>Showing differences in weekly dish selections.</span></div>
            {versionDifferences.length ? <ul className={styles.differenceList}>{versionDifferences.map((difference) => {
              const group = workspace.groups.find((item) => item.id === difference.groupId);
              const names = (ids: string) => ids === "No dishes" ? ids : ids.split(", ").map((id) => group?.dishBank.find((dish) => dish.canonicalId === id)?.name ?? id).join(", ");
              return <li key={`${difference.groupId}-${difference.field}`}><strong>{difference.groupLabel} · {difference.field}</strong><span>{names(difference.left)} <b aria-hidden="true">→</b> {names(difference.right)}</span></li>;
            })}</ul> : <p className={styles.empty}>No weekly dish differences between these preview versions.</p>}
          </section>

          <section className={styles.panel} aria-labelledby="activation-history-title">
            <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Activation and history</p><h2 id="activation-history-title">Status and changes</h2></div></div>
            <p className={styles.conflictNotice}><strong>Activation conflicts: Not checked.</strong><span>The authoritative publish service must evaluate date conflicts before activation.</span></p>
            <ul className={styles.historyList}>{workspace.versions.slice().sort((left, right) => right.revision - left.revision).map((version) => <li key={version.id}><strong>Revision {version.revision} · {version.name}</strong><span>{version.status[0]!.toUpperCase() + version.status.slice(1)} · effective {version.effectiveFrom}</span></li>)}</ul>
            <p className={styles.helper}>These are sample version records. Actor-stamped edit history is provided by the Hub after contract integration; preview edits are not audited or saved.</p>
          </section>
        </div>
      </div>
      <footer className={styles.footer}><strong>Contract status: pending Sol handoff</strong><span>Save, activate and production catalogue/library calls remain unavailable until the authenticated API adapter is implemented.</span></footer>
    </main>
  );
}

type RotationVersionSelections = RotationWorkspace["versions"][number]["weeklySelections"];

function NumberField({ label, value, disabled, onChange }: { label: string; value: number | null; disabled: boolean; onChange: (value: string) => void }) {
  return <label>{label}<input type="number" step="any" value={value ?? ""} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Status({ status, styles }: { status: "draft" | "scheduled" | "active"; styles: Record<string, string> }) {
  return <span role="status" className={`${styles.status} ${styles[`status_${status}`]}`}><span aria-hidden="true" />{status[0]!.toUpperCase() + status.slice(1)}</span>;
}
