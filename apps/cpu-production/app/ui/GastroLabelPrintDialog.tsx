"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ProductionOrder } from "../../lib/production-types";
import { loadWholeDay } from "./whole-day-production";
import {
  gastroLabelCells,
  gastroLabelDateLabel,
  gastroLabelDishes,
  gastroLabelRowsWithQuantity,
  gastroLabelsPrintHtml,
  fitGastroLabelName,
  GASTRO_LABEL_FONT,
  validGastroLabelCount,
  type GastroLabelFit,
  type GastroLabelFontSize,
} from "./gastro-label-print";
import styles from "./GastroLabelPrintDialog.module.css";

type Props = {
  productionDate: string;
  selectedSiteIds: readonly string[];
};

const dishManifest = (orders: readonly ProductionOrder[], date: string, sites: readonly string[]) =>
  JSON.stringify(gastroLabelDishes(orders, date, sites).map(({ id, name, sortOrder }) => ({ id, name, sortOrder })));

export function GastroLabelPrintDialog({ productionDate, selectedSiteIds }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const loadVersion = useRef(0);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [dishes, setDishes] = useState<ReturnType<typeof gastroLabelDishes>>([]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [fontOverrides, setFontOverrides] = useState<Record<string, GastroLabelFontSize>>({});
  const [fittedNames, setFittedNames] = useState<Record<string, GastroLabelFit>>({});
  const [startPosition, setStartPosition] = useState(1);
  const [previewScale, setPreviewScale] = useState(0.55);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) {
      dialog.showModal();
      void refreshDishes();
    } else if (!open && dialog?.open) {
      dialog.close();
    }
    // The dialog opens against the current date and site selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const refreshDishes = async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setError("");
    setAnnouncement("Reading the latest Delivered-In production for this date.");
    try {
      const orders = await loadWholeDay(productionDate);
      if (version !== loadVersion.current) return;
      const next = gastroLabelDishes(orders, productionDate, selectedSiteIds);
      setDishes(next);
      setQuantities(Object.fromEntries(next.map((dish) => [dish.id, 0])));
      setFontOverrides({});
      setAnnouncement(next.length ? `${next.length} eligible dishes loaded. Label counts start at zero.` : "No current published Delivered-In dishes match this date and site selection.");
    } catch (cause) {
      if (version !== loadVersion.current) return;
      setDishes([]);
      setQuantities({});
      setError(cause instanceof Error ? cause.message : "Production could not be verified. Nothing will be printed.");
      setAnnouncement("");
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  };

  const rows = useMemo(() => gastroLabelRowsWithQuantity(dishes, quantities, productionDate), [dishes, quantities, productionDate]);
  useEffect(() => {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) {
      setFittedNames(Object.fromEntries(dishes.map((dish) => [dish.id, { fontSizePt: GASTRO_LABEL_FONT.minimumPt, lineCount: 0, fits: false }])));
      return;
    }
    setFittedNames(Object.fromEntries(dishes.map((dish) => [
      dish.id,
      fitGastroLabelName(dish.name, fontOverrides[dish.id] ?? "auto", context),
    ])));
  }, [dishes, fontOverrides]);
  const totalLabels = rows.reduce((total, row) => total + row.quantity, 0);
  const pages = useMemo(() => {
    try { return gastroLabelCells(rows, startPosition); } catch { return []; }
  }, [rows, startPosition]);
  useEffect(() => {
    if (!pages.length || !previewRef.current) return;
    const updateScale = () => {
      const label = previewRef.current?.querySelector<HTMLElement>("[data-preview-label]");
      if (label) setPreviewScale(Math.min(1, label.getBoundingClientRect().width / (95 * 96 / 25.4)));
    };
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(previewRef.current);
    return () => observer.disconnect();
  }, [pages.length]);
  const skippedCells = totalLabels ? startPosition - 1 : 0;
  const blankCells = Math.max(0, pages.length * 8 - totalLabels - skippedCells);
  const countError = rows.some((row) => !validGastroLabelCount(row.quantity));
  const fontError = rows.some((row) => row.quantity > 0 && !fittedNames[row.id]?.fits);

  const close = () => {
    loadVersion.current += 1;
    setLoading(false);
    setPrinting(false);
    setOpen(false);
  };

  const setQuantity = (id: string, value: string) => {
    const parsed = value === "" ? 0 : Number(value);
    setQuantities((current) => ({ ...current, [id]: parsed }));
  };

  const print = async () => {
    if (printing || loading || !totalLabels || countError || fontError || !dishes.length) return;
    // Open synchronously from the user's click so browser popup rules do not
    // discard the requested preview while the authoritative freshness read runs.
    const target = window.open("about:blank", "_blank");
    if (!target) {
      setError("The PDF preview was blocked by the browser. Allow pop-ups for this CPU site, then try again.");
      return;
    }
    target.document.title = "Preparing Gastro Labels";
    target.document.body.textContent = "Checking the latest production before creating the label PDF…";
    setPrinting(true);
    setError("");
    setAnnouncement("Refreshing the selected service date before opening the PDF.");
    try {
      const freshOrders = await loadWholeDay(productionDate);
      const freshManifest = dishManifest(freshOrders, productionDate, selectedSiteIds);
      const currentManifest = JSON.stringify(dishes.map(({ id, name, sortOrder }) => ({ id, name, sortOrder })));
      if (freshManifest !== currentManifest) {
        const freshDishes = gastroLabelDishes(freshOrders, productionDate, selectedSiteIds);
        setDishes(freshDishes);
        setQuantities((current) => Object.fromEntries(freshDishes.map((dish) => [dish.id, current[dish.id] ?? 0])));
        throw new Error("Published Delivered-In dishes changed while this preview was open. Review the refreshed list and label counts, then print again.");
      }
      const freshRows = gastroLabelRowsWithQuantity(dishes, quantities, productionDate);
      if (freshRows.reduce((sum, row) => sum + row.quantity, 0) < 1) {
        throw new Error("Enter at least one label before opening the print dialog.");
      }
      const html = gastroLabelsPrintHtml(freshRows, startPosition, fittedNames);
      target.document.open();
      target.document.write(html);
      target.document.close();
      target.focus();
      target.print();
      setAnnouncement(`PDF print preview opened for ${totalLabels} labels across ${pages.length} A4 sheet${pages.length === 1 ? "" : "s"}. No CPU quantities were changed.`);
    } catch (cause) {
      target.close();
      setError(cause instanceof Error ? cause.message : "The latest production could not be verified. Nothing was printed.");
      setAnnouncement("");
    } finally {
      setPrinting(false);
    }
  };

  const dateLabel = /^\d{4}-\d{2}-\d{2}$/.test(productionDate) ? gastroLabelDateLabel(productionDate) : "Date unavailable";

  return (
    <>
      <button ref={triggerRef} type="button" className="kitchen-button" aria-haspopup="dialog" onClick={() => { setError(""); setAnnouncement(""); setOpen(true); }}>
        Print Gastro Labels
      </button>
      <dialog
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby={titleId}
        onClose={() => { setOpen(false); triggerRef.current?.focus(); }}
      >
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>CPU Production · Delivered-In</p>
            <h2 id={titleId}>Print Gastro Labels</h2>
            <p>{dateLabel} · {selectedSiteIds.length ? `${selectedSiteIds.length} selected site${selectedSiteIds.length === 1 ? "" : "s"}` : "All sites"}</p>
          </div>
          <button type="button" className={styles.closeButton} onClick={close} aria-label="Close Gastro Labels">×</button>
        </header>
        <div className={styles.content}>
          <section aria-labelledby={`${titleId}-counts`}>
            <div className={styles.sectionHeading}>
              <div><h3 id={`${titleId}-counts`}>Manual label quantities</h3><p>Enter labels to print for each dish. Counts are not linked to portions, PAX or production quantities.</p></div>
              <button type="button" className={styles.refreshButton} onClick={() => void refreshDishes()} disabled={loading || printing}>Refresh dishes</button>
            </div>
            {loading ? <p className={styles.notice} role="status">Reading and checking the complete production day…</p> : null}
            {!loading && !error && dishes.length === 0 ? <p className={styles.empty}>No eligible published Delivered-In dishes are available for this date and site selection.</p> : null}
            {dishes.length > 0 ? <div className={styles.dishList}>
              {dishes.map((dish) => (
                <div className={styles.dishRow} key={dish.id}>
                  <span className={styles.dishName}>{dish.name}{quantities[dish.id] > 0 && fittedNames[dish.id] && !fittedNames[dish.id].fits ? <small className={styles.fitWarning}>Cannot fit at the minimum readable size of {GASTRO_LABEL_FONT.minimumPt} pt. This dish’s labels are blocked.</small> : null}</span>
                  <span className={styles.countField}><span>Labels</span><input aria-label={`Number of ${dish.name} labels`} type="number" min="0" step="1" inputMode="numeric" value={quantities[dish.id] ?? 0} onChange={(event) => setQuantity(dish.id, event.currentTarget.value)} disabled={loading || printing} /></span>
                  <label className={styles.fontField}>Name size<select aria-label={`Dish name font size for ${dish.name}`} value={fontOverrides[dish.id] ?? "auto"} onChange={(event) => setFontOverrides((current) => ({ ...current, [dish.id]: event.currentTarget.value === "auto" ? "auto" : Number(event.currentTarget.value) }))} disabled={loading || printing}>
                    <option value="auto">Auto fit</option>
                    {Array.from({ length: GASTRO_LABEL_FONT.maximumPt - GASTRO_LABEL_FONT.minimumPt + 1 }, (_, index) => GASTRO_LABEL_FONT.maximumPt - index).map((size) => <option key={size} value={size}>{size} pt</option>)}
                  </select></label>
                </div>
              ))}
            </div> : null}
            <label className={styles.startPosition}>Start position on first sheet
              <select value={startPosition} onChange={(event) => setStartPosition(Number(event.currentTarget.value))} disabled={printing}>
                {Array.from({ length: 8 }, (_, index) => <option value={index + 1} key={index + 1}>{index + 1}</option>)}
              </select>
            </label>
          </section>
          <section className={styles.previewSection} aria-labelledby={`${titleId}-preview`}>
            <h3 id={`${titleId}-preview`}>Print preview</h3>
            <dl className={styles.summary}>
              <div><dt>Labels</dt><dd>{totalLabels}</dd></div>
              <div><dt>A4 sheets</dt><dd>{pages.length}</dd></div>
              <div><dt>Skipped cells</dt><dd>{skippedCells}</dd></div>
              <div><dt>Blank cells</dt><dd>{blankCells}</dd></div>
            </dl>
            {pages.length ? <div ref={previewRef} className={styles.sheetList} aria-label="A4 label layout preview" style={{ "--preview-scale": previewScale } as React.CSSProperties}>
              {pages.map((page, pageIndex) => <div className={styles.sheetPreview} key={pageIndex} aria-label={`Sheet ${pageIndex + 1}`}>
                {page.map((cell) => <div className={cell.kind === "label" ? styles.previewLabel : styles.previewBlank} key={cell.position} style={{ gridColumn: cell.position % 2 ? 2 : 4, gridRow: 2 + 2 * Math.floor((cell.position - 1) / 2) }}>
                  {cell.kind === "label" ? <><strong data-preview-label className={styles.previewDishName} style={{ "--dish-font-size": `${fittedNames[cell.dish.id]?.fontSizePt ?? GASTRO_LABEL_FONT.minimumPt}pt` } as React.CSSProperties}>{cell.dish.name}</strong><span className={styles.previewDate}>{dateLabel}</span><span className={styles.previewSite}><b>SITE:</b><i aria-hidden="true" /></span><small className={styles.previewBrand}>FIKA X</small></> : <span>{cell.kind === "skipped" ? `Position ${cell.position} · already used` : `Position ${cell.position} · blank`}</span>}
                </div>)}
              </div>)}
            </div> : <p className={styles.empty}>Enter one or more labels to preview the 2 × 4 layout.</p>}
            <p className={styles.printHint}><strong>Print at Actual size / 100%.</strong> Disable fit-to-page, scaling, browser headers and footers. If the print dialog does not open, allow pop-ups for this CPU site. Trial C alignment still needs the kitchen paper check.</p>
          </section>
          {announcement ? <p className={styles.announcement} role="status" aria-live="polite">{announcement}</p> : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </div>
        <footer className={styles.footer}>
          <button type="button" className={styles.cancelButton} onClick={close}>Cancel</button>
          <button type="button" className="kitchen-button kitchen-print-primary" onClick={() => void print()} disabled={loading || printing || !totalLabels || countError || fontError || !dishes.length}>{printing ? "Checking production…" : "Preview PDF and print"}</button>
        </footer>
      </dialog>
    </>
  );
}
