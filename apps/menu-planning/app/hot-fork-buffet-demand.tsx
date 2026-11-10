"use client";
import { useEffect, useMemo, useState } from "react";

type DemandBooking = { bookingId: string; bookingReference: string; serviceDate: string; serviceTime: string; oplocId: string; siteName: string; clientName: string; guestCount: number; bookingStatus: string; cancelled: boolean; alreadyHandedToCpu: boolean; portionAllocationStatus: "manual-review-required" };
type DemandSnapshot = { serviceDate: string; oplocId: string; bookings: Array<{ bookingId: string; guestCount: number }>; entryQuantities: Array<{ entryId: string; quantity: number }> };

export default function HotForkBuffetDemand({ weekId, weekVersion, weekCommencing, weekEnding, demandSnapshots = [], portionQuantities = [], allowAllocationConfirm = false, hasUnsavedPortions = false, onConfirmed }: { weekId?: string; weekVersion?: number; weekCommencing: string; weekEnding: string; demandSnapshots?: DemandSnapshot[]; portionQuantities?: Array<{ serviceDate: string; entryId: string; oplocId: string; quantity: number }>; allowAllocationConfirm?: boolean; hasUnsavedPortions?: boolean; onConfirmed?: () => void }) {
  const [rows, setRows] = useState<DemandBooking[]>([]);
  const [error, setError] = useState("");
  const [savingKey, setSavingKey] = useState("");
  const from = weekCommencing;
  const to = useMemo(() => { const date = new Date(`${weekEnding}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); }, [weekEnding]);
  useEffect(() => {
    let active = true;
    void fetch(`/api/hospitality-buffet-demand?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { cache: "no-store" })
      .then(async response => { const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error?.message || "Buffet demand is unavailable."); return body.bookings as DemandBooking[]; })
      .then(value => { if (active) { setRows(Array.isArray(value) ? value : []); setError(""); } })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : "Buffet demand is unavailable."); });
    return () => { active = false; };
  }, [from, to]);
  const active = rows.filter(row => !row.cancelled);
  const cancelled = rows.filter(row => row.cancelled);
  const guestSummary = active.filter(row => !row.alreadyHandedToCpu).reduce((sum, row) => sum + (Number.isFinite(row.guestCount) ? row.guestCount : 0), 0);
  const groups = new Map<string, DemandBooking[]>();
  for (const row of active) { const key = `${row.serviceDate}|${row.oplocId}`; groups.set(key, [...(groups.get(key) || []), row]); }
  const confirmedFor = (rowsForDay: DemandBooking[]) => {
    const first = rowsForDay[0];
    const snapshot = demandSnapshots.find(item => item.serviceDate === first.serviceDate && item.oplocId === first.oplocId);
    if (!snapshot) return "Manual allocation required";
    const bookingsMatch = JSON.stringify(snapshot.bookings.slice().sort((a, b) => a.bookingId.localeCompare(b.bookingId))) === JSON.stringify(rowsForDay.filter(row => !row.alreadyHandedToCpu).map(row => ({ bookingId: row.bookingId, guestCount: row.guestCount })).sort((a, b) => a.bookingId.localeCompare(b.bookingId)));
    const quantities = portionQuantities.filter(item => item.serviceDate === first.serviceDate && item.oplocId === first.oplocId && item.quantity > 0).map(item => ({ entryId: item.entryId, quantity: item.quantity })).sort((a, b) => a.entryId.localeCompare(b.entryId));
    const quantitiesMatch = JSON.stringify(snapshot.entryQuantities) === JSON.stringify(quantities);
    return bookingsMatch && quantitiesMatch ? "Demand reviewed · portions unchanged" : "Demand changed · review portions";
  };
  const confirm = async (rowsForDay: DemandBooking[]) => {
    const first = rowsForDay[0];
    const key = `${first.serviceDate}|${first.oplocId}`;
    setSavingKey(key); setError("");
    try {
      const response = await fetch("/api/rolling-menu", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "confirm-hospitality-demand-allocation", weekId, expectedWeekVersion: weekVersion, serviceDate: first.serviceDate, oplocId: first.oplocId }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message || "Portion review could not be confirmed.");
      onConfirmed?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Portion review could not be confirmed."); }
    finally { setSavingKey(""); }
  };
  return <section className="workspace-panel" aria-labelledby="hot-fork-buffet-demand-title"><header><div><small>Hospitality demand · {from} to {weekEnding}</small><h3 id="hot-fork-buffet-demand-title">Hot Fork Buffet bookings</h3></div><span className="status">{active.length} active · {guestSummary} guests needing allocation</span></header>{error ? <p role="status">Buffet demand could not be loaded: {error}</p> : active.length === 0 && cancelled.length === 0 ? <p>No Hot Fork Buffet bookings for this week.</p> : <><p>Guest counts are demand signals, not dish quantities. Record portions through Portion Planner; a booking already handed to CPU must not be counted again. Confirming review stores a guest-count and saved-portion snapshot only; it never changes quantities.</p>{active.length > 0 && <div className="week-matrix-viewport"><table><caption className="sr-only">Active Hot Fork Buffet bookings and portion allocation status</caption><thead><tr><th scope="col">Service date</th><th scope="col">Site / OPLOC</th><th scope="col">Client</th><th scope="col">Service time</th><th scope="col">Guests</th><th scope="col">Booking status</th><th scope="col">Portion status</th></tr></thead><tbody>{active.map(row => { const dayRows = groups.get(`${row.serviceDate}|${row.oplocId}`) || [row]; return <tr key={row.bookingId}><td>{row.serviceDate}<small>{row.bookingReference}</small></td><td>{row.siteName}<small>{row.oplocId}</small></td><td>{row.clientName}</td><td>{row.serviceTime}</td><td>{row.guestCount}</td><td>{row.bookingStatus}</td><td>{row.alreadyHandedToCpu ? "Handed to CPU · do not add again" : confirmedFor(dayRows)}</td></tr>; })}</tbody></table></div>}{allowAllocationConfirm && [...groups.values()].map(dayRows => { const first = dayRows[0]; const key = `${first.serviceDate}|${first.oplocId}`; const hasHandedOff = dayRows.some(row => row.alreadyHandedToCpu); const hasSavedPortions = portionQuantities.some(item => item.serviceDate === first.serviceDate && item.oplocId === first.oplocId && item.quantity > 0); return <p key={key}><button className="button button-soft" type="button" disabled={Boolean(savingKey) || hasHandedOff || !hasSavedPortions || !weekId || hasUnsavedPortions} onClick={() => void confirm(dayRows)}>{savingKey === key ? "Confirming…" : `Confirm ${first.serviceDate} · ${first.siteName} demand reviewed`}</button>{hasHandedOff && <span> CPU handoff exists; review separately before changing portions.</span>}{hasUnsavedPortions && <span> Save or discard portion edits before confirming.</span>}{!hasSavedPortions && !hasHandedOff && <span> Save portions for this date and OPLOC first.</span>}</p>; })}{cancelled.length > 0 && <details><summary>Cancelled bookings excluded from active demand ({cancelled.length})</summary><ul>{cancelled.map(row => <li key={row.bookingId}>{row.serviceDate} · {row.siteName} · {row.clientName} · {row.guestCount} guests · Cancelled</li>)}</ul></details>}</>}</section>;
}
