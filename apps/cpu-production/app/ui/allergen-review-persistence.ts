import { CANONICAL_ALLERGEN_COLUMNS, CANONICAL_ALLERGEN_KEYS, isCompleteOperationalAllergenMap, normaliseOperationalAllergens, toggleOperationalAllergen, type CanonicalAllergenKey } from "../../../shared/allergen-contract";
import type { PlannedMenuItem, PlannedSubItem } from "../lib/production-plan";
import { isProductionPlanMatrixComplete } from "../lib/production-plan-state";
import { createSaveCoalescer } from "./allergen-save-coalescer";

/**
 * Pure logic behind the Hospitality / sandwich allergen review workflow: what is displayed, when a row may be marked checked,
 * when signing may start, and how edits are persisted. Nothing here changes allergen, signing, generation or authority
 * semantics: it only decides what the UI offers and when it saves, using the existing `save-plan` / `mark-planned` commands.
 */

export const ALLERGEN_AUTOSAVE_DEBOUNCE_MS = 800;
export const ALLERGEN_COLUMN_COUNT = CANONICAL_ALLERGEN_COLUMNS.length;

/** Every allergen key with its stored state, or `unrecorded` when nothing was recorded. Never invents `clear`. */
export function displayAllergenMap(allergens: Record<string, string> | undefined): Record<string, string> {
  const stored = normaliseOperationalAllergens(allergens);
  return Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map(key => [key, stored[key] || "unrecorded"]));
}
export const displayAllergenState = (allergens: Record<string, string> | undefined, key: string) => displayAllergenMap(allergens)[key];
/** Chef-facing words for a state; `unrecorded` is "Not checked". */
export const ALLERGEN_STATE_WORDS: Record<string, string> = { clear: "free from", contains: "contains", may_contain: "may contain", unrecorded: "not checked" };

export const rowUncheckedCount = (sub: Pick<PlannedSubItem, "allergens">) => Object.values(displayAllergenMap(sub.allergens)).filter(state => state === "unrecorded").length;
/** A row may only be marked checked when every allergen has an explicit state. "Mark checked" never accepts an unrecorded allergen. */
export const rowCanBeChecked = (sub: Pick<PlannedSubItem, "allergens" | "name">) => Boolean(sub.name.trim()) && isCompleteOperationalAllergenMap(displayAllergenMap(sub.allergens));

export type ReviewProgress = { checked: number; total: number; rows: number; rowsChecked: number; allExplicit: boolean; allRowsChecked: boolean; complete: boolean };
/** "23 of 28 allergens checked" counts explicit states over every allergen cell. `complete` is the same predicate the server enforces. */
export function reviewProgress(menuItems: PlannedMenuItem[]): ReviewProgress {
  const subs = menuItems.flatMap(item => item.subItems);
  const total = subs.length * ALLERGEN_COLUMN_COUNT;
  const checked = subs.reduce((sum, sub) => sum + ALLERGEN_COLUMN_COUNT - rowUncheckedCount(sub), 0);
  const rowsChecked = subs.filter(sub => sub.evidenceStatus === "completed").length;
  return { checked, total, rows: subs.length, rowsChecked, allExplicit: total > 0 && checked === total, allRowsChecked: subs.length > 0 && rowsChecked === subs.length, complete: isProductionPlanMatrixComplete(menuItems) };
}

/** Which existing command persists this state: a complete review goes through `mark-planned`, anything else through `save-plan`. */
export const autosaveAction = (menuItems: PlannedMenuItem[]): "save-plan" | "mark-planned" => (isProductionPlanMatrixComplete(menuItems) ? "mark-planned" : "save-plan");

// ---------------------------------------------------------------------------------------------------------------------------
// Pure edits. In read-only mode (any signature, current release or signed artifact) every one of them returns the SAME array
// reference: viewing or clicking a signed matrix cannot change local state, so it can never clear signatures or trigger a save.
// ---------------------------------------------------------------------------------------------------------------------------
const mapSub = (items: PlannedMenuItem[], menuId: string, subId: string, change: (sub: PlannedSubItem) => PlannedSubItem) =>
  items.map(item => (item.id === menuId ? { ...item, subItems: item.subItems.map(sub => (sub.id === subId ? change(sub) : sub)) } : item));

