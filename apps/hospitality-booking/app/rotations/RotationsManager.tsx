"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RotationConfiguration as RotationConfigurationSchema, INITIAL_ROTATION_CATEGORIES, type RotationConfiguration, type RotationHead, type RotationRevision } from "../../../shared/hospitality-rotations";
import { initialRotationConfiguration, rotationActivationStatus, type RotationOption } from "../../lib/rotations-ui-model";

type Permissions = { View: boolean; Manage: boolean; Publish: boolean };
type DishOption = RotationOption & { revision: number };
type ItemOption = { id: string; name: string; category: string };
type Props = { styles: Record<string, string>; permissions: Permissions; initialHead: RotationHead; initialDraft: RotationRevision | null; dishes: DishOption[]; items: ItemOption[] };
type PendingWrite = { key: string; requestId: string };

const weekNumbers = (configuration: RotationConfiguration) => Array.from({ length: configuration.calendar.cycleWeeks }, (_, index) => index + 1);
const nextDateAfter = (date: string) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
};
const todayLondon = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export default function RotationsManager({ styles, permissions, initialHead, initialDraft, dishes, items }: Props) {
  const router = useRouter();
  const [head, setHead] = useState(initialHead);
  const [draft, setDraft] = useState(initialDraft);
  const [configuration, setConfiguration] = useState<RotationConfiguration | null>(initialDraft ? structuredClone(initialDraft.configuration) : null);
  const [selectedGroupId, setSelectedGroupId] = useState(initialDraft?.configuration.groups[0]?.id || "");
  const [groupName, setGroupName] = useState("");
  const [groupCategory, setGroupCategory] = useState<string>(INITIAL_ROTATION_CATEGORIES[0]!.id);
  const [groupItem, setGroupItem] = useState("");
  const [groupDishes, setGroupDishes] = useState<string[]>([]);
  const [categoryLabel, setCategoryLabel] = useState("");
  const [dishSearch, setDishSearch] = useState("");
  const [itemSearch, setItemSearch] = useState("");
  const [publishDate, setPublishDate] = useState(() => {
    const last = initialHead.activations.at(-1)?.effectiveFrom;
    const today = todayLondon();
    return last && last >= today ? nextDateAfter(last) : today;
  });
  const [publishReason, setPublishReason] = useState("");
  const [reviewPublish, setReviewPublish] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<RotationRevision | null>(null);
  const [pendingWrite, setPendingWrite] = useState<PendingWrite | null>(null);
  const pendingRequests = useRef(new Map<string, string>());

  const selectedGroup = configuration?.groups.find((group) => group.id === selectedGroupId) ?? configuration?.groups[0];
  const currentItem = items.find((item) => item.id === selectedGroup?.itemId);
  const dishById = useMemo(() => new Map(dishes.map((dish) => [dish.id, dish])), [dishes]);
  const mappedItems = new Set((configuration?.groups || []).filter((group) => group.id !== selectedGroup?.id).map((group) => group.itemId));
  const visibleDishes = dishes.filter((dish) => !dishSearch.trim() || `${dish.name} ${dish.category}`.toLocaleLowerCase("en-GB").includes(dishSearch.trim().toLocaleLowerCase("en-GB")));
  const visibleItems = items.filter((item) => !itemSearch.trim() || `${item.name} ${item.category}`.toLocaleLowerCase("en-GB").includes(itemSearch.trim().toLocaleLowerCase("en-GB")));
  const lastActivation = head.activations.at(-1);

  const updateConfiguration = (change: (current: RotationConfiguration) => RotationConfiguration) => {
    setConfiguration((current) => current ? change(structuredClone(current)) : current);
    setError(""); setMessage("Unsaved changes. Save the draft to keep them."); setReviewPublish(false);
  };

  async function readRevision(revision: number) {
    setError(""); setMessage("Loading saved revision…");
    try {
      const response = await fetch(`/api/hospitality-rotations?mode=revision&revision=${revision}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Saved revision could not be loaded.");
      const value = body.revision as RotationRevision;
      setHistory(value); setMessage(`Loaded revision ${value.revision} for review.`);
      return value;
    } catch (cause) { setError((cause as Error).message); setMessage(""); throw cause; }
  }

  async function startDraft(revision: number) {
    try {
      const source = await readRevision(revision);
      const next = structuredClone(source.configuration);
      next.label = `${source.configuration.label} seasonal draft`.slice(0, 160);
      setConfiguration(next); setDraft(null); setSelectedGroupId(next.groups[0]?.id || ""); setHistory(null);
      setMessage("Draft prepared from the selected published revision. Review and save it before publication.");
    } catch { /* Error is shown by readRevision. */ }
  }

  async function sendCommand(action: "save-draft" | "publish", body: Record<string, unknown>) {
    const key = JSON.stringify({ action, body });
    const requestId = pendingWrite?.key === key ? pendingWrite.requestId : pendingRequests.current.get(key) || crypto.randomUUID();
    pendingRequests.current.set(key, requestId);
    setPendingWrite({ key, requestId }); setBusy(true); setError(""); setMessage(action === "publish" ? "Publishing the reviewed version…" : "Saving the draft…");
    try {
      const response = await fetch("/api/hospitality-rotations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, action, requestId }) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 409) setError(`${result.error?.message || "The rotation changed elsewhere."} Your edits are still here. Review them against the latest saved version before retrying.`);
        else setError(result.error?.message || "The rotation command could not be completed.");
        setMessage(""); return;
      }
      pendingRequests.current.delete(key); setPendingWrite(null);
      if (action === "save-draft" && configuration) {
        const nextHead = { ...head, version: result.version as number, draftRevision: result.revision as number };
        const nextDraft: RotationRevision = { schema: configuration.schema, revision: result.revision as number, status: "draft", configuration: structuredClone(configuration), actorId: "", recordedAt: new Date().toISOString(), requestId };
        setHead(nextHead); setDraft(nextDraft); setMessage("Draft saved. Changes are recorded in the Hub version history."); setReviewPublish(false);
      } else if (action === "publish") {
        const revision = result.revision as number;
        setHead((current) => ({ ...current, version: result.version as number, draftRevision: undefined, activations: [...current.activations, { effectiveFrom: publishDate, revision }] }));
        setDraft(null); setConfiguration(null); setHistory(null); setPublishReason(""); setReviewPublish(false);
        setMessage(`Revision ${revision} published for ${publishDate}.`);
      }
      router.refresh();
    } catch (cause) {
      setError(`${(cause as Error).message || "The request could not be completed."} Retry the same action to safely check whether it was saved.`); setMessage("");
    } finally { setBusy(false); }
  }

  function saveDraft() {
    if (!configuration || !permissions.Manage) return;
    const parsed = RotationConfigurationSchema.safeParse(configuration);
    if (!parsed.success) { setError(parsed.error.issues.map((issue) => issue.message).join(" ")); return; }
    void sendCommand("save-draft", { expectedVersion: head.version, configuration: parsed.data });
  }

  function addGroup() {
    if (!configuration || !groupName.trim() || !groupItem || !groupDishes.length || mappedItems.has(groupItem)) return;
    const bank = groupDishes.map((id) => dishById.get(id)).filter((dish): dish is DishOption => Boolean(dish)).map((dish) => ({ dishId: dish.id, recipeRevision: dish.revision }));
    if (!bank.length) return;
    const id = crypto.randomUUID(); const first = bank[0]!.dishId;
    updateConfiguration((current) => ({ ...current, groups: [...current.groups, { id, label: groupName.trim(), categoryId: groupCategory, itemId: groupItem, dishBank: bank, weeks: weekNumbers(current).map((week) => ({ week, dishIds: [first] })), rules: structuredClone(current.groups[0]!.rules) }] }));
    setSelectedGroupId(id); setGroupName(""); setGroupItem(""); setGroupDishes([]);
  }

  function addCategory() {
    const label = categoryLabel.trim(); if (!configuration || !label) return;
    const id = label.toLocaleLowerCase("en-GB").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!id || configuration.categories.some((category) => category.id === id)) { setError("Choose a category name that has not already been used."); return; }
    updateConfiguration((current) => ({ ...current, categories: [...current.categories, { id, label }] })); setCategoryLabel("");
  }

  function publish() {
    if (!draft || !permissions.Publish || !publishReason.trim()) return;
    const today = todayLondon();
    if (publishDate < today || (lastActivation && publishDate <= lastActivation.effectiveFrom)) { setError("Choose a date today or later that follows the existing activation calendar."); return; }
    setReviewPublish(true); setError("");
  }

  const page = <main className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>Hospitality · Menu management</p><h1>Rotations</h1><p>One shared {configuration?.calendar.cycleWeeks || initialDraft?.configuration.calendar.cycleWeeks || 6}-week cycle for every group.</p></div><div className={styles.cycleSummary}><span>Authority</span><strong>Hub managed</strong><small>Europe/London calendar · revisioned publication</small></div></header>
    {message && <p className={styles.feedback} role="status">{message}</p>}
    {error && <p className={styles.conflictNotice} role="alert"><strong>Action needed</strong><span>{error}</span>{error.includes("changed elsewhere") && <button className={styles.secondaryButton} type="button" onClick={() => window.location.reload()}>Discard local edits and reload latest</button>}</p>}
    <div className={styles.layout}>
      <aside className={styles.groupRail} aria-label="Rotation groups">
        <div className={styles.sectionHeading}><div><h2>Groups</h2><span>{configuration?.groups.length || 0} in this draft</span></div></div>
        {configuration && <nav className={styles.groupList} aria-label="Choose a rotation group">{configuration.groups.map((group) => <button key={group.id} type="button" aria-current={group.id === selectedGroup?.id ? "page" : undefined} className={`${styles.groupButton} ${group.id === selectedGroup?.id ? styles.groupSelected : ""}`} onClick={() => setSelectedGroupId(group.id)}><span>{group.label}</span><small>{group.dishBank.length} dishes</small></button>)}</nav>}
        {configuration && <form className={styles.addGroupForm} onSubmit={(event) => { event.preventDefault(); addGroup(); }}>
          <label htmlFor="new-rotation-group">Add a group</label><input id="new-rotation-group" value={groupName} onChange={(event) => setGroupName(event.target.value)} maxLength={160} placeholder="Group name" disabled={!permissions.Manage || busy} />
          <label htmlFor="new-group-category">Category</label><select id="new-group-category" value={groupCategory} onChange={(event) => setGroupCategory(event.target.value)} disabled={!permissions.Manage || busy}>{configuration.categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select>
          <label htmlFor="new-group-item-search">Search Hospitality catalogue</label><input id="new-group-item-search" type="search" value={itemSearch} onChange={(event) => setItemSearch(event.target.value)} disabled={!permissions.Manage || busy} placeholder="Search item name or category" />
          <label htmlFor="new-group-item">Hospitality catalogue item</label><select id="new-group-item" value={groupItem} onChange={(event) => setGroupItem(event.target.value)} disabled={!permissions.Manage || busy}><option value="">Choose an active item</option>{visibleItems.filter((item) => !mappedItems.has(item.id)).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.category}</option>)}</select>
          <label htmlFor="new-group-dish-search">Search Dish Library</label><input id="new-group-dish-search" type="search" value={dishSearch} onChange={(event) => setDishSearch(event.target.value)} disabled={!permissions.Manage || busy} placeholder="Search dish name or category" />
          <label htmlFor="new-group-dishes">Dish Library dishes</label><select id="new-group-dishes" multiple value={groupDishes} onChange={(event) => { const shown = new Set(visibleDishes.map((dish) => dish.id)); setGroupDishes([...groupDishes.filter((id) => !shown.has(id)), ...Array.from(event.target.selectedOptions, (option) => option.value)]); }} disabled={!permissions.Manage || busy}>{visibleDishes.map((dish) => <option key={dish.id} value={dish.id}>{dish.name} · {dish.category}</option>)}</select>
          <small>New groups start with the first selected dish in each week; adjust the plan before saving.</small>
          <button className={styles.secondaryButton} type="submit" disabled={!permissions.Manage || busy || !groupName.trim() || !groupItem || !groupDishes.length || mappedItems.has(groupItem)}>Add group</button>
        </form>}
      </aside>

      <div className={styles.workspace}>
        {!configuration && <section className={styles.panel} aria-labelledby="initial-title"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>First configuration</p><h2 id="initial-title">Create the shared rotation</h2></div></div>
          {head.activations.length > 0 ? <p className={styles.helper}>Choose a published revision below and create a seasonal draft from it. The published version remains unchanged.</p> : <InitialDraftForm styles={styles} disabled={!permissions.Manage || busy} onCreate={(input) => { try { const next = initialRotationConfiguration(input); RotationConfigurationSchema.parse(next); setConfiguration(next); setSelectedGroupId(next.groups[0]!.id); setMessage("Initial configuration is ready. Review it and save the draft."); setError(""); } catch (cause) { setError((cause as Error).message); } }} categories={INITIAL_ROTATION_CATEGORIES} items={items} dishes={dishes} />}
          {head.activations.length > 0 && <ul className={styles.historyList}>{head.activations.slice().reverse().map((activation) => <li key={activation.revision}><strong>Revision {activation.revision}</strong><span>Effective {activation.effectiveFrom} · {rotationActivationStatus(head, activation.revision, todayLondon())}<button className={styles.textButton} type="button" disabled={!permissions.Manage || busy} onClick={() => void startDraft(activation.revision)}>Create seasonal draft from this revision</button></span></li>)}</ul>}
        </section>}

        {configuration && <>
          <section className={styles.panel} aria-labelledby="calendar-title"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Shared global calendar</p><h2 id="calendar-title">Calendar and draft</h2></div><span className={styles.status + " " + styles.status_draft}>Draft {draft ? `revision ${draft.revision}` : "not saved"}</span></div>
            <div className={styles.settingsGrid}><label htmlFor="rotation-label">Version name<input id="rotation-label" value={configuration.label} maxLength={160} disabled={!permissions.Manage || busy} onChange={(event) => updateConfiguration((current) => ({ ...current, label: event.target.value }))} /></label><label htmlFor="rotation-anchor">Cycle anchor Monday<input id="rotation-anchor" type="date" value={configuration.calendar.anchorMonday} disabled={!permissions.Manage || busy} onChange={(event) => updateConfiguration((current) => ({ ...current, calendar: { ...current.calendar, anchorMonday: event.target.value } }))} /><small>All groups share this Europe/London cycle.</small></label><label htmlFor="rotation-cycle">Cycle length in weeks<input id="rotation-cycle" type="number" min={1} max={52} value={configuration.calendar.cycleWeeks} disabled={!permissions.Manage || busy} onChange={(event) => { const cycleWeeks = Number(event.target.value); updateConfiguration((current) => ({ ...current, calendar: { ...current.calendar, cycleWeeks }, groups: current.groups.map((group) => ({ ...group, weeks: Array.from({ length: cycleWeeks }, (_, index) => group.weeks.find((week) => week.week === index + 1) || { week: index + 1, dishIds: [] }) })) })); }} /></label><label htmlFor="category-add">Add category<input id="category-add" value={categoryLabel} maxLength={160} disabled={!permissions.Manage || busy} onChange={(event) => setCategoryLabel(event.target.value)} placeholder="Category name" /></label></div>
            <div className={styles.groupActions}><button className={styles.secondaryButton} type="button" disabled={!permissions.Manage || busy || !categoryLabel.trim()} onClick={addCategory}>Add category</button><span>{configuration.categories.length} categories · one shared cycle</span></div>
          </section>

          {selectedGroup && <>
            <section className={styles.panel} aria-labelledby="group-title"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Canonical mapping</p><h2 id="group-title">{selectedGroup.label}</h2></div><button className={styles.textButton} type="button" disabled={!permissions.Manage || busy || configuration.groups.length < 2} onClick={() => { const remaining = configuration.groups.filter((group) => group.id !== selectedGroup.id); updateConfiguration((current) => ({ ...current, groups: remaining })); setSelectedGroupId(remaining[0]?.id || ""); }}>Remove group</button></div>
              <div className={styles.settingsGrid}><label htmlFor="group-label">Group name<input id="group-label" value={selectedGroup.label} maxLength={160} disabled={!permissions.Manage || busy} onChange={(event) => updateConfiguration((current) => ({ ...current, groups: current.groups.map((group) => group.id === selectedGroup.id ? { ...group, label: event.target.value } : group) }))} /></label><label htmlFor="group-category">Category<select id="group-category" value={selectedGroup.categoryId} disabled={!permissions.Manage || busy} onChange={(event) => updateConfiguration((current) => ({ ...current, groups: current.groups.map((group) => group.id === selectedGroup.id ? { ...group, categoryId: event.target.value } : group) }))}>{configuration.categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label><label htmlFor="group-catalogue-item">Hospitality catalogue item<select id="group-catalogue-item" value={selectedGroup.itemId} disabled={!permissions.Manage || busy} onChange={(event) => updateConfiguration((current) => ({ ...current, groups: current.groups.map((group) => group.id === selectedGroup.id ? { ...group, itemId: event.target.value } : group) }))}><option value="">Choose an active Item</option>{items.filter((item) => item.id === selectedGroup.itemId || !mappedItems.has(item.id)).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.category}</option>)}</select><small>{currentItem ? `Canonical Item ID: ${currentItem.id}` : `Canonical Item ID: ${selectedGroup.itemId}`}</small></label></div>
              <div className={styles.libraryGrid}><div className={styles.bankList}><h3>Canonical Dish Library bank</h3>{selectedGroup.dishBank.length ? <ul>{selectedGroup.dishBank.map((dish) => { const option = dishById.get(dish.dishId); return <li key={dish.dishId}><span><strong>{option?.name || dish.dishId}</strong><small>{option?.category || "Canonical dish"} · recipe revision {dish.recipeRevision}</small></span><button className={styles.textButton} type="button" disabled={!permissions.Manage || busy} onClick={() => updateConfiguration((current) => ({ ...current, groups: current.groups.map((group) => group.id === selectedGroup.id ? { ...group, dishBank: group.dishBank.filter((item) => item.dishId !== dish.dishId), weeks: group.weeks.map((week) => ({ ...week, dishIds: week.dishIds.filter((id) => id !== dish.dishId) })) } : group) }))}>Remove</button></li>; })}</ul> : <p className={styles.empty}>Add an active Dish Library record before saving this group.</p>}</div>
                <div className={styles.librarySearch}><label htmlFor="dish-search">Search Dish Library</label><input id="dish-search" type="search" value={dishSearch} onChange={(event) => setDishSearch(event.target.value)} disabled={!permissions.Manage || busy} placeholder="Search dish name or category" /><label htmlFor="dish-bank-add">Add canonical dishes<select id="dish-bank-add" multiple value={selectedGroup.dishBank.map((dish) => dish.dishId).filter((id) => visibleDishes.some((dish) => dish.id === id))} disabled={!permissions.Manage || busy} onChange={(event) => { const shown = new Set(visibleDishes.map((dish) => dish.id)); const chosen = new Set([...selectedGroup.dishBank.map((dish) => dish.dishId).filter((id) => !shown.has(id)), ...Array.from(event.target.selectedOptions, (option) => option.value)]); updateConfiguration((current) => { const group = current.groups.find((item) => item.id === selectedGroup.id)!; const bank = Array.from(chosen).map((id) => { const dish = dishById.get(id); return dish ? { dishId: id, recipeRevision: dish.revision } : group.dishBank.find((entry) => entry.dishId === id); }).filter((dish): dish is NonNullable<typeof dish> => Boolean(dish)); const removed = new Set(group.dishBank.map((entry) => entry.dishId).filter((id) => !chosen.has(id))); return { ...current, groups: current.groups.map((item) => item.id === selectedGroup.id ? { ...item, dishBank: bank, weeks: item.weeks.map((week) => ({ ...week, dishIds: week.dishIds.filter((id) => !removed.has(id)) })) } : item) }; }); }}>{visibleDishes.map((dish) => <option key={dish.id} value={dish.id}>{dish.name} · {dish.category}</option>)}</select></label><small>Use Ctrl or Command to select multiple dishes. Removing a dish also removes it from this group's weeks.</small></div>
              </div>
            </section>

            <section className={styles.panel} aria-labelledby="rules-title"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Ordering rules</p><h2 id="rules-title">Configurable for this catalogue item</h2></div></div><div className={styles.ruleGrid}>
              <NumberField styles={styles} label="Minimum guests" value={selectedGroup.rules.guests.minimum} disabled={!permissions.Manage || busy} onChange={(value) => updateConfiguration((current) => patchRules(current, selectedGroup.id, "guests", "minimum", value))} />
              <NumberField styles={styles} label="Maximum guests" value={selectedGroup.rules.guests.maximum} disabled={!permissions.Manage || busy} onChange={(value) => updateConfiguration((current) => patchRules(current, selectedGroup.id, "guests", "maximum", value))} />
              <NumberField styles={styles} label="Guest increment" value={selectedGroup.rules.guests.increment} disabled={!permissions.Manage || busy} onChange={(value) => updateConfiguration((current) => patchRules(current, selectedGroup.id, "guests", "increment", value))} />
              <NumberField styles={styles} label="Minimum dishes" value={selectedGroup.rules.distinctDishes.minimum} disabled={!permissions.Manage || busy} onChange={(value) => updateConfiguration((current) => patchRules(current, selectedGroup.id, "distinctDishes", "minimum", value))} />
              <NumberField styles={styles} label="Maximum dishes" value={selectedGroup.rules.distinctDishes.maximum} disabled={!permissions.Manage || busy} onChange={(value) => updateConfiguration((current) => patchRules(current, selectedGroup.id, "distinctDishes", "maximum", value))} />
              <NumberField styles={styles} label="Minimum quantity per dish" value={selectedGroup.rules.quantityPerDish.minimum} disabled={!permissions.Manage || busy} onChange={(value) => updateConfiguration((current) => patchRules(current, selectedGroup.id, "quantityPerDish", "minimum", value))} />
              <NumberField styles={styles} label="Maximum quantity per dish" value={selectedGroup.rules.quantityPerDish.maximum} disabled={!permissions.Manage || busy} onChange={(value) => updateConfiguration((current) => patchRules(current, selectedGroup.id, "quantityPerDish", "maximum", value))} />
              <NumberField styles={styles} label="Quantity increment" value={selectedGroup.rules.quantityPerDish.increment} disabled={!permissions.Manage || busy} onChange={(value) => updateConfiguration((current) => patchRules(current, selectedGroup.id, "quantityPerDish", "increment", value))} />
              <label>Quantity unit<input value={selectedGroup.rules.unit} maxLength={60} disabled={!permissions.Manage || busy} onChange={(event) => updateConfiguration((current) => ({ ...current, groups: current.groups.map((group) => group.id === selectedGroup.id ? { ...group, rules: { ...group.rules, unit: event.target.value } } : group) }))} /></label>
            </div></section>

            <section className={styles.panel} aria-labelledby="planner-title"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Shared global calendar</p><h2 id="planner-title">{configuration.calendar.cycleWeeks}-week planner</h2></div><span className={styles.helper}>Keyboard and multi-select controls</span></div><div className={styles.weekGrid}>{weekNumbers(configuration).map((week) => { const planned = selectedGroup.weeks.find((entry) => entry.week === week)?.dishIds || []; return <label className={styles.weekCard} key={week}>Week {week}<select multiple value={planned} disabled={!permissions.Manage || busy} aria-label={`Dishes in week ${week}`} onChange={(event) => { const dishIds = Array.from(event.target.selectedOptions, (option) => option.value); updateConfiguration((current) => ({ ...current, groups: current.groups.map((group) => group.id === selectedGroup.id ? { ...group, weeks: group.weeks.map((entry) => entry.week === week ? { ...entry, dishIds } : entry) } : group) })); }}>{selectedGroup.dishBank.map((dish) => <option key={dish.dishId} value={dish.dishId}>{dishById.get(dish.dishId)?.name || dish.dishId}</option>)}</select><small>Select all dishes offered in this week. Provider validation enforces the configured minimum.</small></label>; })}</div></section>
          </>}

          <section className={styles.panel} aria-labelledby="history-title"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Publication and history</p><h2 id="history-title">Saved revisions</h2></div></div><p className={styles.helper}>Published history is immutable. A new seasonal draft is saved as a revision before it is scheduled or activated.</p>
            <ul className={styles.historyList}>{head.activations.slice().sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom)).map((activation) => <li key={activation.revision}><strong>Revision {activation.revision}</strong><span>{rotationActivationStatus(head, activation.revision, todayLondon())} · effective {activation.effectiveFrom}<button className={styles.textButton} type="button" onClick={() => void readRevision(activation.revision)}>Review saved version</button><button className={styles.textButton} type="button" disabled={!permissions.Manage || Boolean(draft) || busy} onClick={() => void startDraft(activation.revision)}>Start seasonal draft from this version</button></span></li>)}</ul>
            {history && <div className={styles.previewResult} aria-live="polite"><div><span>Revision {history.revision}</span><strong>{history.configuration.label}</strong><small>{history.status === "published" ? `Published ${history.effectiveFrom}` : "Draft"}</small></div><ul>{history.configuration.groups.map((group) => <li key={group.id}><strong>{group.label}</strong><span>{group.weeks.length} weeks · {group.dishBank.length} canonical dishes</span></li>)}</ul></div>}
          </section>

          <section className={styles.panel} aria-labelledby="publish-title"><div className={styles.panelHeading}><div><p className={styles.eyebrow}>Version control</p><h2 id="publish-title">Save and publish</h2></div></div>
            <div className={styles.toolbarActions}><button className={styles.primaryButton} type="button" disabled={!permissions.Manage || busy} onClick={saveDraft}>{busy ? "Saving…" : "Save draft"}</button>{draft && <button className={styles.secondaryButton} type="button" disabled={!permissions.Manage || busy} onClick={() => { setConfiguration(structuredClone(draft.configuration)); setMessage("Restored the saved draft; unsaved edits were discarded."); setError(""); }}>Restore saved draft</button>}</div>
            <div className={styles.settingsGrid}><label htmlFor="publish-date">Effective date<input id="publish-date" type="date" value={publishDate} min={todayLondon()} disabled={!permissions.Publish || !draft || busy} onChange={(event) => setPublishDate(event.target.value)} /><small>Must follow the existing activation calendar.</small></label><label htmlFor="publish-reason">Publication reason<input id="publish-reason" value={publishReason} maxLength={500} disabled={!permissions.Publish || !draft || busy} onChange={(event) => setPublishReason(event.target.value)} /></label></div>
            {!reviewPublish ? <button className={styles.primaryButton} type="button" disabled={!permissions.Publish || !draft || busy || !publishReason.trim()} onClick={publish}>Review publication</button> : <div className={styles.conflictNotice} role="group" aria-label="Review publication"><strong>Publish revision {draft?.revision} on {publishDate}?</strong><span>This will append an immutable published revision. Existing published menus and booking snapshots stay unchanged.</span><div className={styles.toolbarActions}><button className={styles.primaryButton} type="button" disabled={busy} onClick={() => void sendCommand("publish", { expectedVersion: head.version, draftRevision: draft!.revision, effectiveFrom: publishDate, reason: publishReason.trim() })}>{busy ? "Publishing…" : "Confirm publication"}</button><button className={styles.secondaryButton} type="button" disabled={busy} onClick={() => setReviewPublish(false)}>Cancel</button></div></div>}
            {busy && <p role="status" className={styles.helper}>{message}</p>}
          </section>
        </>}
      </div>
    </div>
    <footer className={styles.footer}><strong>Authenticated Hub authority</strong><span>View, Manage and Publish checks run server-side. Dish and catalogue identities are canonical. Writes use expected-version concurrency and audited Hub revisions.</span></footer>
  </main>;
  return page;
}

function patchRules(configuration: RotationConfiguration, groupId: string, section: "guests" | "distinctDishes" | "quantityPerDish", field: string, value: string): RotationConfiguration {
  const number = value === "" ? Number.NaN : Number(value);
  return { ...configuration, groups: configuration.groups.map((group) => group.id !== groupId ? group : { ...group, rules: { ...group.rules, [section]: { ...group.rules[section], [field]: number } } }) } as RotationConfiguration;
}

function NumberField({ label, value, disabled, onChange }: { styles: Record<string, string>; label: string; value: number; disabled: boolean; onChange: (value: string) => void }) {
  return <label>{label}<input type="number" step="any" value={Number.isFinite(value) ? value : ""} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></label>;
}

function InitialDraftForm({ styles, disabled, onCreate, categories, items, dishes }: { styles: Record<string, string>; disabled: boolean; onCreate: (value: { label: string; anchorMonday: string; groupLabel: string; categoryId: string; itemId: string; dishes: DishOption[] }) => void; categories: readonly { id: string; label: string }[]; items: ItemOption[]; dishes: DishOption[] }) {
  const monday = () => { const date = new Date(`${todayLondon()}T12:00:00Z`); const offset = (date.getUTCDay() + 6) % 7; date.setUTCDate(date.getUTCDate() - offset); return date.toISOString().slice(0, 10); };
  const [label, setLabel] = useState("Hospitality Rotation"); const [anchorMonday, setAnchorMonday] = useState(monday); const [groupLabel, setGroupLabel] = useState(""); const [categoryId, setCategoryId] = useState(categories[0]?.id || ""); const [itemId, setItemId] = useState(""); const [dishIds, setDishIds] = useState<string[]>([]);
  return <form className={styles.settingsGrid} onSubmit={(event) => { event.preventDefault(); onCreate({ label, anchorMonday, groupLabel, categoryId, itemId, dishes: dishIds.map((id) => dishes.find((dish) => dish.id === id)).filter((dish): dish is DishOption => Boolean(dish)) }); }}>
    <label htmlFor="initial-name">Rotation name<input id="initial-name" value={label} onChange={(event) => setLabel(event.target.value)} disabled={disabled} maxLength={160} required /></label><label htmlFor="initial-anchor">Cycle anchor Monday<input id="initial-anchor" type="date" value={anchorMonday} onChange={(event) => setAnchorMonday(event.target.value)} disabled={disabled} required /></label>
    <label htmlFor="initial-group">First group name<input id="initial-group" value={groupLabel} onChange={(event) => setGroupLabel(event.target.value)} disabled={disabled} maxLength={160} required /></label><label htmlFor="initial-category">Category<select id="initial-category" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} disabled={disabled}>{categories.map((category) => <option key={category.id} value={category.id}>{category.label}</option>)}</select></label>
    <label htmlFor="initial-item">Canonical Hospitality catalogue Item<select id="initial-item" value={itemId} onChange={(event) => setItemId(event.target.value)} disabled={disabled} required><option value="">Choose an active Item</option>{items.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.category}</option>)}</select></label><label htmlFor="initial-dishes">Canonical Dish Library entries<select id="initial-dishes" multiple value={dishIds} onChange={(event) => setDishIds(Array.from(event.target.selectedOptions, (option) => option.value))} disabled={disabled} required>{dishes.map((dish) => <option key={dish.id} value={dish.id}>{dish.name} · {dish.category}</option>)}</select><small>Select at least one. The first selected dish is placed in all six weeks; review each week afterwards.</small></label>
    <button className={styles.primaryButton} type="submit" disabled={disabled || !groupLabel.trim() || !itemId || !dishIds.length}>Prepare initial draft</button>
  </form>;
}
