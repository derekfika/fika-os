"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { BookingAdditionalChargeInput, BookingAdditionalChargeLabour, CanonicalBooking } from "@/lib/canonical-types";
import { APPROVED_LABOUR_ROLES, MAX_HOURS, MAX_STAFF, OVERTIME_MULTIPLIER, calculateLabour, findApprovedRole, isApprovedLabourLine } from "../../lib/labour-rates";

/** Shared by standalone bookings and each service of a grouped booking: one charge editor, one set of rules. */
type ManualChargeEditor = { kind: "manual"; id?: string; category: "equipment" | "service" | "other"; label: string; quantity: string; unitNet: string };
/** Operators pick only an approved role, staff, hours and Normal/Overtime; rates are locked in lib/labour-rates.ts. */
type LabourChargeEditor = { kind: "labour"; id?: string; label: string; roleId: string; staffCount: string; hoursPerPerson: string; overtime: boolean };
type ChargeEditor = ManualChargeEditor | LabourChargeEditor;

function labourEditorValues(editor: LabourChargeEditor) {
  const result = calculateLabour({ roleId: editor.roleId, staffCount: Number(editor.staffCount), hours: Number(editor.hoursPerPerson), overtime: editor.overtime });
  const role = findApprovedRole(editor.roleId);
  return result.ok
    ? { valid: true as const, roleLabel: result.value.role.label, net: result.value.net }
    : { valid: false as const, roleLabel: role?.label ?? "", net: 0 };
}

function storedChargeInput(charge: NonNullable<CanonicalBooking["additionalCharges"]>[number]): BookingAdditionalChargeInput {
  if (charge.kind === "manual") return { id: charge.id, kind: "manual", category: charge.category, label: charge.label, quantity: charge.quantity, unitNet: charge.unitNet };
  return { id: charge.id, kind: "labour", category: "labour", label: charge.label, labour: structuredClone(charge.labour) };
}