export function toggleCellInItems(items: PlannedMenuItem[], menuId: string, subId: string, key: string, readOnly: boolean): PlannedMenuItem[] {
  if (readOnly) return items;
  // Cycle from the DISPLAYED state: a not-checked cell first becomes an explicit "free from", then contains, may contain, free from.
  return mapSub(items, menuId, subId, sub => ({ ...sub, allergens: toggleOperationalAllergen(displayAllergenMap(sub.allergens) as never, key as CanonicalAllergenKey), evidenceStatus: "not_completed" }));
}

export type CheckRowResult = { items: PlannedMenuItem[]; changed: boolean; reason?: "read_only" | "not_checked" | "already_checked" | "unnamed" };
export function checkRowInItems(items: PlannedMenuItem[], menuId: string, subId: string, readOnly: boolean): CheckRowResult {
  if (readOnly) return { items, changed: false, reason: "read_only" };
  const sub = items.find(item => item.id === menuId)?.subItems.find(candidate => candidate.id === subId);
  if (!sub) return { items, changed: false };
  if (sub.evidenceStatus === "completed") return { items, changed: false, reason: "already_checked" };
  if (!sub.name.trim()) return { items, changed: false, reason: "unnamed" };
  if (!rowCanBeChecked(sub)) return { items, changed: false, reason: "not_checked" };
  return { items: mapSub(items, menuId, subId, candidate => ({ ...candidate, evidenceStatus: "completed" as const })), changed: true };
}

/** Wraps any other content mutation (notes, names, add/remove rows, library) so it is a no-op while read-only. */
export const guardedEdit = <T>(items: T, readOnly: boolean, edit: () => T): T => (readOnly ? items : edit());

// ---------------------------------------------------------------------------------------------------------------------------
// Signing gate
// ---------------------------------------------------------------------------------------------------------------------------
export type PersistenceStatus = "saved" | "dirty" | "saving" | "error";
export type SigningBlock = "read_only" | "incomplete" | "unchecked" | "dirty" | "saving" | "error" | "not_planned";
/**
 * Signing may start only on a complete, explicit, fully checked matrix that is durably saved and confirmed `planned` by the server.
 * `readOnly` here means every required signature is already recorded (nothing is left to sign). A PARTLY signed matrix is locked
 * for editing but must stay signable for the missing role, so the editor passes `fullySigned`, not its edit lock.
 */
export function signingGate(input: { menuItems: PlannedMenuItem[]; persistence: PersistenceStatus; serverPlanStatus: string; readOnly: boolean; busy?: boolean }): { canSign: boolean; block?: SigningBlock } {
  const progress = reviewProgress(input.menuItems);
  if (input.readOnly) return { canSign: false, block: "read_only" };
  if (!progress.allExplicit) return { canSign: false, block: "unchecked" };
  if (!progress.complete || !progress.allRowsChecked) return { canSign: false, block: "incomplete" };
  if (input.persistence === "dirty") return { canSign: false, block: "dirty" };
  if (input.persistence === "saving") return { canSign: false, block: "saving" };
  if (input.persistence === "error") return { canSign: false, block: "error" };
  if (input.serverPlanStatus !== "planned") return { canSign: false, block: "not_planned" };
  return input.busy ? { canSign: false, block: "saving" } : { canSign: true };
}

/**
 * The visible state of a Sign button. It is disabled whenever the matrix is dirty (including a pending debounce), saving, in a save
 * error, incomplete, unchecked, or not yet confirmed `planned` by the server; it is enabled only on a clean, saved, complete matrix.
 * Clicking still flushes and re-checks (defence in depth), but an enabled button normally has nothing outstanding to flush.
 */
export function signButtonState(input: { menuItems: PlannedMenuItem[]; persistence: PersistenceStatus; serverPlanStatus: string; fullySigned: boolean; busy: boolean }): { disabled: boolean; block?: SigningBlock } {
  const gate = signingGate({ menuItems: input.menuItems, persistence: input.persistence, serverPlanStatus: input.serverPlanStatus, readOnly: input.fullySigned, busy: input.busy });
  return gate.canSign ? { disabled: false } : { disabled: true, block: gate.block };
}

