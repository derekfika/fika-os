"use client";

import { useMemo, useState } from "react";
import type { RollingSnapshot } from "@/lib/rolling-menu-types";
import { menuExportCsv, type SelectedMenuWeek } from "@/lib/menu-export";
import PlannerModal from "./planner-modal";

type WeekOption = { id: string; weekCommencing: string; supplementaryMenu?: RollingSnapshot["week"]["supplementaryMenu"] };
type Props = {
  weeks: readonly WeekOption[];
  currentSnapshot: RollingSnapshot;
  unsavedCurrent: boolean;
  onClose: () => void;
};

function exportDates(week: WeekOption, currentSnapshot?: RollingSnapshot) {
  const days = currentSnapshot?.week.id === week.id ? currentSnapshot.days : Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${week.weekCommencing}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + index); const value = date.toISOString().slice(0, 10);
    return { date: value, weekday: new Date(`${value}T00:00:00Z`).getUTCDay() || 7 };
  });
  const menu = week.supplementaryMenu;
  if (!menu) return days.filter(day => Number(new Date(`${day.date}T00:00:00Z`).getUTCDay() || 7) <= 5).map(day => day.date);
  if (menu.serviceDate) return days.filter(day => day.date === menu.serviceDate).map(day => day.date);
  if (menu.recurrenceWeekdays?.length) return days.filter(day => menu.recurrenceWeekdays!.includes("weekday" in day ? day.weekday : new Date(`${day.date}T00:00:00Z`).getUTCDay() || 7)).map(day => day.date);
  return [];
}
function humanDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}

