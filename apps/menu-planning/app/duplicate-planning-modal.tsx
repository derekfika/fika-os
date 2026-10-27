"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PlannerModal from "./planner-modal";
import type { WeekSummary } from "./planner-data";

/**
 * One Duplicate Planning workflow for Week Planner and Portion Planner. The server
 * computes every preview and write; this component only states intent and shows the
 * reviewed preview. Apply sends the preview's operation ID and plan hash back.
 */

type CopyContent = "menu" | "portions" | "menu-and-portions";
type ExistingMode = "replace" | "fill-empty";
type SourceScope = "week" | "days";
type Preview = {
  planHash: string;
  plan: {
    totals: { targets: number; dishesChanged: number; allocationRowsWritten: number; overwrites: number; exceptions: number; unchanged: number };
    targets: Array<{
      weekId: string;
      weekCommencing: string;
      isNewWeek: boolean;
      alreadyApplied: boolean;
      expectedVersion: number;
      changed: boolean;
      dishesChanged: number;
      createdEntries: number;
      allocationRowsWritten: number;
      unchangedEntries: number;
      rowsAdded: string[];
      overwrites: Array<{ entryId: string; dayId: string; slot: string; fromDish: string; toDish: string; retainedAllocationRows: number; replacedAllocationRows: number }>;
      exceptions: Array<{ weekCommencing: string; dayName?: string; date?: string; slot?: string; kind: string; message: string }>;
    }>;
  };
};

export type DuplicatePlanningOrigin = "week" | "portion";

export type DuplicatePlanningModalProps = {
  origin: DuplicatePlanningOrigin;
  weeks: WeekSummary[];
  currentWeek: { id: string; weekCommencing: string; version: number };
  /** Days shown in the grid (Monday to Friday), in order. */
  dayNames: string[];
  /** Index of the day the Portion Planner is showing. Ignored by the Week Planner. */
  selectedDayIndex?: number;
  onApplied: (weekId: string) => unknown;
  onClose: () => void;
};

const CONTENT_OPTIONS: Array<{ value: CopyContent; title: string; description: string }> = [
  { value: "menu", title: "Menu only", description: "Copies dish selections and slots. Source quantities are not copied; target quantities stay." },
  { value: "portions", title: "Portions only", description: "Keeps target dishes. Copies per-site quantities onto matching target slots that already hold a dish." },
  { value: "menu-and-portions", title: "Menu + portions", description: "Copies dish selections and per-site quantities together." },
];