/** The status line shown above the matrix. */
export function reviewStatusCopy(input: { progress: ReviewProgress; persistence: PersistenceStatus; serverPlanStatus: string; readOnly: boolean }): string {
  if (input.readOnly) return "Allergen matrix approved. Open read-only.";
  const { progress } = input;
  if (progress.allExplicit && progress.complete && progress.allRowsChecked && input.persistence === "saved" && input.serverPlanStatus === "planned") return "All allergens reviewed · Ready for chef approval";
  if (progress.allExplicit && progress.complete && progress.allRowsChecked) return "All allergens reviewed · saving before chef approval";
  const remainingRows = progress.rows - progress.rowsChecked;
  return `${progress.checked} of ${progress.total} allergens checked${progress.allExplicit && remainingRows > 0 ? ` · ${remainingRows} row${remainingRows === 1 ? "" : "s"} to mark checked` : ""}`;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Autosave controller
// ---------------------------------------------------------------------------------------------------------------------------
export type AutosaveState = { status: PersistenceStatus; error?: string };
type Timers = { set(callback: () => void, ms: number): unknown; clear(handle: unknown): void };

/**
 * Debounced, coalesced, flushable autosave. Ordinary edits save after the debounce; a row check saves immediately; `flush()`
 * (used by signing and by closing the review) saves anything outstanding and resolves only once the latest edit is durably
 * saved (true) or the save failed (false). Saves run through the existing latest-wins coalescer, so they are serial and a
 * slow earlier write can never land after a later one. While read-only, edits are ignored and nothing is ever saved.
 */
export function createAutosaveController<P>(options: { save: (payload: P, revision: number) => Promise<void>; onChange?: (state: AutosaveState) => void; debounceMs?: number; timers?: Timers }) {
  const timers: Timers = options.timers || { set: (callback, ms) => setTimeout(callback, ms), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) };
  const debounceMs = options.debounceMs ?? ALLERGEN_AUTOSAVE_DEBOUNCE_MS;
  let revision = 0;
  let savedRevision = 0;
  let latest: P | undefined;
  let timer: unknown;
  let readOnly = false;
  let state: AutosaveState = { status: "saved" };
  const coalescer = createSaveCoalescer<{ payload: P; revision: number }>(async ({ payload, revision: saving }) => {
    await options.save(payload, saving);
    savedRevision = Math.max(savedRevision, saving);
  });
  const set = (next: AutosaveState) => { state = next; options.onChange?.(next); };
  const clearTimer = () => { if (timer !== undefined) { timers.clear(timer); timer = undefined; } };

  let submittedRevision = 0; // the newest revision already handed to the coalescer (a save for it may still be in flight)
  async function flush(): Promise<boolean> {
    clearTimer();
    for (;;) {
      if (latest === undefined || savedRevision >= revision) { if (state.status !== "saved") set({ status: "saved" }); return true; }
      set({ status: "saving" });
      try {
        // never queue a duplicate save of a revision that is already in flight: just wait for it
        if (submittedRevision === revision && coalescer.pending) await coalescer.pending;
        else { submittedRevision = revision; await coalescer.submit({ payload: latest, revision }); }
      } catch (error) {
        submittedRevision = 0; // a retry must really save again
        set({ status: "error", error: error instanceof Error ? error.message : "The review could not be saved." });
        return false;
      }
      // edits that arrived while saving are saved by the next iteration; only then is the review clean
    }
  }
  return {
    get state() { return state; },
    get revision() { return revision; },
    /** Records an edit. Returns false (and does nothing) while read-only. */
    edit(payload: P, mode: { immediate?: boolean } = {}): boolean {
      if (readOnly) return false;
      latest = payload; revision += 1;
      set({ status: "dirty" });
      if (mode.immediate) void flush();
      else { clearTimer(); timer = timers.set(() => { timer = undefined; void flush(); }, debounceMs); }
      return true;
    },
    flush,
    retry: flush,
    /** Read-only mode cancels any pending debounce: nothing may be saved from a signed/partially signed matrix. */
    setReadOnly(flag: boolean) { readOnly = flag; if (flag) clearTimer(); },
    dispose() { clearTimer(); },
  };
}
