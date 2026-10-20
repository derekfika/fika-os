"use client";
import { BookingDatePicker, useBookingClock } from "./BookingDatePicker";
import { bookingPolicyFor } from "@fika/server-shared/hospitality-effective-offering";
import { useEffect, useRef, useState } from "react";
import type { CanonicalBooking } from "../../lib/canonical-types";
import type { HospitalityBookingGroup } from "../../../shared/hospitality-group-quotes";
import type { PortalMenuItem } from "../../lib/mnk-contract";
import { amendmentPatchDto } from "../../lib/amendment-dto";
import { loadHospitalityPortalMenu } from "../../lib/hospitality-portal-catalogue";
import styles from "./HospitalityGroupDetail.module.css";

export function GroupAmendmentEditor({ group, site, oplocId, onCancel, onSaved, onBusyChange }: { group: HospitalityBookingGroup; site: string; oplocId: string; onCancel(): void; onSaved(): Promise<void>; onBusyChange(busy: boolean): void }) {
  const now = useBookingClock();
  const [menuReady, setMenuReady] = useState(false);
  const [source, setSource] = useState<{ group: HospitalityBookingGroup; bookings: CanonicalBooking[] }>();
  const [drafts, setDrafts] = useState<CanonicalBooking[]>([]);
  const [menu, setMenu] = useState<PortalMenuItem[]>([]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      if (!oplocId) throw new Error("The governed booking site is unavailable. Refresh before editing.");
      const response = await fetch(`/api/booking-groups/amend?bookingGroupId=${encodeURIComponent(group.id)}`, { cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "The current booking could not be loaded.");
      const bookings = body.bookings as CanonicalBooking[] | undefined;
      if (!bookings?.length || !body.sourceHash || bookings.some(b => b.bookingGroup?.id !== group.id)) throw new Error("The current booking services could not be loaded. Refresh and try again.");
      if (cancelled) return;
      setSource({ group: { ...group, sourceHash: body.sourceHash }, bookings }); setDrafts(structuredClone(bookings));
      const catalogue = await loadHospitalityPortalMenu(site as import("../../lib/portal-sites").PortalSiteKey, oplocId, { signal: controller.signal });
      if (!cancelled) { setMenu(catalogue.menu); setMenuReady(true); }
    })().catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Booking load failed."); });
    return () => { cancelled = true; controller.abort(); };
  }, [group.id, site, oplocId]);
  useEffect(() => { if (source) form.current?.querySelector<HTMLInputElement>("input")?.focus(); }, [source]);
  const change = (index: number, update: (booking: CanonicalBooking) => CanonicalBooking) => setDrafts(rows => rows.map((b, i) => i === index ? update(b) : b));
  const sharedClient = (key: keyof CanonicalBooking["client"], value: string) => setDrafts(rows => rows.map(b => ({ ...b, client: { ...b.client, [key]: value, ...(["name", "email", "phone", "companyName"].includes(key) && b.client.requester ? { requester: { ...b.client.requester, [key]: value } } : {}) } })));
  const save = async () => {
    if (!source || lock.current) return;
    lock.current = true; setSaving(true); onBusyChange(true); setError("");
    try {
      for (const booking of drafts) for (const line of booking.order.items) {
        const item = menu.find(m => [m.id, m.canonicalId].includes(line.itemId));
        if (item && line.quantity < (item.minimumQuantity || 1)) throw new Error(`${item.name} requires at least ${item.minimumQuantity || 1}.`);
        for (const optionGroup of item?.optionGroups || []) {
          const selected = (line.choices as Array<{ id: string; value: unknown }> | undefined)?.find(c => c.id === optionGroup.id)?.value;
          const values = Array.isArray(selected) ? selected : typeof selected === "string" && selected ? [selected] : [];
          if (optionGroup.required && !values.length || values.some(value => !optionGroup.options.some(option => option.label === value))) throw new Error(`Check ${optionGroup.label} for ${item!.name}.`);
        }
      }
      const response = await fetch("/api/booking-groups/amend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingGroupId: source.group.id, expectedSourceHash: source.group.sourceHash, reason, services: drafts.map((b, i) => ({ bookingId: b.canonicalId, expectedVersion: source.bookings[i].version, patch: { ...amendmentPatchDto({ ...b, notes: b.notes || "", deliveryChargeRequired: b.deliveryChargeRequired !== false }), service: { ...amendmentPatchDto({ ...b, notes: b.notes || "", deliveryChargeRequired: b.deliveryChargeRequired !== false }).service, endTime: b.service.endTime || "", floorLevel: b.service.floorLevel || "", roomOrArea: b.service.roomOrArea || "", deliveryPoint: b.service.deliveryPoint || "", onsiteContactName: b.service.onsiteContactName || "", onsiteContactPhone: b.service.onsiteContactPhone || "" }, dietaries: b.dietaries } })) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "The booking amendment could not be saved.");
      await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The amendment could not be confirmed. Refresh before retrying."); }
    finally { lock.current = false; setSaving(false); onBusyChange(false); }
  };
  if (!source) return <section aria-live="polite"><p>{error || "Loading current booking…"}</p><button type="button" onClick={onCancel}>Back to booking</button></section>;
  const first = drafts[0];
  return <form ref={form} className={styles.editor} aria-label="Amend All Day Hospitality booking" onKeyDown={event => { if (event.key === "Escape" && !saving) { event.preventDefault(); onCancel(); } }} onSubmit={event => { event.preventDefault(); void save(); }}>
    <h3 className={styles.editorTitle}>Amend booking</h3>
    <p className={styles.notice}>Save all services together. Changed services return to review; their previous quotes and production handoffs remain in history. Generate an updated group quote before sending changed work to CPU again.</p>
    <fieldset className={styles.section} disabled={saving}><legend>Booking details</legend><div className={styles.fields}>
      {([['name', 'Requester name'], ['email', 'Work email'], ['phone', 'Contact number'], ['companyName', 'Requester company'], ['clientName', 'Client name'], ['clientCompany', 'Client company'], ['invoiceReference', 'Invoice / PO reference']] as const).map(([key, label]) => <label key={key}>{label}<input type={key === "email" ? "email" : "text"} required={["name", "email", "companyName"].includes(key)} value={first.client[key] || ""} onChange={e => sharedClient(key, e.target.value)} /></label>)}
      <label>Event name<input value={drafts[0].notes?.match(/^Event: (.+)$/m)?.[1] || ""} onChange={e => setDrafts(rows => rows.map(b => ({ ...b, notes: `Event: ${e.target.value}\n${(b.notes || "").replace(/^Event: .*\n?/m, "")}` })))} /></label>
      <BookingDatePicker value={first.service.eventDate} onChange={eventDate => setDrafts(rows => rows.map(b => ({ ...b, service: { ...b.service, eventDate } })))} items={drafts.flatMap(b => b.order.items.map(line => menu.find(m => [m.id, m.canonicalId].includes(line.menuItemId || line.itemId)) || { id: line.menuItemId || line.itemId }))} context={{ site, occasion: drafts.some(b => ["event_catering", "dining", "bespoke", "drinks_reception", "bbq"].includes(b.order.eventType || "")) ? "event_catering" : "", startTime: drafts.map(b => b.service.startTime).sort()[0] }} now={now} unavailableReason={!menuReady ? "Current catalogue constraints are loading or unavailable. Please wait or refresh." : undefined} />
    </div></fieldset>
    {drafts.map((b, index) => <fieldset key={b.canonicalId} className={`${styles.section} ${styles.serviceCard}`} disabled={saving}><legend>{b.service.startTime} · {b.order.eventType?.replaceAll("_", " ") || "Hospitality"}</legend><h4 className={styles.subhead}>Service details</h4><div className={`${styles.fields} ${styles.serviceFields}`}>
      <label>Service type<input value={b.order.eventType || ""} onChange={e => change(index, row => ({ ...row, order: { ...row.order, eventType: e.target.value } }))} /></label>
      <label>Service time<input required type="time" value={b.service.startTime} onChange={e => change(index, row => ({ ...row, service: { ...row.service, startTime: e.target.value } }))} /></label>
      <label>End time<input type="time" value={b.service.endTime || ""} onChange={e => change(index, row => ({ ...row, service: { ...row.service, endTime: e.target.value || undefined } }))} /></label>
      <label>Guests<input required type="number" min="1" value={b.service.guestCount} onChange={e => change(index, row => ({ ...row, service: { ...row.service, guestCount: Number(e.target.value) } }))} /></label>
      {([['floorLevel', 'Floor'], ['roomOrArea', 'Room / area'], ['deliveryPoint', 'Delivery point'], ['onsiteContactName', 'On-site contact'], ['onsiteContactPhone', 'On-site telephone']] as const).map(([key, label]) => <label key={key}>{label}<input value={b.service[key] || ""} onChange={e => change(index, row => ({ ...row, service: { ...row.service, [key]: e.target.value } }))} /></label>)}
    </div>
      <h4 className={styles.subhead}>Requested items</h4>{b.order.items.map((item, line) => <div className={styles.itemEditor} key={`${item.itemId}:${line}`}><label className={styles.qty}>{item.itemName || "Requested item"} quantity<input required type="number" min="1" value={item.quantity} onChange={e => change(index, row => ({ ...row, order: { ...row.order, items: row.order.items.map((i, n) => n === line ? { ...i, quantity: Number(e.target.value) } : i) } }))} /></label><label className={styles.itemNotes}>Item notes<input value={item.comments || ""} onChange={e => change(index, row => ({ ...row, order: { ...row.order, items: row.order.items.map((i, n) => n === line ? { ...i, comments: e.target.value } : i) } }))} /></label><GroupItemChoices item={item} menuItem={menu.find(m => [m.id, m.canonicalId].includes(item.itemId))} onChange={choices => change(index, row => ({ ...row, order: { ...row.order, items: row.order.items.map((value, n) => n === line ? { ...value, choices } : value) } }))} /><button type="button" className={styles.remove} onClick={() => change(index, row => ({ ...row, order: { ...row.order, items: row.order.items.filter((_, n) => n !== line) } }))}>Remove item</button></div>)}
      <label className={styles.addItem}>Add requested item<select value="" onChange={e => { const item = menu.find(m => (m.canonicalId || m.id) === e.target.value); if (item) change(index, row => ({ ...row, order: { ...row.order, items: [...row.order.items, { itemId: item.canonicalId || item.id, itemName: item.name, category: item.category, description: item.description, unitPrice: item.unitPrice, quantity: item.minimumQuantity || 1, lineTotal: item.unitPrice * (item.minimumQuantity || 1) }] } })); }}><option value="">Choose a menu item…</option>{menu.filter(m => !(new Date(b.service.eventDate + "T12:00:00Z").getUTCDay() === 5 && (m.bookingPolicy?.fridayUnavailable || bookingPolicyFor(m.id).fridayUnavailable)) && !b.order.items.some(i => i.itemId === (m.canonicalId || m.id))).map(m => <option key={m.canonicalId || m.id} value={m.canonicalId || m.id}>{m.name}</option>)}</select></label>
      <h4 className={styles.subhead}>Dietary, notes and operational details</h4>
      <div className={styles.fields}>{Object.entries(b.dietaries).filter(([key, value]) => (typeof value === "number" || typeof value === "boolean" || typeof value === "string") && key !== "additionalNotes").map(([key, value]) => <label key={key} className={typeof value === "boolean" ? styles.check : undefined}>{key.replaceAll("_", " ")}{typeof value === "boolean" ? <input type="checkbox" checked={value} onChange={e => change(index, row => ({ ...row, dietaries: { ...row.dietaries, [key]: e.target.checked } }))} /> : <input type={typeof value === "number" ? "number" : "text"} min={typeof value === "number" ? "0" : undefined} value={String(value)} onChange={e => change(index, row => ({ ...row, dietaries: { ...row.dietaries, [key]: typeof value === "number" ? Number(e.target.value) : e.target.value } }))} />}</label>)}</div>
      <label className={styles.wide}>Additional dietary notes<textarea value={String(b.dietaries.additionalNotes || "")} onChange={e => change(index, row => ({ ...row, dietaries: { ...row.dietaries, additionalNotes: e.target.value } }))} /></label>
      <label className={styles.wide}>Operational notes<textarea value={b.notes || ""} onChange={e => change(index, row => ({ ...row, notes: e.target.value }))} /></label>
    </fieldset>)}
    <label className={styles.reason}>Reason for amendment<textarea required minLength={3} maxLength={1000} disabled={saving} value={reason} onChange={e => setReason(e.target.value)} /></label>
    {error && <p role="alert" className={styles.error}>{error}</p>}<p role="status" aria-live="polite">{saving ? "Validating and saving all services together…" : ""}</p>
    <div className={`${styles.actions} ${styles.footer}`}><button type="button" disabled={saving} onClick={onCancel}>Cancel edit</button><button type="submit" className="primary" disabled={saving} aria-busy={saving}>Save booking amendment</button></div>
  </form>;
}

/** Uses the portal's existing {id,value} choice shape, retaining unedited choices. */
export function GroupItemChoices({ item, menuItem, onChange }: { item: CanonicalBooking["order"]["items"][number]; menuItem?: PortalMenuItem; onChange(choices: unknown[]): void }) {
  return <>{menuItem?.optionGroups?.map(group => {
    const choices = (item.choices || []) as Array<{ id: string; value: string | string[] }>;
    const current = choices.find(choice => choice.id === group.id)?.value;
    const multiple = ["multi", "multiple", "checkbox", "checkboxes"].includes(group.selectionType.toLowerCase());
    return <label key={group.id}>{group.label}{group.required ? " (required)" : ""}<select required={group.required} multiple={multiple} value={multiple ? Array.isArray(current) ? current : [] : typeof current === "string" ? current : ""} onChange={event => onChange([...choices.filter(choice => choice.id !== group.id), { id: group.id, value: multiple ? Array.from(event.target.selectedOptions, option => option.value) : event.target.value }])}>{!multiple && <option value="">Choose an option…</option>}{group.options.map(option => <option key={option.id} value={option.label}>{option.label}</option>)}</select></label>;
  })}</>;
}
