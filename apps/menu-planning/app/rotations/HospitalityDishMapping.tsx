"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type MappingItem = { id: string; name: string; category: string; dishId?: string; classification?: string };
export type MappingDish = { id: string; name: string; category: string; revision: number; itemId?: string; hospitalityClass?: string };
export type MappingClassification = { id: string; label: string };
type Props = { styles: Record<string, string>; items: MappingItem[]; dishes: MappingDish[]; classifications: MappingClassification[]; canManage: boolean };

/** Create dishes for rotation weeks and maintain the optional designated catalogue links. */
export default function HospitalityDishMapping({ styles, items, dishes, classifications, canManage }: Props) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [itemId, setItemId] = useState("");
  const [name, setName] = useState("");
  const [classification, setClassification] = useState(classifications[0]?.id || "");
  const [description, setDescription] = useState("");
  const [existingDishId, setExistingDishId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const pending = useRef<{ key: string; requestId: string } | null>(null);
  const inFlight = useRef(false);

  const visible = useMemo(() => items.filter(item => !search.trim() || `${item.name} ${item.category}`.toLocaleLowerCase("en-GB").includes(search.trim().toLocaleLowerCase("en-GB"))), [items, search]);
  const item = items.find(value => value.id === itemId);
  const linkedDish = item?.dishId ? dishes.find(dish => dish.id === item.dishId) : undefined;
  const unlinkedDishes = dishes.filter(dish => !dish.itemId);
  const classLabel = (id?: string) => classifications.find(value => value.id === id)?.label || id || "";

  async function submit(path: string, body: Record<string, unknown>, success: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    const key = JSON.stringify([path, body]);
    const requestId = pending.current?.key === key ? pending.current.requestId : crypto.randomUUID();
    pending.current = { key, requestId };
    setBusy(true); setError(""); setMessage("Saving…");
    try {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, requestId }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error?.message || "The dish or link could not be saved.");
      pending.current = null;
      setMessage(success); setName(""); setDescription(""); setExistingDishId("");
      router.refresh();
    } catch (cause) { setError((cause as Error).message); setMessage(""); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <section className={styles.panel} aria-labelledby="mapping-title" style={{ maxWidth: 1500, margin: "0 auto 16px" }}>
    <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Catalogue to dish mapping</p><h2 id="mapping-title">Hospitality dishes</h2></div><span className={styles.helper}>{items.filter(value => value.dishId).length} of {items.length} catalogue items linked</span></div>
    <p className={styles.helper}>Create Hospitality dishes here, then add them to a row’s dish bank. Choose a catalogue item only when you need to link its designated dish.</p>
    {message && <p className={styles.feedback} role="status">{message}</p>}
    {error && <p className={styles.conflictNotice} role="alert"><strong>Action needed</strong><span>{error}</span></p>}
    <div className={styles.mappingGrid}>
      <label htmlFor="mapping-search">Search Hospitality catalogue<input id="mapping-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search item name or category" /></label>
      <label htmlFor="mapping-item">Designated catalogue link (optional)<select id="mapping-item" value={itemId} disabled={busy} onChange={event => { setItemId(event.target.value); setName(items.find(value => value.id === event.target.value)?.name || ""); setError(""); setMessage(""); }}><option value="">Create a rotation dish without a link</option>{visible.map(value => <option key={value.id} value={value.id}>{value.name} · {value.category}{value.dishId ? " · linked" : ""}</option>)}</select></label>
    </div>
    {item && linkedDish && <p className={styles.linkedState} role="status"><strong>{item.name}</strong><span>Linked to <b>{linkedDish.name}</b> · {classLabel(item.classification)} · recipe revision {linkedDish.revision}</span><small>Dish ID {linkedDish.id}</small></p>}
    {!linkedDish && <div className={styles.mappingGrid} role="group" aria-label={item ? `Link ${item.name}` : "Create a rotation dish"}>
      <label htmlFor="mapping-name">New dish name<input id="mapping-name" value={name} maxLength={160} onChange={event => setName(event.target.value)} disabled={!canManage || busy} /></label>
      <label htmlFor="mapping-class">Hospitality classification<select id="mapping-class" value={classification} onChange={event => setClassification(event.target.value)} disabled={!canManage || busy}>{classifications.map(value => <option key={value.id} value={value.id}>{value.label}</option>)}</select></label>
      <label htmlFor="mapping-description">Description (optional)<input id="mapping-description" value={description} maxLength={500} onChange={event => setDescription(event.target.value)} disabled={!canManage || busy} /></label>
      <button className={styles.primaryButton} type="button" disabled={!canManage || busy || !name.trim() || !classification} onClick={() => void submit("/api/hospitality-rotations/dishes", { ...(item ? { itemId: item.id } : {}), classification, displayName: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) }, item ? `Created and linked “${name.trim()}”.` : `Saved “${name.trim()}” in Hospitality dishes.`)}>Create Hospitality dish</button>
      {item && <>
      <label htmlFor="mapping-existing">Or link an existing hospitality dish<select id="mapping-existing" value={existingDishId} onChange={event => setExistingDishId(event.target.value)} disabled={!canManage || busy || !unlinkedDishes.length}><option value="">{unlinkedDishes.length ? "Choose an unlinked hospitality dish" : "No unlinked hospitality dishes"}</option>{unlinkedDishes.map(dish => <option key={dish.id} value={dish.id}>{dish.name} · {dish.category}</option>)}</select></label>
      <button className={styles.secondaryButton} type="button" disabled={!canManage || busy || !existingDishId || !classification} onClick={() => void submit("/api/hospitality-rotations", { action: "link-dish", itemId: item.id, dishId: existingDishId, classification }, "Linked the existing hospitality dish.")}>Link selected dish</button>
      </>}
    </div>}
    {!canManage && <p className={styles.helper}>Manage access is required to create or link hospitality dishes.</p>}
  </section>;
}