const addDays = (iso: string, days: number) => {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};
const formatWeek = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const newOperationId = () => `dup-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`}`;

export default function DuplicatePlanningModal({ origin, weeks, currentWeek, dayNames, selectedDayIndex = 0, onApplied, onClose }: DuplicatePlanningModalProps) {
  const isPortion = origin === "portion";
  const sourceCandidates = useMemo(() => weeks.filter(week => week.entryIds.length > 0), [weeks]);
  const [sourceWeekId, setSourceWeekId] = useState(isPortion ? currentWeek.id : (sourceCandidates.find(week => week.id !== currentWeek.id)?.id || currentWeek.id));
  const [sourceScope, setSourceScope] = useState<SourceScope>(isPortion ? "days" : "week");
  const [sourceDays, setSourceDays] = useState<number[]>([selectedDayIndex]);
  const [destinationOffsets, setDestinationOffsets] = useState<number[]>(isPortion ? [7] : [0]);
  const [placement, setPlacement] = useState<"corresponding" | "day">("corresponding");
  const [placementDay, setPlacementDay] = useState(selectedDayIndex);
  const [content, setContent] = useState<CopyContent>(isPortion ? "portions" : "menu-and-portions");
  const [existing, setExisting] = useState<ExistingMode>("fill-empty");
  const [preview, setPreview] = useState<Preview>();
  const [previewError, setPreviewError] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [operationId, setOperationId] = useState(newOperationId);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applied, setApplied] = useState<string>();
  const [applyError, setApplyError] = useState("");
  const requestSeq = useRef(0);

  const scopeDays = sourceScope === "week" ? [0, 1, 2, 3, 4, 5, 6] : sourceDays;
  // Destinations are identified by their week offset from the open week, so any existing week is selectable.
  const destinationWeeks = useMemo(() => {
    const offsetOf = (weekCommencing: string) => Math.round((Date.parse(`${weekCommencing}T00:00:00Z`) - Date.parse(`${currentWeek.weekCommencing}T00:00:00Z`)) / (7 * 86400000));
    const offsets = new Set<number>([0, 1, 2, 3, 4, 5, 6, 7, 8, ...weeks.map(week => offsetOf(week.weekCommencing))]);
    return [...offsets].sort((a, b) => a - b).map(offset => [addDays(currentWeek.weekCommencing, offset * 7), offset] as const);
  }, [currentWeek.weekCommencing, weeks]);
  const destinationWeekCommencings = destinationOffsets.map(offset => addDays(currentWeek.weekCommencing, offset * 7));
  const singleDaySource = sourceScope === "days" && sourceDays.length === 1;
  const effectivePlacement = singleDaySource && placement === "day" ? { kind: "day" as const, dayIndex: placementDay } : { kind: "corresponding" as const };

  const sourceChoiceValid = scopeDays.length > 0 && (sourceScope === "week" || sourceDays.length > 0);
  const destinationValid = destinationWeekCommencings.length > 0 && destinationWeekCommencings.length <= 8;
  const requestBody = (mode: "preview" | "apply", extra: Record<string, unknown> = {}) => ({
    action: "duplicate-plan",
    mode,
    sourceWeekId,
    scope: sourceScope === "week" ? { kind: "week" } : { kind: "days", dayIndexes: [...sourceDays].sort((a, b) => a - b) },
    destinations: destinationWeekCommencings.map(weekCommencing => ({ weekCommencing, placement: effectivePlacement })),
    content,
    existing,
    operationId,
    ...extra,
  });

  // Every change to the inputs invalidates the reviewed preview and draws a fresh operation ID.
  useEffect(() => {
    if (!sourceChoiceValid || !destinationValid) return;
    const seq = ++requestSeq.current;
    const nextOperation = newOperationId();
    setOperationId(nextOperation);
    setPreview(undefined);
    setConfirmed(false);
    setApplyError("");
    setPreviewing(true);
    setPreviewError("");
    const timer = window.setTimeout(() => {
      const body = { action: "duplicate-plan", mode: "preview", sourceWeekId, scope: sourceScope === "week" ? { kind: "week" } : { kind: "days", dayIndexes: [...sourceDays].sort((a, b) => a - b) }, destinations: destinationWeekCommencings.map(weekCommencing => ({ weekCommencing, placement: effectivePlacement })), content, existing, operationId: nextOperation };
      void fetch("/api/rolling-menu", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
        .then(async response => {
          const payload = await response.json().catch(() => ({}));
          if (seq !== requestSeq.current) return;
          if (!response.ok) throw new Error(payload.error?.message || payload.error || "The preview could not be prepared.");
          setPreview(payload as Preview);
        })
        .catch(cause => { if (seq === requestSeq.current) setPreviewError(cause instanceof Error ? cause.message : "The preview could not be prepared."); })
        .finally(() => { if (seq === requestSeq.current) setPreviewing(false); });
    }, 250);
    return () => window.clearTimeout(timer);
    // Keyed on the reviewed inputs; the derived request is rebuilt from them on each run.
  }, [sourceWeekId, sourceScope, sourceDays.join(","), destinationWeekCommencings.join(","), content, existing, placement, placementDay]);

  const hasExistingChanges = Boolean(preview?.plan.targets.some(target => target.overwrites.length > 0));
  const needsConfirmation = existing === "replace" && hasExistingChanges;
  const publishedWarnings = preview?.plan.targets.flatMap(target => target.exceptions.filter(item => item.kind === "published")) || [];
  const canApply = Boolean(preview && !previewing && !saving && (!needsConfirmation || confirmed) && preview.plan.totals.dishesChanged + preview.plan.totals.allocationRowsWritten > 0);

  const apply = async () => {
    if (!preview || !canApply) return;
    setSaving(true);
    setApplyError("");
    try {
      const expectedVersions = Object.fromEntries(preview.plan.targets.filter(target => !target.isNewWeek).map(target => [target.weekCommencing, target.expectedVersion]));
      const response = await fetch("/api/rolling-menu", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(requestBody("apply", { planHash: preview.planHash, expectedVersions })) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error?.message || payload.error || "The duplicate could not be applied. Refresh and review it again.");
      const appliedWeeks = (payload.applied || []) as Array<{ weekId: string; weekCommencing: string }>;
      setApplied(`Copied to ${appliedWeeks.length ? appliedWeeks.map(week => formatWeek(week.weekCommencing)).join(", ") : "no weeks (already applied or nothing to change)"}. ${preview.plan.totals.dishesChanged} dish${preview.plan.totals.dishesChanged === 1 ? "" : "es"} and ${preview.plan.totals.allocationRowsWritten} allocation row${preview.plan.totals.allocationRowsWritten === 1 ? "" : "s"} written as draft.`);
      await onApplied(appliedWeeks[0]?.weekId || currentWeek.id);
    } catch (cause) {
      setApplyError(cause instanceof Error ? cause.message : "The duplicate could not be applied.");
    } finally {
      setSaving(false);
    }
  };

  const toggleSourceDay = (index: number) => setSourceDays(current => current.includes(index) ? current.filter(day => day !== index) : [...current, index]);
  const toggleDestination = (offset: number) => setDestinationOffsets(current => current.includes(offset) ? current.filter(item => item !== offset) : [...current, offset].sort((a, b) => a - b));

  return <PlannerModal title="Duplicate planning" onClose={onClose} dismissible={!saving} busy={saving} className="item-detail planner-input-dialog duplicate-planning-dialog">
    <header>
      <div><small>{isPortion ? "Portion Planner" : "Week Planner"} · Duplicate planning</small><h3>Duplicate planning</h3></div>
      <button type="button" className="modal-close" onClick={onClose} disabled={saving} aria-label="Close duplicate planning">Close</button>
    </header>

    {applied ? <div className="duplicate-week-summary" role="status"><div><small>Done · draft until published</small><strong>{applied}</strong></div></div> : <>
      <fieldset className="duplicate-step">
        <legend>1 · From</legend>
        <label>Source week<select data-modal-autofocus value={sourceWeekId} onChange={event => setSourceWeekId(event.target.value)} disabled={saving}>{sourceCandidates.map(week => <option key={week.id} value={week.id}>WC {formatWeek(week.weekCommencing)}{week.id === currentWeek.id ? " (current)" : ""}</option>)}</select></label>
        <div className="duplicate-segment" role="radiogroup" aria-label="Source scope">
          <label><input type="radio" name="dup-scope" checked={sourceScope === "week"} onChange={() => setSourceScope("week")} disabled={saving} /> Whole week</label>
          <label><input type="radio" name="dup-scope" checked={sourceScope === "days"} onChange={() => setSourceScope("days")} disabled={saving} /> Selected days</label>
        </div>
        {sourceScope === "days" && <div className="duplicate-segment" role="group" aria-label="Source weekdays">{dayNames.map((name, index) => <label key={name}><input type="checkbox" checked={sourceDays.includes(index)} onChange={() => toggleSourceDay(index)} disabled={saving} /> {name.slice(0, 3)}</label>)}</div>}
      </fieldset>

      <fieldset className="duplicate-step">
        <legend>2 · To</legend>
        <div className="duplicate-segment" role="group" aria-label="Destination weeks">{destinationWeeks.map(([weekCommencing, offset]) => <label key={weekCommencing}><input type="checkbox" checked={destinationOffsets.includes(offset)} disabled={saving} onChange={() => toggleDestination(offset)} /> WC {formatWeek(weekCommencing)}{offset === 0 ? " · current" : ""}</label>)}</div>
        {singleDaySource && <div className="duplicate-segment" role="radiogroup" aria-label="Destination weekday">
          <label><input type="radio" name="dup-placement" checked={placement === "corresponding"} onChange={() => setPlacement("corresponding")} disabled={saving} /> Same weekday</label>
          <label><input type="radio" name="dup-placement" checked={placement === "day"} onChange={() => setPlacement("day")} disabled={saving} /> Another weekday <select value={placementDay} onChange={event => { setPlacement("day"); setPlacementDay(Number(event.target.value)); }} disabled={saving} aria-label="Destination day">{dayNames.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label>
        </div>}
      </fieldset>

      <fieldset className="duplicate-step">
        <legend>3 · What to copy</legend>
        <div className="duplicate-options" role="radiogroup" aria-label="Copy mode">{CONTENT_OPTIONS.map(option => <label key={option.value} className={`duplicate-option${content === option.value ? " duplicate-option--selected" : ""}`}><input type="radio" name="dup-content" checked={content === option.value} onChange={() => setContent(option.value)} disabled={saving} /><strong>{option.title}</strong><small>{option.description}</small></label>)}</div>
        <div className="duplicate-segment" role="radiogroup" aria-label="Existing target data">
          <label><input type="radio" name="dup-existing" checked={existing === "fill-empty"} onChange={() => setExisting("fill-empty")} disabled={saving} /> Fill empty slots only</label>
          <label><input type="radio" name="dup-existing" checked={existing === "replace"} onChange={() => setExisting("replace")} disabled={saving} /> Replace selected target data</label>
        </div>
      </fieldset>

      <section className="duplicate-preview" aria-live="polite" aria-label="Duplicate preview">
        <h4>Preview</h4>
        {previewing && <p className="form-help" role="status">Checking the planning data…</p>}
        {previewError && <p className="menu-error" role="alert">{previewError}</p>}
        {preview && <>
          <div className="duplicate-week-summary">
            <div><small>Dishes affected</small><strong>{preview.plan.totals.dishesChanged}</strong></div>
            <div><small>Allocation rows written</small><strong>{preview.plan.totals.allocationRowsWritten}</strong></div>
            <div><small>Skipped or unmatched</small><strong>{preview.plan.totals.exceptions}</strong></div>
          </div>
          <ul className="duplicate-target-list">{preview.plan.targets.map(target => <li key={target.weekId}>WC {formatWeek(target.weekCommencing)}{target.isNewWeek ? " · new week will be created" : ""}{target.alreadyApplied ? " · already applied, nothing to write" : ""}{!target.changed && !target.alreadyApplied ? " · nothing to change" : ""}{target.changed ? ` · ${target.dishesChanged + target.createdEntries} dish changes, ${target.allocationRowsWritten} allocation rows` : ""}</li>)}</ul>
          {hasExistingChanges && <div className="duplicate-week-warning" role="alert"><strong>Existing target data will change.</strong><ul>{preview.plan.targets.flatMap(target => target.overwrites.map(overwrite => <li key={`${target.weekId}:${overwrite.entryId}`}>WC {formatWeek(target.weekCommencing)} · {overwrite.slot}: {overwrite.fromDish || "blank"} → {overwrite.toDish}{overwrite.retainedAllocationRows ? ` (${overwrite.retainedAllocationRows} existing quantity row${overwrite.retainedAllocationRows === 1 ? "" : "s"} kept for review)` : ""}{overwrite.replacedAllocationRows ? ` (${overwrite.replacedAllocationRows} allocation row${overwrite.replacedAllocationRows === 1 ? "" : "s"} replaced)` : ""}</li>))}</ul></div>}
          {preview.plan.targets.some(target => target.rowsAdded.length) && <p className="form-help">Governed menu rows will be added to the target week: {preview.plan.targets.flatMap(target => target.rowsAdded).join(", ")}.</p>}
          {publishedWarnings.length > 0 && <div className="duplicate-week-warning" role="status"><strong>Published days are protected.</strong><span>{publishedWarnings.length} published day{publishedWarnings.length === 1 ? "" : "s"} will be skipped. Changes to published menus go through the amendment flow.</span></div>}
          {preview.plan.totals.exceptions > 0 && <details className="duplicate-exceptions"><summary>{preview.plan.totals.exceptions} skipped or unmatched item{preview.plan.totals.exceptions === 1 ? "" : "s"}</summary><ul>{preview.plan.targets.flatMap(target => target.exceptions.map((item, index) => <li key={`${target.weekId}:${index}`}>WC {formatWeek(target.weekCommencing)}{item.dayName ? ` · ${item.dayName}` : ""}{item.slot ? ` · ${item.slot}` : ""}: {item.message}</li>))}</ul></details>}
          {needsConfirmation && <label className="duplicate-week-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={saving} /> I understand that the existing target data listed above will be replaced.</label>}
        </>}
        {applyError && <p className="menu-error" role="alert">{applyError}</p>}
      </section>

      <footer className="form-actions">
        <button type="button" className="button button-soft" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="button" className={`button ${needsConfirmation ? "button-danger" : "button-purple"}`} disabled={!canApply} onClick={() => void apply()}>{saving ? "Copying…" : needsConfirmation ? "Replace and copy as draft" : "Copy as draft"}</button>
      </footer>
    </>}
    {applied && <footer className="form-actions"><button type="button" className="button button-purple" onClick={onClose}>Done</button></footer>}
  </PlannerModal>;
}
