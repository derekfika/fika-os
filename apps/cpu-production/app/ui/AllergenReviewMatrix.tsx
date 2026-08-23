"use client";

import { useEffect, useState } from "react";
import { CANONICAL_ALLERGEN_COLUMNS, toggleOperationalAllergen, type CanonicalAllergenKey, type OperationalAllergenState } from "../../../shared/allergen-contract";
import type { ProductionOrder } from "@hub/lib/production-domain";
import type { AllergenReviewRow } from "../../lib/production-day";
import "./allergen-review.css";

function stateFor(row: AllergenReviewRow, key: string): OperationalAllergenState | "none" {
  const state = row.snapshot?.allergens[key];
  return state === "contains" || state === "may_contain" ? state : row.snapshot ? "clear" : "none";
}

function contextValues(values: Record<string, unknown> | undefined) { return Object.entries(values || {}).filter(([, value]) => value !== undefined && value !== null && value !== "" && value !== false && value !== 0).map(([key, value]) => `${key.replaceAll("_", " ")}: ${String(value)}`); }

export default function AllergenReviewMatrix({ rows, orders, onSaved, onPlanned }: { rows: AllergenReviewRow[]; orders: ProductionOrder[]; onSaved?: () => Promise<void>; onPlanned?: (orderIds: string[]) => void }) {
  const [states, setStates] = useState<Record<string, Record<string, OperationalAllergenState>>>(() => Object.fromEntries(rows.map(row => [row.key, { ...(row.snapshot?.allergens || {}) }])) as Record<string, Record<string, OperationalAllergenState>>);
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const bookingDietaries = [...new Set(orders.flatMap(order => contextValues(order.bookingDietaries)))];
  const bookingNotes = [...new Set(orders.map(order => order.bookingNotes).filter((note): note is string => Boolean(note?.trim())))];
  useEffect(() => { setStates(current => Object.fromEntries(rows.map(row => [row.key, current[row.key] || { ...(row.snapshot?.allergens || {}) }])) as Record<string, Record<string, OperationalAllergenState>>); }, [rows]);
  const toggle = (rowKey: string, key: string) => setStates(current => ({ ...current, [rowKey]: toggleOperationalAllergen(current[rowKey] || {}, key as CanonicalAllergenKey) }));
  const save = async () => {
    setBusy(true); setMessage("");
    try {
      await Promise.all(orders.map(order => fetch("/api/production-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "save-plan", orderId: order.canonicalId, planningNotes: "CPU allergen review", menuItems: order.lines.map((line, index) => { const key = `${order.origin}:${line.sourceMenuItemId || line.itemName.trim().toLowerCase()}`; return { id: `menu-item:${order.canonicalId}:${index + 1}`, sourceLineId: line.canonicalId, name: line.itemName, note: "", subItems: [{ id: `sub-item:${order.canonicalId}:${index + 1}:1`, name: line.itemName, quantity: line.customerQuantity, allergens: states[key] || {}, note: "", evidenceStatus: "completed" }] }; }) }) })));
      setMessage("CPU allergen review saved. Published Menu Planning declarations remain unchanged."); await onSaved?.();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "The CPU allergen review could not be saved."); } finally { setBusy(false); }
  };
  const markPlanned = async () => {
    setBusy(true); setMessage("");
    try {
      await Promise.all(orders.map(order => fetch("/api/production-plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "mark-planned", orderId: order.canonicalId, planningNotes: "CPU allergen review", menuItems: order.lines.map((line, index) => { const key = `${order.origin}:${line.sourceMenuItemId || line.itemName.trim().toLowerCase()}`; return { id: `menu-item:${order.canonicalId}:${index + 1}`, sourceLineId: line.canonicalId, name: line.itemName, note: "", subItems: [{ id: `sub-item:${order.canonicalId}:${index + 1}:1`, name: line.itemName, quantity: line.customerQuantity, allergens: states[key] || {}, note: "", evidenceStatus: "completed" }] }; }) }) })));
      setMessage("CPU allergen review marked ready for signature."); onPlanned?.(orders.map(order => order.canonicalId)); await onSaved?.();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "The CPU allergen review could not be marked ready."); } finally { setBusy(false); }
  };
  const acknowledge = async () => {
    setBusy(true); setMessage("");
    const reviewable = orders.filter(order => order.lines.some(line => line.approvedAllergenSnapshot));
    try {
      await Promise.all(reviewable.map(order => fetch("/api/production", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "update-lines", canonicalId: order.canonicalId, expectedVersion: order.version, lines: order.lines.map(line => ({ canonicalId: line.canonicalId, productionQuantity: line.productionQuantity, productionUnit: line.productionUnit, dietaries: line.dietaries, allergenEvidenceStatus: line.approvedAllergenSnapshot ? "confirmed" : line.allergenEvidenceStatus })) }) })));
      setMessage("Approved allergen data acknowledged for CPU production.");
      await onSaved?.();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Approved allergen data could not be acknowledged."); } finally { setBusy(false); }
  };
  return <section className="cpu-allergen-matrix-panel" aria-label="CPU allergen matrix">
    {(bookingDietaries.length > 0 || bookingNotes.length > 0) && <section style={{ display: "grid", gap: 5, padding: "13px 15px", border: "1px solid #d8d0f2", borderRadius: 10, background: "#fbfaff", color: "#51486a" }}><h3 style={{ margin: 0, color: "#24115c", fontSize: ".9rem" }}>Booking dietary & notes</h3>{bookingDietaries.length > 0 && <p style={{ margin: 0, fontSize: ".78rem" }}><strong>Dietary / allergen requests:</strong> {bookingDietaries.join(" · ")}</p>}{bookingNotes.length > 0 && <p style={{ margin: 0, fontSize: ".78rem" }}><strong>Booking notes:</strong> {bookingNotes.join(" · ")}</p>}</section>}
    <div className="cpu-allergen-legend" aria-label="Allergen matrix legend"><span><i className="cpu-allergen-state cpu-allergen-state--contains" />Contains</span><span><i className="cpu-allergen-state cpu-allergen-state--may_contain" />May contain</span><span><i className="cpu-allergen-state cpu-allergen-state--clear" />No declaration</span><span><i className="cpu-allergen-state cpu-allergen-state--none" />Not recorded</span><em>Click a cell to cycle its CPU review value.</em></div>
    <div className="cpu-allergen-table-wrap"><table className="cpu-allergen-table"><thead><tr><th>Dish / product</th>{CANONICAL_ALLERGEN_COLUMNS.map(([key, label]) => <th key={key}>{label}</th>)}<th>Approval</th><th>CPU review</th></tr></thead><tbody>{rows.map(row => <tr key={row.key}><th>{row.name}<small>{row.quantity.toLocaleString()} required · {row.destinations.map(item => item.label).join(" · ")}</small>{contextValues(row.dietaries).length > 0 && <small>Dietary: {contextValues(row.dietaries).join(" · ")}</small>}{row.notes.map(note => <small key={note}>Note: {note}</small>)}</th>{CANONICAL_ALLERGEN_COLUMNS.map(([key]) => { const state = states[row.key]?.[key] || "clear"; return <td key={key}><button type="button" className={`cpu-allergen-state cpu-allergen-state--${state}`} aria-label={`${row.name}, ${key}: ${state}`} onClick={() => toggle(row.key, key)}>{state === "may_contain" ? "MC" : row.snapshot ? "—" : "?"}</button></td>; })}<td><span className={row.snapshot ? "cpu-allergen-approved" : "cpu-allergen-missing"}>{row.snapshot ? "Approved" : "Not recorded"}</span></td><td><span className={row.attention ? "cpu-allergen-attention" : "cpu-allergen-reviewed"}>{row.attention ? "Needs attention" : row.reviewed ? "Reviewed" : "Review pending"}</span></td></tr>)}</tbody></table></div>
    <footer className="cpu-allergen-matrix-footer"><span>Menu Planning remains the allergen authority. CPU edits are saved as the production-plan review layer.</span><div><button type="button" onClick={() => void acknowledge()} disabled={busy || !rows.some(row => row.snapshot)}>{busy ? "Saving…" : "Acknowledge approved data"}</button><button type="button" onClick={() => void save()} disabled={busy || !rows.length}>{busy ? "Saving…" : "Save CPU review"}</button><button type="button" onClick={() => void markPlanned()} disabled={busy || !rows.length}>{busy ? "Saving…" : "Mark ready for signature"}</button></div>{message && <strong role="status">{message}</strong>}</footer>
  </section>;
}
