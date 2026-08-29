"use client";

import { useEffect, useRef, useState } from "react";
import { CANONICAL_ALLERGEN_COLUMNS, toggleOperationalAllergen, type CanonicalAllergenKey, type OperationalAllergenState } from "../../../shared/allergen-contract";
import type { ProductionOrder } from "../../lib/production-types";
import { allergenReviewKey, type AllergenReviewRow } from "../../lib/production-day";
import { bookingContextEntries } from "./BookingContext";
import { titleCaseDish } from "../../lib/production-presentation";
import "./allergen-review.css";

function stateFor(row: AllergenReviewRow, key: string): OperationalAllergenState | "none" {
  const state = row.snapshot?.allergens[key];
  return state === "contains" || state === "may_contain" ? state : row.snapshot ? "clear" : "none";
}

export default function AllergenReviewMatrix({ rows, orders, onSaved, onCheckedChange, onReviewChanged, onRegisterSave }: { rows: AllergenReviewRow[]; orders: ProductionOrder[]; onSaved?: () => Promise<void>; onCheckedChange?: (checked: number, total: number, keys: Set<string>) => void; onReviewChanged?: () => void; onRegisterSave?: (save: () => Promise<void>) => void }) {
  const [states, setStates] = useState<Record<string, Record<string, OperationalAllergenState>>>(() => Object.fromEntries(rows.map(row => [row.key, { ...(row.snapshot?.allergens || {}) }])) as Record<string, Record<string, OperationalAllergenState>>);
  const [checkedRows, setCheckedRows] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const latestSave = useRef<() => Promise<void>>(() => Promise.resolve());
  const bookingDietaries = [...new Set(orders.flatMap(order => bookingContextEntries(order.bookingDietaries)))];
  const bookingNotes = [...new Set(orders.map(order => order.bookingNotes).filter((note): note is string => Boolean(note?.trim())))];
  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      const saved = new Map<string, { allergens: Record<string, OperationalAllergenState>; completed: boolean }>();
      await Promise.all(orders.map(async order => {
        const response = await fetch(`/api/production-plan?orderId=${encodeURIComponent(order.canonicalId)}`, { cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as { plan?: { menuItems?: Array<{ sourceLineId?: string; subItems?: Array<{ allergens?: Record<string, OperationalAllergenState>; evidenceStatus?: string }> }> } };
        for (const item of body.plan?.menuItems || []) {
          const sub = item.subItems?.[0];
          const line = order.lines.find(candidate => candidate.canonicalId === item.sourceLineId);
          if (item.sourceLineId && sub) {
            const state = { allergens: sub.allergens || {}, completed: sub.evidenceStatus === "completed" };
            saved.set(`${order.origin}:${item.sourceLineId}`, state);
            if (line) saved.set(`${order.origin}:${line.sourceMenuItemId || line.itemName.trim().toLowerCase()}`, state);
          }
        }
      }));
      if (cancelled) return;
      setStates(Object.fromEntries(rows.map(row => {
        const savedState = saved.get(row.key);
        // Newly-created CPU plans intentionally start with an empty allergen
        // object. They must not erase the approved Menu Planning snapshot.
        const hasSavedEvidence = Boolean(savedState && (savedState.completed || Object.keys(savedState.allergens).length > 0));
        return [row.key, hasSavedEvidence ? savedState!.allergens : { ...(row.snapshot?.allergens || {}) }];
      })) as Record<string, Record<string, OperationalAllergenState>>);
      setCheckedRows(new Set(rows.filter(row => { const matchingLines = orders.flatMap(order => order.lines.filter(line => `${order.origin}:${line.sourceMenuItemId || line.itemName.trim().toLowerCase()}` === row.key)); return matchingLines.length > 0 && matchingLines.every(() => saved.get(row.key)?.completed); }).map(row => row.key)));
    };
    void hydrate();
    return () => { cancelled = true; };
  }, [rows, orders]);
  useEffect(() => { onCheckedChange?.(checkedRows.size, rows.length, checkedRows); }, [checkedRows, rows.length, onCheckedChange]);
  const saveReview = async (nextStates: Record<string, Record<string, OperationalAllergenState>>, completedKeys: Set<string>) => {
    await Promise.all(orders.map(order => fetch("/api/production-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save-plan", orderId: order.canonicalId, planningNotes: "CPU Delivered-In allergen review", menuItems: order.lines.map((line, index) => { const key = `${order.origin}:${line.sourceMenuItemId || line.itemName.trim().toLowerCase()}`; return { id: `menu-item:${order.canonicalId}:${index + 1}`, sourceLineId: line.canonicalId, name: line.itemName, note: "", subItems: [{ id: `sub-item:${order.canonicalId}:${index + 1}:1`, name: line.itemName, quantity: line.customerQuantity, allergens: nextStates[key] || {}, note: "", evidenceStatus: completedKeys.has(key) ? "completed" : "not_completed" }] }; }) }) })));
    if (completedKeys.size === rows.length) await Promise.all(orders.map(order => fetch("/api/production-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "mark-planned", orderId: order.canonicalId, planningNotes: "CPU Delivered-In allergen review", menuItems: order.lines.map((line, index) => { const key = `${order.origin}:${line.sourceMenuItemId || line.itemName.trim().toLowerCase()}`; return { id: `menu-item:${order.canonicalId}:${index + 1}`, sourceLineId: line.canonicalId, name: line.itemName, note: "", subItems: [{ id: `sub-item:${order.canonicalId}:${index + 1}:1`, name: line.itemName, quantity: line.customerQuantity, allergens: nextStates[key] || {}, note: "", evidenceStatus: "completed" }] }; }) }) })));
  };
  latestSave.current = () => saveReview(states, checkedRows);
  useEffect(() => { onRegisterSave?.(() => latestSave.current()); }, [onRegisterSave]);
  const markChecked = async (rowKey: string) => {
    if (checkedRows.has(rowKey) || busy) return;
    const nextCheckedRows = new Set(checkedRows); nextCheckedRows.add(rowKey);
    setCheckedRows(nextCheckedRows);
  };
  const toggle = async (rowKey: string, key: string) => {
    if (busy) return;
    const nextStates = { ...states, [rowKey]: toggleOperationalAllergen(states[rowKey] || {}, key as CanonicalAllergenKey) };
    const nextCheckedRows = new Set(checkedRows); nextCheckedRows.delete(rowKey);
    setStates(nextStates); setCheckedRows(nextCheckedRows); onReviewChanged?.(); setError("");
  };
  return <section className="cpu-allergen-matrix-panel" aria-label="CPU allergen matrix">
    {(bookingDietaries.length > 0 || bookingNotes.length > 0) && <section style={{ display: "grid", gap: 5, padding: "13px 15px", border: "1px solid #d8d0f2", borderRadius: 10, background: "#fbfaff", color: "#51486a" }}><h3 style={{ margin: 0, color: "#24115c", fontSize: ".9rem" }}>Booking dietary & notes</h3>{bookingDietaries.length > 0 && <p style={{ margin: 0, fontSize: ".78rem" }}><strong>Dietary / allergen requests:</strong> {bookingDietaries.join(" · ")}</p>}{bookingNotes.length > 0 && <p style={{ margin: 0, fontSize: ".78rem" }}><strong>Booking notes:</strong> {bookingNotes.join(" · ")}</p>}</section>}
    <div className="cpu-allergen-legend" aria-label="Allergen matrix legend"><span><i className="cpu-allergen-state cpu-allergen-state--contains" />Contains</span><span><i className="cpu-allergen-state cpu-allergen-state--may_contain" />May contain</span><span><i className="cpu-allergen-state cpu-allergen-state--clear" />No declaration</span><span><i className="cpu-allergen-state cpu-allergen-state--none" />Not recorded</span><em>Click a cell to cycle its CPU review value.</em></div>
    <div className="cpu-allergen-table-wrap"><table className="cpu-allergen-table"><thead><tr><th>Dish / product</th>{CANONICAL_ALLERGEN_COLUMNS.map(([key, label]) => <th key={key}>{label}</th>)}<th>Approval</th><th>CPU review</th></tr></thead><tbody>{rows.map(row => <tr key={row.key}><th>{titleCaseDish(row.name)}<small>{row.quantity.toLocaleString()} required · {row.destinations.map(item => item.label).join(" · ")}</small>{bookingContextEntries(row.dietaries).length > 0 && <small>Dietary: {bookingContextEntries(row.dietaries).join(" · ")}</small>}{row.notes.map(note => <small key={note}>Note: {note}</small>)}</th>{CANONICAL_ALLERGEN_COLUMNS.map(([key]) => { const state = states[row.key]?.[key] || "clear"; return <td key={key}><button type="button" disabled={busy} className={`cpu-allergen-state cpu-allergen-state--${state}`} aria-label={`${titleCaseDish(row.name)}, ${key}: ${state}`} onClick={() => void toggle(row.key, key)}>{state === "may_contain" ? "MC" : ""}</button></td>; })}<td><span className={row.snapshot ? "cpu-allergen-approved" : "cpu-allergen-missing"}>{row.snapshot ? "Published" : "Not recorded"}</span></td><td><button type="button" className={`cpu-allergen-check ${checkedRows.has(row.key) ? "cpu-allergen-check--done" : ""}`} onClick={() => void markChecked(row.key)} disabled={busy || checkedRows.has(row.key)}>{checkedRows.has(row.key) ? "Checked" : "Mark checked"}</button></td></tr>)}</tbody></table></div>
    <footer className="cpu-allergen-matrix-footer"><span>Review each dish, amend the black/white/MC cells if needed, then mark the dish checked. CPU production chefs and the signing owners are the final allergen authority.</span>{error && <strong role="alert">{error}</strong>}</footer>
  </section>;
}
