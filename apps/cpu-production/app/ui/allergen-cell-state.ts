import { isCompleteOperationalAllergenMap, type OperationalAllergenState } from "../../../shared/allergen-contract";
import { readExplicitAllergens } from "../../../shared/allergen-declaration";
import { namedPositives, selectNamedAllergen } from "../../../shared/allergen-declaration";
import { cycleNamedAllergen, editableAllergens, isNoKeyTicked, rowAttestation, toggleNoKey, type RowAllergenContext } from "../lib/allergen-explicit";

/** A row with no recorded assessment carries no allergen values; every cell then renders neutral. */
export function emptyAllergens(): Record<string, OperationalAllergenState> {
  return {};
}

/**
 * Missing values stay absent (unrecorded). Only states actually stored are hydrated, and nothing is derived: a stored No Key value
 * is returned exactly as recorded and is only honoured as a declaration when the row carries a declaration record or an explicit
 * review (see `editableAllergens`).
 */
export function hydrateSavedAllergens(saved: Record<string, unknown> | undefined): Record<string, OperationalAllergenState> {
  return Object.keys(saved || {}).length ? readExplicitAllergens(saved) : emptyAllergens();
}

/** The No Key Allergens checkbox state: true only for a deliberate declaration; blank and legacy automatic values are false. */
export function noKeyTicked(allergens: Record<string, OperationalAllergenState> | undefined, context: RowAllergenContext = {}): boolean {
  return isNoKeyTicked(allergens, context);
}

export function cellState(allergens: Record<string, OperationalAllergenState> | undefined, key: string): OperationalAllergenState {
  return allergens?.[key] || "unrecorded";
}

/** Unrecorded is neutral/blank on screen; it is never rendered as an explicit clear and still blocks completion. */
export function cellLabel(state: OperationalAllergenState): string {
  return state === "may_contain" ? "MC" : "";
}

/**
 * What clicking an allergen cell does in the CPU review: Contains, then May Contain, then back to white (blank). Selecting any
 * allergen clears a No Key Allergens tick; removing the last allergen returns the row to BLANK, never to No Key. Nothing is
 * recorded as Clear by a click: any edit reopens the row, so Clears from an earlier confirmation revert to blank and only the chef's
 * explicit positives remain until the row is confirmed again with Mark checked. No Key is toggled with `toggleNoKeyAllergens`.
 */
export function applyHospitalityCellClick(allergens: Record<string, OperationalAllergenState>, key: string, context: RowAllergenContext = {}): Record<string, OperationalAllergenState> {
  if (key === "no_key_allergens") return toggleNoKey(allergens, context);
  return cycleNamedAllergen(allergens, key, context);
}

/**
 * Issue 251: the Hospitality order-detail checker is strictly binary. A named allergen box is OFF (white) or ON (black, Contains);
 * a click flips it. May Contain is NOT part of this interaction and can never be created by a click here (the shared
 * `applyHospitalityCellClick` cycle used by other surfaces is untouched). A persisted legacy May Contain is preserved verbatim until
 * the chef deliberately clicks that very box, which makes it Contains (the stricter value, never a silent deletion); a second click switches it OFF. Either is a normal edit (the edit reopens the row's review, so the
 * confirmation, signatures and releases are revoked/re-reviewed by the existing rules). Selecting a named allergen withdraws a No
 * Key tick; the last named allergen going OFF leaves the row BLANK (unverified), never No Key. No Key is exclusive with named
 * allergens and keeps its own toggle.
 */
export function applyHospitalityBinaryClick(allergens: Record<string, OperationalAllergenState>, key: string, context: RowAllergenContext = {}): Record<string, OperationalAllergenState> {
  if (key === "no_key_allergens") return toggleNoKey(allergens, context);
  const base = editableAllergens(allergens, context);
  const current = namedPositives(base)[key];
  const result = selectNamedAllergen(base, key as never, current === "contains" ? null : "contains", { acknowledgeNoKeyWithdrawal: true });
  if (!result.ok) throw new Error("Unexpected refusal while acknowledging the No Key withdrawal.");
  return result.allergens;
}

/** The state of one box on the binary Hospitality checker. `legacy_may_contain` is persisted evidence, shown distinctly and never creatable here. */
export type BinaryCellView = "on" | "off" | "legacy_may_contain";

/** No Key is "on" only for a deliberate declaration (or a conflict, which must stay visible so it can be resolved). */
export function binaryCellView(allergens: Record<string, OperationalAllergenState> | undefined, key: string, context: RowAllergenContext = {}): BinaryCellView {
  if (key === "no_key_allergens") {
    const attestation = rowAttestation({ name: "", allergens, evidenceStatus: "not_completed", allergenReview: context.review as never, noKeyDeclaration: context.declaration as never });
    return attestation === "declared" || attestation === "conflict" ? "on" : "off";
  }
  const state = cellState(allergens, key);
  return state === "contains" ? "on" : state === "may_contain" ? "legacy_may_contain" : "off";
}

/** Non-visible accessible name for a box: allergen name, sub-item and on/off state. */
export function binaryCellAriaLabel(label: string, rowName: string, view: BinaryCellView): string {
  return `${label} for ${rowName || "sub-item"}: ${view === "on" ? "on" : view === "off" ? "off" : "May Contain recorded (existing value)"}`;
}

/** aria-pressed for the box; a persisted May Contain is "mixed" so assistive tech does not report it as plainly on or off. */
export function binaryCellPressed(view: BinaryCellView): boolean | "mixed" {
  return view === "on" ? true : view === "off" ? false : "mixed";
}

export { toggleNoKey as toggleNoKeyAllergens };

/**
 * Text-first review badge for a row (never colour-only). "Checked by" is the server-stamped confirmation; a completed row without a
 * record is a legacy check made before confirmations were recorded; anything else is not reviewed.
 */
export function rowReviewBadge(row: { evidenceStatus: string; allergens: Record<string, unknown> | undefined; allergenReview?: { confirmedBy: string; confirmedAt: string }; noKeyDeclaration?: { declared?: boolean } | null }, checkedThisSession = false): { tone: "checked" | "legacy" | "pending" | "unreviewed" | "blank" | "legacy_no_key"; text: string } {
  const attestation = rowAttestation({ name: "", ...row, allergenReview: row.allergenReview as never, noKeyDeclaration: row.noKeyDeclaration as never });
  // A row without a deliberate declaration is never presented as checked or allergen-free, whatever its stored Clear values say.
  if (attestation === "legacy_unverified") return { tone: "legacy_no_key", text: "Legacy No Key (unverified, review needed)" };
  if (attestation === "conflict") return { tone: "unreviewed", text: "Conflict: untick No Key or the allergens" };
  const complete = row.evidenceStatus === "completed" && isCompleteOperationalAllergenMap(readExplicitAllergens(row.allergens));
  if (!complete) return { tone: attestation === "blank" ? "blank" : "unreviewed", text: attestation === "blank" ? "Blank (not verified)" : "Not reviewed" };
  if (!row.allergenReview && checkedThisSession) return { tone: "pending", text: "Checked, not yet saved" };
  if (!row.allergenReview) return { tone: "legacy", text: "Checked (legacy)" };
  const when = new Date(row.allergenReview!.confirmedAt);
  const stamp = Number.isNaN(when.getTime()) ? "" : `, ${when.toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
  return { tone: "checked", text: `Checked by ${row.allergenReview!.confirmedBy}${stamp}` };
}
