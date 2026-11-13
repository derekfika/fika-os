"use client";
import { BuffetAmendmentSelector, buffetAmendmentIssue, hasBuffetLine, BuffetDietaryFields, isBuffetDietaryField } from "./BuffetAmendmentSelector";
import { useBuffetConfig } from "./BuffetMenuPicker";
import { BookingDatePicker, useBookingClock } from "./BookingDatePicker";
import { RcoaLocationFields } from "./RcoaLocationFields";
import { rcoaFloorChange } from "@fika/server-shared/rcoa-locations";
import { bookingPolicyFor } from "@fika/server-shared/hospitality-effective-offering";
import { useEffect, useRef, useState } from "react";
import type { CanonicalBooking } from "../../lib/canonical-types";
import type { HospitalityBookingGroup } from "../../../shared/hospitality-group-quotes";
import type { PortalMenuItem } from "../../lib/mnk-contract";
import { amendmentPatchDto } from "../../lib/amendment-dto";
import { loadHospitalityPortalMenu } from "../../lib/hospitality-portal-catalogue";
import { HospitalityAdminAddItem, HospitalityAdminAmendmentReview, hospitalityAdminMenu, staffDietaryField, type AmendmentCatalogue } from "./HospitalityAdminAmendmentReview";
import styles from "./HospitalityGroupDetail.module.css";

