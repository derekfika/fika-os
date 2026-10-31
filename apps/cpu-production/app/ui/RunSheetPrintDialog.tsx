"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { europeLondonDate } from "../../lib/operational-date";
import { isOperationalDate } from "../../lib/production-totals-range";
import {
  loadRunSheetPrintDays,
  runSheetPrintDates,
  type RunSheetPrintMode,
  runSheetPrintSiteOptions,
} from "./run-sheet-printing";
import { runSheetProductionPrintHtml, paginateDayProduction } from "./day-production-print";
import { printKitchenDocument } from "./kitchen-print";
import styles from "./RunSheetPrintDialog.module.css";

export function RunSheetPrintDialog({
  productionDate,
  selectedSiteIds,
}: {
  productionDate: string;
  selectedSiteIds: readonly string[];
}) {
  const today = europeLondonDate();
  const initialDate = isOperationalDate(productionDate) ? productionDate : today;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<RunSheetPrintMode>(initialDate === today ? "today" : "custom");
  const [customFrom, setCustomFrom] = useState(initialDate);
  const [customTo, setCustomTo] = useState(initialDate);
  const [sites, setSites] = useState<ReturnType<typeof runSheetPrintSiteOptions>>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0, day: "" });
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstDateRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const siteIdsKey = [...selectedSiteIds].sort().join("\u0000");
  const screenSiteIds = useMemo(() => new Set(siteIdsKey ? siteIdsKey.split("\u0000") : []), [siteIdsKey]);
  const days = useMemo(
    () => runSheetPrintDates(mode, new Date(), customFrom, customTo),
    [mode, customFrom, customTo],
  );
  const selectedSites = sites.filter((site) => selectedKeys.includes(site.key));
  const selectedOrderCount = selectedSites.reduce((total, site) => total + site.orderCount, 0);
  const selectionLabel = selectedSites.map((site) => site.displayLabel).join(", ") || "No sites selected";

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setSites([]);
    setSelectedKeys([]);
    setError("");
    setAnnouncement("");
    setProgress({ completed: 0, total: days.length, day: "" });
    if (!days.length) {
      setLoading(false);
      setError("Choose a valid inclusive date range of 1–31 days.");
      return () => controller.abort();
    }
    setLoading(true);
    const fetcher: typeof fetch = (input, init) => fetch(input, { ...init, signal: controller.signal });
    void loadRunSheetPrintDays(days, fetcher, (completed, total, day) => {
      if (!controller.signal.aborted) setProgress({ completed, total, day });
    }).then((ordersByDay) => {
      if (controller.signal.aborted) return;
      const options = runSheetPrintSiteOptions(ordersByDay, days);
      setSites(options);
      const wanted = screenSiteIds.size
        ? options.filter((site) => screenSiteIds.has(site.key.replace(/^oploc:/, "")) && site.key.startsWith("oploc:")).map((site) => site.key)
        : options.map((site) => site.key);
      setSelectedKeys(wanted);
      setAnnouncement(options.length ? options.length + " eligible destinations loaded." : "No eligible destinations have work in this date range.");
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Production dates could not be verified. Nothing will be printed.");
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [open, days, siteIdsKey, screenSiteIds]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) {
      dialog.showModal();
      firstDateRef.current?.focus();
    } else if (!open && dialog?.open) {
      dialog.close();
    }
  }, [open]);

  const close = () => {
    abortRef.current?.abort();
    setLoading(false);
    setPrinting(false);
    setOpen(false);
  };
  const toggleSite = (key: string) => setSelectedKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  const selectAll = () => setSelectedKeys(sites.map((site) => site.key));
  const clearAll = () => setSelectedKeys([]);
  const openDialog = () => {
    const current = isOperationalDate(productionDate) ? productionDate : europeLondonDate();
    setCustomFrom(current);
    setCustomTo(current);
    setMode(current === europeLondonDate() ? "today" : "custom");
    setOpen(true);
  };

  const print = async () => {
    if (printing || loading || !days.length || !selectedKeys.length) return;
    setPrinting(true);
    setError("");
    setAnnouncement("Refreshing every selected production date before printing.");
    setProgress({ completed: 0, total: days.length, day: "" });
    const controller = new AbortController();
    abortRef.current = controller;
    const fetcher: typeof fetch = (input, init) => fetch(input, { ...init, signal: controller.signal });
    try {
      const freshOrders = await loadRunSheetPrintDays(days, fetcher, (completed, total, day) => {
        if (!controller.signal.aborted) setProgress({ completed, total, day });
      });
      if (controller.signal.aborted) return;
      const freshSites = runSheetPrintSiteOptions(freshOrders, days);
      const freshKeys = new Set(freshSites.map((site) => site.key));
      if (selectedKeys.some((key) => !freshKeys.has(key))) {
        setSites(freshSites);
        setSelectedKeys((current) => current.filter((key) => freshKeys.has(key)));
        setError("Production changed while this preview was open. Review the refreshed sites and selection, then print again.");
        return;
      }
      const freshSelected = freshSites.filter((site) => selectedKeys.includes(site.key));
      if (!freshSelected.length) {
        setError("Select at least one destination with eligible work before printing.");
        return;
      }
      setSites(freshSites);
      const label = freshSelected.map((site) => site.displayLabel).join(", ");
      await printKitchenDocument(
        runSheetProductionPrintHtml(freshOrders, days, selectedKeys, new Date(), label),
        paginateDayProduction,
      );
      setAnnouncement("Print dialog opened for " + freshSelected.length + " destination" + (freshSelected.length === 1 ? "" : "s") + " across " + days.length + " date" + (days.length === 1 ? "" : "s") + ".");
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The selected production dates could not be verified. Nothing was printed.");
    } finally {
      if (!controller.signal.aborted) setPrinting(false);
    }
  };

  return (
    <>
      <button ref={triggerRef} type="button" className="kitchen-button kitchen-print-primary" aria-haspopup="dialog" onClick={openDialog}>
        Print run sheets
      </button>
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby="run-sheet-print-title"
        onClose={() => {
          abortRef.current?.abort();
          setLoading(false);
          setPrinting(false);
          setOpen(false);
          triggerRef.current?.focus();
        }}
      >
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>CPU Production · Paper handover</p>
            <h2 id="run-sheet-print-title">Print run sheets</h2>
            <p>Choose the production dates and destinations for these read-only paper sheets.</p>
          </div>
          <button type="button" className="kitchen-button" onClick={close} aria-label="Close print run sheets">Close</button>
        </header>
        <div className={styles.body}>
          <fieldset className={styles.dateModes} disabled={loading || printing}>
            <legend>Production dates</legend>
            <label><input type="radio" name="run-sheet-print-mode" checked={mode === "today"} onChange={() => setMode("today")} />Today ({europeLondonDate()})</label>
            <label><input type="radio" name="run-sheet-print-mode" checked={mode === "tomorrow"} onChange={() => setMode("tomorrow")} />Tomorrow</label>
            <label><input ref={firstDateRef} type="radio" name="run-sheet-print-mode" checked={mode === "custom"} onChange={() => setMode("custom")} />Custom date range</label>
          </fieldset>
          {mode === "custom" && (
            <div className={styles.customDates}>
              <label>From<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} disabled={loading || printing} /></label>
              <label>To (inclusive)<input type="date" value={customTo} min={customFrom || undefined} onChange={(event) => setCustomTo(event.target.value)} disabled={loading || printing} /></label>
            </div>
          )}
          <p className={styles.range}>
            {days.length ? (days.length === 1 ? "Selected date: " + days[0] : "Selected dates: " + days[0] + " to " + days[days.length - 1] + " (" + days.length + " days)") : "Date range must be valid, inclusive, and no longer than 31 days."}
          </p>
          {loading || printing ? (
            <p className={styles.progress} role="status" aria-live="polite">
              {printing ? "Refreshing production days" : "Loading eligible destinations"}: {progress.completed} of {progress.total}{progress.day ? " · " + progress.day : ""}
            </p>
          ) : null}
          <fieldset className={styles.sites} disabled={loading || printing || !sites.length}>
            <legend>Destinations</legend>
            <div className={styles.siteActions}>
              <button type="button" className="kitchen-button" onClick={selectAll} disabled={!sites.length || selectedKeys.length === sites.length}>Select all</button>
              <button type="button" className="kitchen-button" onClick={clearAll} disabled={!selectedKeys.length}>Clear</button>
              <span role="status">{selectedKeys.length} of {sites.length} selected</span>
            </div>
            {sites.length ? (
              <ul className={styles.siteList}>
                {sites.map((site) => (
                  <li key={site.key}>
                    <label>
                      <input type="checkbox" checked={selectedKeys.includes(site.key)} onChange={() => toggleSite(site.key)} />
                      <span>{site.displayLabel}</span>
                      <small>{site.orderCount} order{site.orderCount === 1 ? "" : "s"}</small>
                    </label>
                  </li>
                ))}
              </ul>
            ) : !loading && !error ? <p className={styles.empty}>No eligible destinations have work in these dates.</p> : null}
          </fieldset>
          {sites.length > 0 && (
            <section className={styles.preview} aria-label="Print preview summary">
              <h3>Print preview</h3>
              <p>{selectedKeys.length} destination{selectedKeys.length === 1 ? "" : "s"} · {days.length} production date{days.length === 1 ? "" : "s"} · {selectedOrderCount} eligible orders</p>
              <p>Each A4 page contains one destination and one production date. Large sheets continue for that same destination only.</p>
              <p className={styles.paperNote}>Printed checkboxes are paper-only. Reprint after an amendment or cancellation; paper marks do not confirm electronic delivery or allergen approval.</p>
            </section>
          )}
          {announcement && <p className={styles.announcement} role="status" aria-live="polite">{announcement}</p>}
          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>
        <footer className={styles.footer}>
          <button type="button" className="kitchen-button" onClick={close}>Cancel</button>
          <button type="button" className="kitchen-button kitchen-print-primary" disabled={loading || printing || !selectedKeys.length || !sites.length || !days.length} onClick={() => void print()}>
            {printing ? "Verifying and preparing…" : "Print selected run sheets"}
          </button>
        </footer>
      </dialog>
    </>
  );
}