function previewChargeNet(charge: BookingAdditionalChargeInput) {
  const amount = charge.kind === "manual"
    ? charge.quantity * charge.unitNet
    : charge.labour.staffCount * charge.labour.hoursPerPerson * charge.labour.hourlyRate * charge.labour.multiplier;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function chargeCalculationDetail(charge: BookingAdditionalChargeInput) {
  return charge.kind === "manual"
    ? `${charge.category[0].toUpperCase()}${charge.category.slice(1)} · ${charge.quantity} × £${charge.unitNet.toFixed(2)} net`
    : `${charge.labour.roleLabel} · ${charge.labour.staffCount} staff × ${charge.labour.hoursPerPerson.toFixed(2)} hrs × £${charge.labour.hourlyRate.toFixed(2)} × ${charge.labour.multiplier}`;
}

function newStableId() {
  return globalThis.crypto?.randomUUID?.() || `charge_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function AdditionalChargesModal({
  booking,
  context,
  busy,
  onCancel,
  onSave,
}: {
  booking: Pick<CanonicalBooking, "additionalCharges">;
  context?: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (charges: BookingAdditionalChargeInput[]) => Promise<void>;
}) {
  const initialCharges = (booking.additionalCharges || []).map(storedChargeInput);
  const [charges, setCharges] = useState<BookingAdditionalChargeInput[]>(initialCharges);
  const original = useRef(JSON.stringify(initialCharges));
  const [editor, setEditor] = useState<ChargeEditor | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelRef = useRef(onCancel);
  const busyRef = useRef(busy || saving);
  cancelRef.current = onCancel;
  busyRef.current = busy || saving;
  const hasChanges = JSON.stringify(charges) !== original.current;
  const subtotal = charges.reduce((total, charge) => total + previewChargeNet(charge), 0);

  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex='-1'])") || []);
    focusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        cancelRef.current();
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      returnFocus?.focus();
    };
  }, []);

  const openManualEditor = (charge?: Extract<BookingAdditionalChargeInput, { kind: "manual" }>) => {
    setError("");
    setEditor(charge
      ? { kind: "manual", id: charge.id, category: charge.category, label: charge.label, quantity: String(charge.quantity), unitNet: String(charge.unitNet) }
      : { kind: "manual", category: "equipment", label: "", quantity: "1", unitNet: "" });
  };
  const openLabourEditor = (charge?: Extract<BookingAdditionalChargeInput, { kind: "labour" }>) => {
    setError("");
    if (charge) {
      // Only lines at an approved locked rate can be edited; legacy lines are view/remove-only (see the line list).
      if (!isApprovedLabourLine(charge.labour)) return;
      setEditor({ kind: "labour", id: charge.id, label: charge.label, roleId: charge.labour.roleId!, staffCount: String(charge.labour.staffCount), hoursPerPerson: String(charge.labour.hoursPerPerson), overtime: charge.labour.multiplier === OVERTIME_MULTIPLIER });
      return;
    }
    setEditor({ kind: "labour", label: "", roleId: APPROVED_LABOUR_ROLES[0].id, staffCount: "1", hoursPerPerson: "1", overtime: false });
  };
  const changeLabour = (patch: Partial<LabourChargeEditor>) => setEditor((current) => current?.kind === "labour" ? { ...current, ...patch } : current);
  const saveLine = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editor) return;
    setError("");
    if (editor.kind === "manual") {
      const quantity = Number(editor.quantity);
      const unitNet = Number(editor.unitNet);
      if (!editor.label.trim() || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitNet) || unitNet <= 0) {
        setError("Enter a charge name, positive quantity and positive unit net price.");
        return;
      }
      const line: Extract<BookingAdditionalChargeInput, { kind: "manual" }> = { id: editor.id || newStableId(), kind: "manual", category: editor.category, label: editor.label.trim(), quantity, unitNet };
      if (previewChargeNet(line) <= 0 || previewChargeNet(line) > 1_000_000) {
        setError("The calculated line total must be greater than £0 and no more than £1,000,000.");
        return;
      }
      setCharges((current) => editor.id ? current.map((charge) => charge.id === editor.id ? line : charge) : [...current, line]);
    } else {
      const staffCount = Number(editor.staffCount);
      const hoursPerPerson = Number(editor.hoursPerPerson);
      const result = calculateLabour({ roleId: editor.roleId, staffCount, hours: hoursPerPerson, overtime: editor.overtime });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // "governed" = the CEO-approved locked table; the Hub re-validates role, exact rate and 1×/1.5× for every new or changed line.
      const labour: BookingAdditionalChargeLabour = { roleId: result.value.role.id, roleLabel: result.value.role.label, staffCount, hoursPerPerson, hourlyRate: result.value.hourlyRate, multiplier: result.value.multiplier, rateSource: "governed" };
      const label = editor.label.trim() || `${labour.roleLabel} labour`;
      const line: Extract<BookingAdditionalChargeInput, { kind: "labour" }> = { id: editor.id || newStableId(), kind: "labour", category: "labour", label, labour };
      if (previewChargeNet(line) <= 0 || previewChargeNet(line) > 1_000_000) {
        setError("The calculated labour total must be greater than £0 and no more than £1,000,000.");
        return;
      }
      setCharges((current) => editor.id ? current.map((charge) => charge.id === editor.id ? line : charge) : [...current, line]);
    }
    setEditor(null);
  };
  const saveChanges = async () => {
    setError("");
    setSaving(true);
    try {
      await onSave(charges);
    } catch (cause) {
      setError((cause as Error).message || "Could not save Booking charges.");
    } finally {
      setSaving(false);
    }
  };
  const editorLabour = editor?.kind === "labour" ? labourEditorValues(editor) : undefined;
  const labourPreview = editorLabour?.valid ? editorLabour.net : 0;

  return (
    <div className="modal-backdrop additional-charges-backdrop" role="presentation">
      <section className="modal hospitality-action-modal additional-charges-modal" role="dialog" aria-modal="true" aria-labelledby="additional-charges-title" ref={dialogRef}>
        <header className="additional-charges-modal__header">
          <div>
            <p className="eyebrow">{context || "Booking commercial intent"}</p>
            <h2 id="additional-charges-title">Manage additional charges</h2>
          </div>
          <button type="button" aria-label="Close additional charges" onClick={onCancel} disabled={busy || saving}>×</button>
        </header>
        <p>These net charges are saved to the Booking and included in its next quote revision. VAT is applied by the quote settings.</p>
        <div className="additional-charges-modal__actions">
          <button type="button" onClick={() => openManualEditor()}>Add charge</button>
          <button type="button" onClick={() => openLabourEditor()}>Labour calculator</button>
        </div>
        <section className="additional-charge-list" aria-label="Existing additional charges">
          {charges.length === 0 ? <p className="additional-charge-list__empty">No additional charges have been added.</p> : charges.map((charge) => (
            <article className="additional-charge-row" key={charge.id}>
              <div>
                <strong>{charge.label}</strong>
                <small>{chargeCalculationDetail(charge)}</small>
              </div>
              <strong className="additional-charge-row__amount">£{previewChargeNet(charge).toFixed(2)} net</strong>
              <div className="additional-charge-row__actions">
                {charge.kind === "manual" ? <button type="button" onClick={() => openManualEditor(charge)}>Edit</button> : isApprovedLabourLine(charge.labour) ? <button type="button" onClick={() => openLabourEditor(charge)}>Edit</button> : <span className="additional-charge-legacy">Legacy rate · remove to replace</span>}
                <button type="button" onClick={() => setCharges((current) => current.filter((currentCharge) => currentCharge.id !== charge.id))}>Remove</button>
              </div>
            </article>
          ))}
        </section>
        {editor?.kind === "manual" && (
          <form className="additional-charge-editor" onSubmit={saveLine}>
            <h3>{editor.id ? "Edit charge" : "Add charge"}</h3>
            <label>Category<select value={editor.category} onChange={(event) => setEditor({ ...editor, category: event.target.value as ManualChargeEditor["category"] })}><option value="equipment">Equipment</option><option value="service">Service</option><option value="other">Other</option></select></label>
            <label>Name / description<input value={editor.label} maxLength={120} onChange={(event) => setEditor({ ...editor, label: event.target.value })} required /></label>
            <div className="additional-charge-editor__grid">
              <label>Quantity<input type="number" min="0.01" max="1000" step="0.01" value={editor.quantity} onChange={(event) => setEditor({ ...editor, quantity: event.target.value })} required /></label>
              <label>Unit price — net (£)<input type="number" min="0.01" max="1000000" step="0.01" value={editor.unitNet} onChange={(event) => setEditor({ ...editor, unitNet: event.target.value })} required /></label>
            </div>
            <p className="additional-charge-editor__preview" aria-live="polite">Line total · £{(Math.round((Number(editor.quantity) * Number(editor.unitNet) + Number.EPSILON) * 100) / 100 || 0).toFixed(2)} net</p>
            <footer><button type="button" onClick={() => setEditor(null)}>Cancel</button><button className="primary">{editor.id ? "Update charge" : "Add charge"}</button></footer>
          </form>
        )}
        {editor?.kind === "labour" && (
          <form className="additional-charge-editor" onSubmit={saveLine}>
            <h3>{editor.id ? "Edit labour charge" : "Labour calculator"}</h3>
            <label>Role<select value={editor.roleId} onChange={(event) => changeLabour({ roleId: event.target.value })}>
              {APPROVED_LABOUR_ROLES.map((role) => <option key={role.id} value={role.id}>{role.label}</option>)}
            </select></label>
            <label>Charge label<input value={editor.label} placeholder={`${editorLabour?.roleLabel || "Labour"} labour`} maxLength={120} onChange={(event) => changeLabour({ label: event.target.value })} /></label>
            <div className="additional-charge-editor__grid">
              <label>Number of staff<input type="number" min="1" max={MAX_STAFF} step="1" value={editor.staffCount} onChange={(event) => changeLabour({ staffCount: event.target.value })} required /></label>
              <label>Hours per person<input type="number" min="0.25" max={MAX_HOURS} step="0.25" value={editor.hoursPerPerson} onChange={(event) => changeLabour({ hoursPerPerson: event.target.value })} required /></label>
            </div>
            <label>Rate<select value={editor.overtime ? "overtime" : "normal"} onChange={(event) => changeLabour({ overtime: event.target.value === "overtime" })}><option value="normal">Normal</option><option value="overtime">Overtime</option></select></label>
            <div className="additional-charge-editor__preview" role="status" aria-live="polite">
              <strong>{editor.label.trim() || `${editorLabour?.roleLabel || "Labour"} labour`}</strong>
              <span>{editor.staffCount || "0"} staff × {Number(editor.hoursPerPerson || 0).toFixed(2)} hrs × £{(editor.overtime ? (findApprovedRole(editor.roleId)?.overtimeRate ?? 0) : (findApprovedRole(editor.roleId)?.normalRate ?? 0)).toFixed(2)}/hr{editor.overtime ? " (overtime)" : ""}</span>
              <b>£{labourPreview.toFixed(2)} net</b>
            </div>
            <footer><button type="button" onClick={() => setEditor(null)}>Cancel</button><button className="primary">{editor.id ? "Update labour charge" : "Add labour charge"}</button></footer>
          </form>
        )}
        {error && <p className="additional-charges-modal__error" role="alert">{error}</p>}
        <footer className="additional-charges-modal__footer">
          <span>Additional charges subtotal · <strong>£{subtotal.toFixed(2)} net</strong></span>
          <div><button type="button" onClick={onCancel} disabled={busy || saving}>Cancel</button><button type="button" className="primary" onClick={() => void saveChanges()} disabled={!hasChanges || busy || saving}>{busy || saving ? "Saving charges…" : "Save changes"}</button></div>
        </footer>
      </section>
    </div>
  );
}