export function GroupAmendmentEditor({ group, site, oplocId, onCancel, onSaved, onBusyChange }: { group: HospitalityBookingGroup; site: string; oplocId: string; onCancel(): void; onSaved(projectionPending: boolean): Promise<void>; onBusyChange(busy: boolean): void }) {
  const now = useBookingClock();
  const buffet = useBuffetConfig(site === "rcoa" || site === "mnk");
  const [menuReady, setMenuReady] = useState(false);
  const [source, setSource] = useState<{ group: HospitalityBookingGroup; bookings: CanonicalBooking[] }>();
  const [drafts, setDrafts] = useState<CanonicalBooking[]>([]);
  const [menu, setMenu] = useState<PortalMenuItem[]>([]);
  const [catalogue, setCatalogue] = useState<AmendmentCatalogue>();
  const [adminOplocId, setAdminOplocId] = useState<string>();
  const hospitalityAdmin = Boolean(adminOplocId);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savingKitchenNotes, setSavingKitchenNotes] = useState<string>();
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
      const adminSite = typeof body.hospitalityAdminAuthority?.oplocId === "string" ? body.hospitalityAdminAuthority.oplocId : undefined;
      setAdminOplocId(adminSite);
      const catalogue = await loadHospitalityPortalMenu(site as import("../../lib/portal-sites").PortalSiteKey, adminSite || oplocId, { signal: controller.signal });
      if (adminSite && catalogue.catalogue.source === "cache-unverified") throw new Error("Verify the current site catalogue before amending this booking.");
      if (!cancelled) { setMenu(catalogue.menu); setCatalogue(catalogue); setMenuReady(true); }
    })().catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Booking load failed."); });
    return () => { cancelled = true; controller.abort(); };
  }, [group.id, site, oplocId]);
  useEffect(() => { if (source) form.current?.querySelector<HTMLInputElement>("input")?.focus(); }, [source]);
  const change = (index: number, update: (booking: CanonicalBooking) => CanonicalBooking) => setDrafts(rows => rows.map((b, i) => i === index ? update(b) : b));
  const saveKitchenNotes = async (index: number) => {
    if (!source || savingKitchenNotes) return;
    const booking = drafts[index];
    setSavingKitchenNotes(booking.canonicalId); setError(""); onBusyChange(true);
    try {
      const response = await fetch("/api/dashboard-bookings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ canonicalId: booking.canonicalId, expectedVersion: source.bookings[index].version, action: "save-kitchen-notes", kitchenNotes: booking.kitchenNotes || "" }) });
      const body = await response.json();
      if (!response.ok || !body.booking) throw new Error(body.error?.message || "Kitchen notes could not be saved.");
      setSource(current => current ? { ...current, bookings: current.bookings.map((item, i) => i === index ? body.booking : item) } : current);
      setDrafts(rows => rows.map((item, i) => i === index ? { ...item, version: body.booking.version, updatedAt: body.booking.updatedAt, updatedBy: body.booking.updatedBy, kitchenNotes: body.booking.kitchenNotes, kitchenNotesPropagation: body.booking.kitchenNotesPropagation } : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Kitchen notes could not be saved."); }
    finally { setSavingKitchenNotes(undefined); onBusyChange(false); }
  };
  const sharedClient = (key: keyof CanonicalBooking["client"], value: string) => setDrafts(rows => rows.map(b => ({ ...b, client: { ...b.client, [key]: value, ...(["name", "email", "phone", "companyName"].includes(key) && b.client.requester ? { requester: { ...b.client.requester, [key]: value } } : {}) } })));
  const save = async () => {
    if (!source || lock.current || savingKitchenNotes || hospitalityAdmin && !menuReady) return;
    lock.current = true; setSaving(true); onBusyChange(true); setError("");
    try {
      for (let index = 0; index < drafts.length; index++) {
        const issue = buffetAmendmentIssue(drafts[index].order.items, drafts[index].service.guestCount, source.bookings[index]);
        if (issue) throw new Error(issue);
      }
      if (!hospitalityAdmin) for (const booking of drafts) for (const line of booking.order.items) {
        const item = menu.find(m => [m.id, m.canonicalId].includes(line.itemId));
        if (item && line.quantity < (item.minimumQuantity || 1)) throw new Error(`${item.name} requires at least ${item.minimumQuantity || 1}.`);
        for (const optionGroup of item?.optionGroups || []) {
          const selected = (line.choices as Array<{ id: string; value: unknown }> | undefined)?.find(c => c.id === optionGroup.id)?.value;
          const values = Array.isArray(selected) ? selected : typeof selected === "string" && selected ? [selected] : [];
          if (optionGroup.required && !values.length || values.some(value => !optionGroup.options.some(option => option.label === value))) throw new Error(`Check ${optionGroup.label} for ${item!.name}.`);
        }
      }
      const response = await fetch("/api/booking-groups/amend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bookingGroupId: source.group.id, expectedSourceHash: source.group.sourceHash, reason, ...(hospitalityAdmin ? { hospitalityAdmin: true } : {}), services: drafts.map((b, i) => ({ bookingId: b.canonicalId, expectedVersion: source.bookings[i].version, patch: { ...amendmentPatchDto({ ...b, notes: b.notes || "", deliveryChargeRequired: b.deliveryChargeRequired !== false }), service: { ...amendmentPatchDto({ ...b, notes: b.notes || "", deliveryChargeRequired: b.deliveryChargeRequired !== false }).service, endTime: b.service.endTime || "", floorLevel: b.service.floorLevel || "", roomOrArea: b.service.roomOrArea || "", deliveryPoint: b.service.deliveryPoint || "", onsiteContactName: b.service.onsiteContactName || "", onsiteContactPhone: b.service.onsiteContactPhone || "" }, dietaries: b.dietaries } })) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "The booking amendment could not be saved.");
      await onSaved(hospitalityAdmin && body.projectionPropagation?.status === "pending");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The amendment could not be confirmed. Refresh before retrying."); }
    finally { lock.current = false; setSaving(false); onBusyChange(false); }
  };
  if (!source) return <section aria-live="polite"><p>{error || "Loading current booking…"}</p><button type="button" onClick={onCancel}>Back to booking</button></section>;
  const first = drafts[0];
  const menuFor = (booking: CanonicalBooking) => hospitalityAdmin ? hospitalityAdminMenu(catalogue, booking, adminOplocId) : menu;
  return <form ref={form} className={styles.editor} aria-label="Amend All Day Hospitality booking" onKeyDown={event => { if (event.key === "Escape" && !saving && !(event.target as HTMLElement).closest('[role="dialog"]')) { event.preventDefault(); onCancel(); } }} onSubmit={event => { event.preventDefault(); void save(); }}>
    <h3 className={styles.editorTitle}>Amend booking</h3>
    <p className={styles.notice}>Save all services together. Changed services return to review; their previous quotes and production handoffs remain in history. Generate an updated group quote before sending changed work to CPU again.</p>
    <fieldset className={styles.section} disabled={saving}><legend>Booking details</legend><div className={styles.fields}>
      {([['name', 'Requester name'], ['email', 'Work email'], ['phone', 'Contact number'], ['companyName', 'Requester company'], ['clientName', 'Client name'], ['clientCompany', 'Client company'], ['invoiceReference', 'Invoice / PO reference']] as const).map(([key, label]) => <label key={key}>{label}<input type={key === "email" ? "email" : "text"} required={["name", "email", "companyName"].includes(key)} value={first.client[key] || ""} onChange={e => sharedClient(key, e.target.value)} /></label>)}
      <label>Event name<input value={drafts[0].notes?.match(/^Event: (.+)$/m)?.[1] || ""} onChange={e => setDrafts(rows => rows.map(b => ({ ...b, notes: `Event: ${e.target.value}\n${(b.notes || "").replace(/^Event: .*\n?/m, "")}` })))} /></label>
      <BookingDatePicker hospitalityAdminAmendment={hospitalityAdmin} value={first.service.eventDate} onChange={eventDate => setDrafts(rows => rows.map(b => ({ ...b, service: { ...b.service, eventDate } })))} items={drafts.flatMap(b => b.order.items.map(line => menuFor(b).find(m => [m.id, m.canonicalId].includes(line.menuItemId || line.itemId)) || { id: line.menuItemId || line.itemId }))} context={{ site, occasion: drafts.some(b => ["event_catering", "dining", "bespoke", "drinks_reception", "bbq"].includes(b.order.eventType || "")) ? "event_catering" : "", startTime: drafts.map(b => b.service.startTime).sort()[0] }} now={now} unavailableReason={!menuReady ? "Current catalogue constraints are loading or unavailable. Please wait or refresh." : undefined} />
    </div></fieldset>
    {drafts.map((b, index) => <fieldset key={b.canonicalId} className={`${styles.section} ${styles.serviceCard}`} disabled={saving}><legend>{b.service.startTime} · {b.order.eventType?.replaceAll("_", " ") || "Hospitality"}</legend><h4 className={styles.subhead}>Service details</h4><div className={`${styles.fields} ${styles.serviceFields}`}>
      <label>Service type<input value={b.order.eventType || ""} onChange={e => change(index, row => ({ ...row, order: { ...row.order, eventType: e.target.value } }))} /></label>
      <label>Service time<input required type="time" value={b.service.startTime} onChange={e => change(index, row => ({ ...row, service: { ...row.service, startTime: e.target.value } }))} /></label>
      <label>End time<input type="time" value={b.service.endTime || ""} onChange={e => change(index, row => ({ ...row, service: { ...row.service, endTime: e.target.value || undefined } }))} /></label>
      <label>Guests<input required type="number" min="1" value={b.service.guestCount} onChange={e => change(index, row => ({ ...row, service: { ...row.service, guestCount: Number(e.target.value) } }))} /></label>
      {site === "rcoa" && b.service.portalSiteId === "rcoa" && b.service.oplocId === oplocId ? <RcoaLocationFields floor={b.service.floorLevel || ""} location={b.service.roomOrArea || ""} onFloorChange={value => { const next = rcoaFloorChange(value, b.service.roomOrArea || ""); change(index, row => ({ ...row, service: { ...row.service, floorLevel: next.floor, roomOrArea: next.location } })); }} onLocationChange={value => change(index, row => ({ ...row, service: { ...row.service, roomOrArea: value } }))} /> : ([['floorLevel', 'Floor'], ['roomOrArea', 'Room / area'], ['deliveryPoint', 'Delivery point'], ['onsiteContactName', 'On-site contact'], ['onsiteContactPhone', 'On-site telephone']] as const).map(([key, label]) => <label key={key}>{label}<input value={b.service[key] || ""} onChange={e => change(index, row => ({ ...row, service: { ...row.service, [key]: e.target.value } }))} /></label>)}
    </div>
      <h4 className={styles.subhead}>Requested items</h4>{b.order.items.map((item, line) => <div className={styles.itemEditor} key={`${item.itemId}:${line}`}><label className={styles.qty}>{item.itemName || "Requested item"} quantity<input required type="number" min="1" value={item.quantity} onChange={e => change(index, row => ({ ...row, order: { ...row.order, items: row.order.items.map((i, n) => n === line ? { ...i, quantity: Number(e.target.value) } : i) } }))} /></label><label className={styles.itemNotes}>Item notes<input value={item.comments || ""} onChange={e => change(index, row => ({ ...row, order: { ...row.order, items: row.order.items.map((i, n) => n === line ? { ...i, comments: e.target.value } : i) } }))} /></label><BuffetAmendmentSelector config={buffet.config} line={item} catalogue={menuFor(b)} selectedItemIds={b.order.items.filter((_, n) => n !== line).map(value => value.itemId)} guestCount={b.service.guestCount} dietaryNotes={String(b.dietaries.freeText || "")} onSave={(next, notes) => change(index, row => ({ ...row, order: { ...row.order, items: row.order.items.map((value, n) => n === line ? next : value) }, dietaries: { ...row.dietaries, freeText: notes, ...(notes.trim() ? { hasDietaries: true } : {}) } }))} /><GroupItemChoices item={item} menuItem={menuFor(b).find(m => [m.id, m.canonicalId].includes(item.menuItemId || item.itemId))} onChange={choices => change(index, row => ({ ...row, order: { ...row.order, items: row.order.items.map((value, n) => n === line ? { ...value, choices } : value) } }))} /><button type="button" className={styles.remove} onClick={() => change(index, row => ({ ...row, order: { ...row.order, items: row.order.items.filter((_, n) => n !== line) } }))}>Remove item</button></div>)}
      {hospitalityAdmin ? <HospitalityAdminAddItem menu={menuFor(b)} order={b.order} onAdd={line => change(index, row => ({ ...row, order: { ...row.order, items: [...row.order.items, line] } }))} /> : <label className={styles.addItem}>Add requested item<select value="" onChange={e => { const item = menu.find(m => (m.canonicalId || m.id) === e.target.value); if (item) change(index, row => ({ ...row, order: { ...row.order, items: [...row.order.items, { itemId: item.canonicalId || item.id, itemName: item.name, category: item.category, description: item.description, unitPrice: item.unitPrice, quantity: item.minimumQuantity || 1, lineTotal: item.unitPrice * (item.minimumQuantity || 1) }] } })); }}><option value="">Choose a menu item…</option>{menu.filter(m => !(new Date(b.service.eventDate + "T12:00:00Z").getUTCDay() === 5 && (m.bookingPolicy?.fridayUnavailable || bookingPolicyFor(m.id).fridayUnavailable)) && !b.order.items.some(i => i.itemId === (m.canonicalId || m.id))).map(m => <option key={m.canonicalId || m.id} value={m.canonicalId || m.id}>{m.name}</option>)}</select></label>}
      {hospitalityAdmin && <HospitalityAdminAmendmentReview before={source.bookings[index]} after={b} items={menuFor(b).filter(item => b.order.items.some(line => (line.menuItemId || line.itemId) === item.id))} now={now} />}
      <h4 className={styles.subhead}>Dietary, notes and operational details</h4>
      <div className={styles.fields}>{Object.entries(b.dietaries).filter(([key, value]) => (typeof value === "number" || typeof value === "boolean" || typeof value === "string") && key !== "additionalNotes" && !(hasBuffetLine(b.order.items) && isBuffetDietaryField(key)) && (!hospitalityAdmin || staffDietaryField(key))).map(([key, value]) => <label key={key} className={typeof value === "boolean" ? styles.check : undefined}>{key.replaceAll("_", " ")}{typeof value === "boolean" ? <input type="checkbox" checked={value} onChange={e => change(index, row => ({ ...row, dietaries: { ...row.dietaries, [key]: e.target.checked } }))} /> : <input type={typeof value === "number" ? "number" : "text"} min={typeof value === "number" ? "0" : undefined} value={String(value)} onChange={e => change(index, row => ({ ...row, dietaries: { ...row.dietaries, [key]: typeof value === "number" ? Number(e.target.value) : e.target.value } }))} />}</label>)}{hasBuffetLine(b.order.items) && <BuffetDietaryFields dietaries={b.dietaries} onChange={dietaries => change(index, row => ({ ...row, dietaries }))} />}</div>
      <label className={styles.wide}>Additional dietary notes<textarea value={String(b.dietaries.additionalNotes || "")} onChange={e => change(index, row => ({ ...row, dietaries: { ...row.dietaries, additionalNotes: e.target.value } }))} /></label>
      <label className={styles.wide}>Customer notes<textarea value={b.notes || ""} onChange={e => change(index, row => ({ ...row, notes: e.target.value }))} /></label>
      <label className={styles.wide}>Kitchen-only notes<textarea maxLength={4000} value={b.kitchenNotes || ""} onChange={e => change(index, row => ({ ...row, kitchenNotes: e.target.value }))} /><small>Visible to CPU kitchen only — not included on customer quotes. Kitchen notes do not confirm allergen status or clearance. Record dietary needs in the booking&apos;s dietary fields and complete the formal CPU allergen matrix review.</small></label>
      <div className={styles.wide}><button type="button" disabled={saving || Boolean(savingKitchenNotes) || (b.kitchenNotes || "") === (source.bookings[index].kitchenNotes || "") && source.bookings[index].kitchenNotesPropagation?.status !== "pending"} onClick={() => void saveKitchenNotes(index)}>{savingKitchenNotes === b.canonicalId ? "Saving kitchen notes…" : source.bookings[index].kitchenNotesPropagation?.status === "pending" ? "Retry kitchen notes to CPU" : "Save kitchen notes only"}</button>{source.bookings[index].kitchenNotesPropagation?.status === "pending" && <p role="status">Saved in Hospitality; CPU delivery is pending. Retry notes without changing this service’s quote or menu quantities.</p>}</div>
    </fieldset>)}
    <label className={styles.reason}>Reason for amendment<textarea required minLength={3} maxLength={1000} disabled={saving} value={reason} onChange={e => setReason(e.target.value)} /></label>
    {error && <p role="alert" className={styles.error}>{error}</p>}<p role="status" aria-live="polite">{saving ? "Validating and saving all services together…" : ""}</p>
    <div className={`${styles.actions} ${styles.footer}`}><button type="button" disabled={saving || Boolean(savingKitchenNotes)} onClick={onCancel}>Cancel edit</button><button type="submit" className="primary" disabled={saving || Boolean(savingKitchenNotes) || hospitalityAdmin && !menuReady} aria-busy={saving}>Save booking amendment</button></div>
  </form>;
}

/** Uses the portal's existing {id,value} choice shape, retaining unedited choices. */
export function GroupItemChoices({ item, menuItem, onChange }: { item: CanonicalBooking["order"]["items"][number]; menuItem?: PortalMenuItem; onChange(choices: unknown[]): void }) {
  return <>{menuItem?.optionGroups?.map(group => {
    const choices = (item.choices || []) as Array<{ id: string; value?: string | string[]; quantities?: Record<string, number> }>;
    if (group.selectionType === "quantities") {
      const quantities = choices.find(choice => choice.id === group.id)?.quantities || {};
      return <fieldset key={group.id}><legend>{group.label}</legend>{group.options.map(option => <label key={option.id}>{option.label}
        <input type="number" min="0" step="1" value={quantities[option.id] || 0} onChange={event => onChange([...choices.filter(choice => choice.id !== group.id), { id: group.id, quantities: { ...quantities, [option.id]: Number(event.target.value) } }])} />
      </label>)}</fieldset>;
    }
    const current = choices.find(choice => choice.id === group.id)?.value;
    const multiple = ["multi", "multiple", "checkbox", "checkboxes"].includes(group.selectionType.toLowerCase());
    return <label key={group.id}>{group.label}{group.required ? " (required)" : ""}<select required={group.required} multiple={multiple} value={multiple ? Array.isArray(current) ? current : [] : typeof current === "string" ? current : ""} onChange={event => onChange([...choices.filter(choice => choice.id !== group.id), { id: group.id, value: multiple ? Array.from(event.target.selectedOptions, option => option.value) : event.target.value }])}>{!multiple && <option value="">Choose an option…</option>}{group.options.map(option => <option key={option.id} value={option.label}>{option.label}</option>)}</select></label>;
  })}</>;
}
