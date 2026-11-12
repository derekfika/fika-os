"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { europeLondonDate } from "../../lib/operational-date";
import { isOperationalDate } from "../../lib/production-totals-range";
import type { ProductionOrder } from "../../lib/production-types";
import { aggregateProductionTotals } from "../../lib/production-day";
import {
  loadRunSheetPrintDays,
  runSheetDestinationKey,
  runSheetPrintDates,
  runSheetServiceKey,
  runSheetPrintServiceOptions,
  type RunSheetPrintMode,
  runSheetPrintSiteOptions,
  selectedRunSheetPrintOrders,
  selectedRunSheetPrintManifestKey,
  type RunSheetServiceKey,
  type RunSheetServiceOverrides,
} from "./run-sheet-printing";
import { runSheetProductionPrintHtml, paginateDayProduction, paginateProductionTotals, type RunSheetLayout } from "./day-production-print";
import { printKitchenDocument, totalsPrintHtml } from "./kitchen-print";
import styles from "./RunSheetPrintDialog.module.css";

type PrintOrders = Map<string, ProductionOrder[]>;
type ServiceOption = ReturnType<typeof runSheetPrintServiceOptions>[number];

export function RunSheetPrintDialog({
  productionDate,
  selectedSiteIds,
  printType = "run-sheet",
}: {
  productionDate: string;
  selectedSiteIds: readonly string[];
  printType?: "run-sheet" | "totals";
}) {
  const isTotals = printType === "totals";
  const today = europeLondonDate();
  const initialDate = isOperationalDate(productionDate) ? productionDate : today;
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<RunSheetLayout>("compact");
  const [mode, setMode] = useState<RunSheetPrintMode>(initialDate === today ? "today" : "custom");
  const [customFrom, setCustomFrom] = useState(initialDate);
  const [customTo, setCustomTo] = useState(initialDate);
  const [ordersByDay, setOrdersByDay] = useState<PrintOrders>(new Map());
  const [sites, setSites] = useState<ReturnType<typeof runSheetPrintSiteOptions>>([]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [selectedServices, setSelectedServices] = useState<RunSheetServiceKey[]>([]);
  const [siteServiceOverrides, setSiteServiceOverrides] = useState<Record<string, Partial<Record<RunSheetServiceKey, boolean>>>>({});
  const [search, setSearch] = useState("");
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
  const serviceOptions = useMemo(() => runSheetPrintServiceOptions(ordersByDay, days), [ordersByDay, days]);
  const selectedOrdersByDay = useMemo(
    () => selectedRunSheetPrintOrders(ordersByDay, days, selectedKeys, selectedServices, siteServiceOverrides),
    [ordersByDay, days, selectedKeys, selectedServices, siteServiceOverrides],
  );
  const selectedOrders = useMemo(() => [...selectedOrdersByDay.values()].flat(), [selectedOrdersByDay]);
  const selectedManifestKey = useMemo(
    () => selectedRunSheetPrintManifestKey(ordersByDay, days, selectedKeys, selectedServices, siteServiceOverrides),
    [ordersByDay, days, selectedKeys, selectedServices, siteServiceOverrides],
  );
  const selectedOrderCount = selectedOrders.length;
  const selectedDestinationKeys = useMemo(() => new Set(selectedOrders.map(runSheetDestinationKey)), [selectedOrders]);
  const selectedServiceSet = useMemo(() => new Set(selectedOrders.map((order) => {
    const option = serviceOptions.find((item) => item.key === runSheetServiceKey(order));
    return option?.label || "Other CPU production";
  })), [selectedOrders, serviceOptions]);
  const selectedServiceLabels = [...selectedServiceSet];
  const expectedMinimumSheets = [...selectedOrdersByDay.values()].reduce((total, orders) => total + new Set(orders.map(runSheetDestinationKey)).size, 0);
  const visibleSites = sites.filter((site) => site.displayLabel.toLowerCase().includes(search.trim().toLowerCase()) || site.key.toLowerCase().includes(search.trim().toLowerCase()));
  const selectedSiteCount = selectedDestinationKeys.size;
  const overrideCount = Object.values(siteServiceOverrides).reduce((total, values) => total + Object.keys(values).length, 0);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setOrdersByDay(new Map());
    setSites([]);
    setSelectedKeys([]);
    setSelectedServices([]);
    setSiteServiceOverrides({});
    setSearch("");
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
    }).then((loadedOrders) => {
      if (controller.signal.aborted) return;
      const options = runSheetPrintSiteOptions(loadedOrders, days);
      const services = runSheetPrintServiceOptions(loadedOrders, days);
      setOrdersByDay(loadedOrders);
      setSites(options);
      setSelectedServices(services.map((service) => service.key));
      const wanted = screenSiteIds.size
        ? options.filter((site) => site.key.startsWith("oploc:") && screenSiteIds.has(site.key.replace(/^oploc:/, ""))).map((site) => site.key)
        : options.map((site) => site.key);
      setSelectedKeys(wanted);
      setAnnouncement(options.length ? `${options.length} eligible destinations and ${services.length} services loaded.` : "No eligible destinations have work in this date range.");
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
  const selectAllSites = () => setSelectedKeys(sites.map((site) => site.key));
  const clearSites = () => setSelectedKeys([]);
  const clearOverridesForService = (serviceKey: RunSheetServiceKey) => setSiteServiceOverrides((current) => {
    const next = Object.fromEntries(Object.entries(current).flatMap(([siteKey, overrides]) => {
      const { [serviceKey]: _removed, ...remaining } = overrides;
      return Object.keys(remaining).length ? [[siteKey, remaining]] : [];
    }));
    return next;
  });
  const toggleService = (serviceKey: RunSheetServiceKey) => {
    setSelectedServices((current) => current.includes(serviceKey) ? current.filter((key) => key !== serviceKey) : [...current, serviceKey]);
    clearOverridesForService(serviceKey);
  };
  const selectAllServices = () => {
    setSelectedServices(serviceOptions.map((service) => service.key));
    setSiteServiceOverrides({});
  };
  const clearServices = () => {
    setSelectedServices([]);
    setSiteServiceOverrides({});
  };
  const toggleSiteService = (siteKey: string, serviceKey: RunSheetServiceKey) => {
    const currentEffective = siteServiceOverrides[siteKey]?.[serviceKey] ?? selectedServices.includes(serviceKey);
    setSiteServiceOverrides((current) => ({
      ...current,
      [siteKey]: { ...current[siteKey], [serviceKey]: !currentEffective },
    }));
  };
  const openDialog = () => {
    const current = isOperationalDate(productionDate) ? productionDate : europeLondonDate();
    setCustomFrom(current);
    setCustomTo(current);
    setMode(current === europeLondonDate() ? "today" : "custom");
    setOpen(true);
  };

  const print = async () => {
    if (printing || loading || !days.length || !selectedKeys.length || !selectedOrderCount) return;
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
        setOrdersByDay(freshOrders);
        setSites(freshSites);
        setSelectedKeys((current) => current.filter((key) => freshKeys.has(key)));
        setError("Production changed while this preview was open. Review the refreshed destinations and selection, then print again.");
        return;
      }
      const freshSelectedByDay = selectedRunSheetPrintOrders(freshOrders, days, selectedKeys, selectedServices, siteServiceOverrides);
      const freshSelected = [...freshSelectedByDay.values()].flat();
      const freshManifestKey = selectedRunSheetPrintManifestKey(freshOrders, days, selectedKeys, selectedServices, siteServiceOverrides);
      if (freshManifestKey !== selectedManifestKey) {
        setOrdersByDay(freshOrders);
        setSites(freshSites);
        setError("Production changed while this preview was open. Review the refreshed dates, services and destinations before printing again.");
        return;
      }
      if (!freshSelected.length) {
        setOrdersByDay(freshOrders);
        setSites(freshSites);
        setError("No orders match this service and destination selection in the refreshed production data. Review the selection before printing.");
        return;
      }
      setOrdersByDay(freshOrders);
      setSites(freshSites);
      const freshServices = runSheetPrintServiceOptions(freshOrders, days);
      const serviceLabel = freshServices.filter((service) => selectedServices.includes(service.key)).map((service) => service.label).join(", ");
      const label = `${freshSelected.length} selected orders${serviceLabel ? ` · ${serviceLabel}` : ""}`;
      const freshDestinationCount = new Set(freshSelected.map(runSheetDestinationKey)).size;
      if (isTotals) {
        const totals = aggregateProductionTotals(freshSelected);
        const filterSummary = `${freshDestinationCount} destination${freshDestinationCount === 1 ? "" : "s"} · ${serviceLabel || "all eligible services"}`;
        await printKitchenDocument(
          totalsPrintHtml(totals, dateSummary, filterSummary, layout, freshSelected),
          paginateProductionTotals,
          layout === "full" ? "landscape" : "portrait",
        );
      } else {
        await printKitchenDocument(
          runSheetProductionPrintHtml(freshOrders, days, selectedKeys, new Date(), label, layout, selectedServices, siteServiceOverrides),
          paginateDayProduction,
        );
      }
      setAnnouncement(`Print dialog opened for ${freshDestinationCount} destination${freshDestinationCount === 1 ? "" : "s"} across ${days.length} date${days.length === 1 ? "" : "s"}.`);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The selected production dates could not be verified. Nothing was printed.");
    } finally {
      if (!controller.signal.aborted) setPrinting(false);
    }
  };

  const dateSummary = days.length
    ? days.length === 1 ? productionDateLabel(days[0]) : `${productionDateLabel(days[0])} to ${productionDateLabel(days[days.length - 1])} (${days.length} days)`
    : "No valid dates selected";

  return (
    <>
      <button ref={triggerRef} type="button" className={`kitchen-button kitchen-print-primary${isTotals ? " kitchen-totals-print" : ""}`} aria-haspopup="dialog" onClick={openDialog}>
        {isTotals ? "Print totals" : "Print run sheets"}
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
            <p className={styles.eyebrow}>CPU Production · {isTotals ? "Aggregated totals" : "Paper handover"}</p>
            <h2 id="run-sheet-print-title">{isTotals ? "Build production totals" : "Build your run sheets"}</h2>
            <p>{isTotals ? "Choose dates, services and destinations. Quantities aggregate across the selected work." : "Choose dates, services and destinations. Only checked work will print."}</p>
          </div>
          <button type="button" className={styles.closeButton} onClick={close} aria-label="Close print run sheets">×</button>
        </header>

        <div className={styles.body}>
          <div className={styles.selectionColumn}>
            <section className={styles.section} aria-labelledby="run-sheet-dates-title">
              <div className={styles.sectionHead}>
                <span className={styles.sectionNumber}>01</span>
                <div><h3 id="run-sheet-dates-title">Production dates</h3><p>Pick the production days to include.</p></div>
                <button type="button" className={styles.textButton} onClick={() => { setMode("custom"); setCustomFrom(""); setCustomTo(""); }} disabled={loading || printing}>Clear</button>
              </div>
              <fieldset className={styles.dateChoices} disabled={loading || printing}>
                <legend className={styles.visuallyHidden}>Production date preset</legend>
                <label><input ref={firstDateRef} type="radio" name="run-sheet-print-mode" checked={mode === "today"} onChange={() => setMode("today")} /><span>Today · {europeLondonDate()}</span></label>
                <label><input type="radio" name="run-sheet-print-mode" checked={mode === "tomorrow"} onChange={() => setMode("tomorrow")} /><span>Tomorrow</span></label>
                <label><input type="radio" name="run-sheet-print-mode" checked={mode === "custom"} onChange={() => setMode("custom")} /><span>Custom range</span></label>
              </fieldset>
              <p className={styles.range}>{days.length ? <><strong>{days.length} day{days.length === 1 ? "" : "s"} selected</strong> · {dateSummary}</> : "Choose a valid inclusive date range of 1–31 days."}</p>
              {mode === "custom" && <div className={styles.customDates}>
                <label>From<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} disabled={loading || printing} /></label>
                <label>To · inclusive<input type="date" value={customTo} min={customFrom || undefined} onChange={(event) => setCustomTo(event.target.value)} disabled={loading || printing} /></label>
              </div>}
              <fieldset className={styles.paperChoices} disabled={printing}>
                <legend>A4 layout</legend>
                <label className={layout === "compact" ? styles.choiceSelected : ""}><input type="radio" name="run-sheet-layout" checked={layout === "compact"} onChange={() => setLayout("compact")} /><span><strong>Compact A4</strong><small>Two dish cards per row where readable</small></span></label>
                <label className={layout === "full" ? styles.choiceSelected : ""}><input type="radio" name="run-sheet-layout" checked={layout === "full"} onChange={() => setLayout("full")} /><span><strong>Full-width A4</strong><small>One card per row</small></span></label>
              </fieldset>
            </section>

            <section className={styles.section} aria-labelledby="run-sheet-services-title">
              <div className={styles.sectionHead}>
                <span className={styles.sectionNumber}>02</span>
                <div><h3 id="run-sheet-services-title">Services</h3><p>Counts use canonical categories and source routing.</p></div>
                <div className={styles.sectionTools}>
                  <button type="button" className={styles.textButton} onClick={selectAllServices} disabled={loading || printing || !serviceOptions.length}>Select all</button>
                  <button type="button" className={styles.textButton} onClick={clearServices} disabled={loading || printing || (!selectedServices.length && !overrideCount)}>Clear</button>
                </div>
              </div>
              {serviceOptions.length ? <div className={styles.serviceGrid}>
                {serviceOptions.map((service: ServiceOption) => (
                  <label key={service.key} className={`${styles.serviceCard} ${selectedServices.includes(service.key) ? styles.choiceSelected : ""}`}>
                    <input type="checkbox" checked={selectedServices.includes(service.key)} onChange={() => toggleService(service.key)} disabled={loading || printing} />
                    <span className={styles.serviceCopy}><strong>{service.label}</strong><small>{service.detail}</small></span>
                    <span className={styles.count}>{service.orderCount} orders</span>
                  </label>
                ))}
              </div> : <p className={styles.empty}>{loading ? "Loading service categories…" : "No eligible services in these dates."}</p>}
            </section>

            <section className={styles.section} aria-labelledby="run-sheet-sites-title">
              <div className={styles.sectionHead}>
                <span className={styles.sectionNumber}>03</span>
                <div><h3 id="run-sheet-sites-title">OPLOCs</h3><p>Choose destinations and adjust services at each one.</p></div>
                <div className={styles.sectionTools}>
                  <button type="button" className={styles.textButton} onClick={selectAllSites} disabled={loading || printing || !sites.length}>Select all</button>
                  <button type="button" className={styles.textButton} onClick={clearSites} disabled={loading || printing || !selectedKeys.length}>Clear</button>
                </div>
              </div>
              <label className={styles.search}><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search destination or OPLOC" aria-label="Search OPLOCs and destinations" disabled={loading || printing} /></label>
              {sites.length ? <div className={styles.siteList}>
                {visibleSites.map((site) => {
                  const siteSelected = selectedKeys.includes(site.key);
                  return <article className={styles.siteCard} key={site.key}>
                    <div className={styles.siteTop}>
                      <input type="checkbox" checked={siteSelected} onChange={() => toggleSite(site.key)} aria-label={`Include ${site.displayLabel}`} disabled={loading || printing} />
                      <span className={styles.siteName}><strong>{site.displayLabel}</strong><small>{site.key.startsWith("oploc:") ? `Canonical OPLOC · ${site.key}` : site.key.startsWith("snapshot:") ? "Order-scoped address · not a permanent OPLOC" : "Order-scoped destination"}</small></span>
                      <span className={styles.count}>{site.orderCount} orders</span>
                    </div>
                    <div className={styles.serviceMix} aria-label={`Services included for ${site.displayLabel}`}>
                      {serviceOptions.filter((service) => (site.serviceCounts[service.key] || 0) > 0).map((service) => {
                        const checked = siteServiceOverrides[site.key]?.[service.key] ?? selectedServices.includes(service.key);
                        return <label key={service.key} className={`${styles.serviceToggle} ${checked ? styles.choiceSelected : ""}`}>
                          <input type="checkbox" checked={checked} onChange={() => toggleSiteService(site.key, service.key)} disabled={loading || printing || !siteSelected} />
                          <span>{service.label}</span><small>{site.serviceCounts[service.key]}</small>
                        </label>;
                      })}
                    </div>
                  </article>;
                })}
                {!visibleSites.length && <p className={styles.empty}>No destinations match “{search}”.</p>}
              </div> : <p className={styles.empty}>{loading ? "Loading eligible destinations…" : "No eligible destinations have work in these dates."}</p>}
            </section>
            {loading || printing ? <p className={styles.progress} role="status" aria-live="polite">{printing ? "Refreshing production days" : "Loading eligible production"}: {progress.completed} of {progress.total}{progress.day ? ` · ${progress.day}` : ""}</p> : null}
            {announcement && <p className={styles.announcement} role="status" aria-live="polite">{announcement}</p>}
            {error && <p className={styles.error} role="alert">{error}</p>}
          </div>

          <aside className={styles.summary} aria-labelledby="run-sheet-summary-title">
            <div className={styles.summaryCard}>
              <div className={styles.summaryHeading}><h3 id="run-sheet-summary-title">04 · Print summary</h3><span className={selectedOrderCount ? styles.ready : styles.notReady}>{selectedOrderCount ? "Ready" : "Review"}</span></div>
              <dl className={styles.summaryList}>
                <div><dt>Production dates</dt><dd>{dateSummary}</dd></div>
                <div><dt>Services</dt><dd>{selectedServiceLabels.length ? selectedServiceLabels.join(", ") : "No services selected"}{overrideCount ? <small>{` · ${overrideCount} local service choice${overrideCount === 1 ? "" : "s"}`}</small> : null}</dd></div>
                <div><dt>Destinations</dt><dd>{selectedSiteCount} selected{selectedDestinationKeys.size ? ` · ${sites.filter((site) => selectedDestinationKeys.has(site.key)).map((site) => site.displayLabel).join(", ")}` : ""}</dd></div>
              </dl>
              <div className={styles.metrics}>
                <div><strong>{selectedOrderCount}</strong><span>{isTotals ? "orders included" : "eligible orders"}</span></div>
                <div><strong>{isTotals ? selectedOrders.reduce((count, order) => count + order.lines.length, 0) : expectedMinimumSheets}{!isTotals && expectedMinimumSheets ? "+" : ""}</strong><span>{isTotals ? "source lines aggregated" : expectedMinimumSheets ? "minimum A4 sheets · final pages measured from content" : "A4 sheets"}</span></div>
              </div>
              <p className={styles.summaryNote}><strong>Selection is exact.</strong> {isTotals ? "Selected customer-ordered quantities are aggregated; unlike units and canonical menu slots remain separate." : "Only checked work prints. Each sheet starts with one OPLOC and date; larger selections continue on same-site pages."}</p>
              <div className={styles.summaryActions}>
                <button type="button" className="kitchen-button kitchen-print-primary" disabled={loading || printing || !selectedOrderCount || !days.length} onClick={() => void print()}>{printing ? "Verifying and preparing…" : `Print ${isTotals ? "totals for " : ""}${selectedOrderCount} selected order${selectedOrderCount === 1 ? "" : "s"}`}</button>
                <button type="button" className={styles.cancelButton} onClick={close}>Cancel</button>
                <p>Selected dates are refreshed before printing. Paper marks never update order, allergen, packing or delivery status.</p>
              </div>
            </div>
          </aside>
        </div>
        <footer className={styles.mobileFooter}>
          <button type="button" className={styles.cancelButton} onClick={close}>Cancel</button>
          <button type="button" className="kitchen-button kitchen-print-primary" disabled={loading || printing || !selectedOrderCount || !days.length} onClick={() => void print()}>{printing ? "Verifying…" : `Print ${isTotals ? "totals · " : "· "}${selectedOrderCount} orders`}</button>
        </footer>
      </dialog>
    </>
  );
}

function productionDateLabel(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}