export default function MenuExporter({ weeks, currentSnapshot, unsavedCurrent, onClose }: Props) {
  const options = useMemo(() => {
    const byId = new Map(weeks.map(week => [week.id, week]));
    byId.set(currentSnapshot.week.id, { id: currentSnapshot.week.id, weekCommencing: currentSnapshot.week.weekCommencing, supplementaryMenu: currentSnapshot.week.supplementaryMenu });
    return [...byId.values()].sort((a, b) => a.weekCommencing.localeCompare(b.weekCommencing));
  }, [weeks, currentSnapshot.week.id, currentSnapshot.week.weekCommencing]);
  const [selected, setSelected] = useState<Record<string, string[]>>(() => ({
    [currentSnapshot.week.id]: exportDates({ id: currentSnapshot.week.id, weekCommencing: currentSnapshot.week.weekCommencing, supplementaryMenu: currentSnapshot.week.supplementaryMenu }, currentSnapshot),
  }));
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const selectedWeeks = options.filter(week => (selected[week.id]?.length || 0) > 0);
  const dayCount = selectedWeeks.reduce((total, week) => total + selected[week.id].length, 0);
  const toggleWeek = (week: WeekOption) => setSelected(previous => {
    const next = { ...previous };
    const dates = exportDates(week, currentSnapshot);
    if ((next[week.id]?.length || 0) === dates.length) delete next[week.id];
    else next[week.id] = dates;
    return next;
  });
  const toggleDay = (weekId: string, date: string) => setSelected(previous => {
    const dates = new Set(previous[weekId] || []);
    if (dates.has(date)) dates.delete(date);
    else dates.add(date);
    const next = { ...previous };
    if (dates.size) next[weekId] = [...dates].sort();
    else delete next[weekId];
    return next;
  });

  const exportSelected = async () => {
    if (busy || !selectedWeeks.length) return;
    setBusy(true);
    setError("");
    try {
      const exported: SelectedMenuWeek[] = [];
      for (let index = 0; index < selectedWeeks.length; index++) {
        const week = selectedWeeks[index];
        setProgress(`Loading week ${index + 1} of ${selectedWeeks.length}…`);
        let snapshot: RollingSnapshot;
        if (week.id === currentSnapshot.week.id) {
          snapshot = currentSnapshot;
        } else {
          // Uses exactly the existing authenticated, OPLOC-scoped Menu Planning read API.
          const response = await fetch(`/api/rolling-menu?weekId=${encodeURIComponent(week.id)}&snapshotOnly=true`, { cache: "no-store" });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(body.error?.message || `Could not load week commencing ${week.weekCommencing} (HTTP ${response.status}).`);
          snapshot = body.snapshot as RollingSnapshot;
          if (!snapshot?.week || snapshot.week.id !== week.id || snapshot.week.weekCommencing !== week.weekCommencing) {
            throw new Error(`Week commencing ${week.weekCommencing} did not match the requested saved week.`);
          }
        }
        exported.push({
          snapshot,
          dates: selected[week.id],
          unsavedBrowserDraft: week.id === currentSnapshot.week.id && unsavedCurrent,
        });
      }
      const csv = menuExportCsv(exported);
      const dates = exported.flatMap(week => week.dates).sort();
      const filename = `FIKA-Menu-Planner-${dates[0]}-to-${dates[dates.length - 1]}.csv`;
      const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Menu export failed. Nothing was downloaded.");
      setProgress("");
    } finally {
      setBusy(false);
    }
  };

  return <PlannerModal title="Export Menu Planner" onClose={onClose} busy={busy} dismissible={!busy} className="item-detail planner-input-dialog">
    <header><div><small>Week Planner · Read-only download</small><h3>Export menu</h3></div><button type="button" className="modal-close" disabled={busy} onClick={onClose} aria-label="Close export">Close</button></header>
    <p>Choose any saved weeks and individual weekdays. Published and unpublished menus can all be exported to Excel-compatible CSV.</p>
    {unsavedCurrent && <p className="form-help">The currently open week has unsaved browser edits. Its exported rows will be labelled "Unsaved browser draft". Other weeks are loaded from saved records.</p>}
    <div className="form-actions">
      <button type="button" className="button button-soft" disabled={busy} onClick={() => setSelected(Object.fromEntries(options.map(week => [week.id, exportDates(week, currentSnapshot)])))}>Select all weeks</button>
      <button type="button" className="button button-soft" disabled={busy} onClick={() => setSelected({})}>Clear selection</button>
    </div>
    <div style={{ maxHeight: 340, overflowY: "auto", padding: "4px 0" }} aria-label="Available menu weeks">
      {options.map(week => {
        const days = exportDates(week, currentSnapshot);
        const chosen = selected[week.id] || [];
        return <fieldset key={week.id} disabled={busy} style={{ border: "1px solid var(--line, #ddd)", borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
          <legend><label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={days.length > 0 && days.every(date => chosen.includes(date))} ref={element => { if (element) element.indeterminate = chosen.length > 0 && chosen.length < days.length; }} onChange={() => toggleWeek(week)} />WC {humanDate(week.weekCommencing)}{week.supplementaryMenu ? ` · ${week.supplementaryMenu.name} · ${week.supplementaryMenu.serviceType}` : " · Main menu"}{week.id === currentSnapshot.week.id ? " · Current" : ""}</label></legend>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {days.map(date => <label key={date} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><input type="checkbox" checked={chosen.includes(date)} onChange={() => toggleDay(week.id, date)} />{new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", timeZone: "UTC" })}</label>)}
          </div>
        </fieldset>;
      })}
    </div>
    <p role="status">{progress || `${dayCount} day${dayCount === 1 ? "" : "s"} selected across ${selectedWeeks.length} week${selectedWeeks.length === 1 ? "" : "s"}.`}</p>
    {error && <p className="menu-error" role="alert">{error}</p>}
    <footer className="form-actions">
      <button type="button" className="button button-soft" disabled={busy} onClick={onClose}>Cancel</button>
      <button type="button" className="button button-purple" disabled={busy || !dayCount} onClick={() => void exportSelected()}>{busy ? "Preparing CSV…" : "Download CSV"}</button>
    </footer>
  </PlannerModal>;
}
