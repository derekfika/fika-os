import { confirmRow, isRowConfirmed, rowFingerprint, type AllergenRowReview } from "../../../shared/allergen-review";
import type { PlannedMenuItem, PlannedSubItem } from "./production-plan";

const sameAllergens = (left: PlannedSubItem, right: PlannedSubItem) => rowFingerprint(left.name, left.allergens, left.mayContainNotes) === rowFingerprint(right.name, right.allergens, right.mayContainNotes);

/**
 * Server-owned confirmation evidence for CPU rows. Whatever `allergenReview` a client sends is discarded; a completed row keeps
 * the review stored on the previous plan only while it still matches the row's present inputs, otherwise the server stamps a new
 * confirmation (reviewer and time). A completed row that is unchanged from a legacy completed row stays unstamped (legacy). A row that
 * is not completed carries no confirmation.
 */
export function stampAllergenReviews(previous: PlannedMenuItem[], next: PlannedMenuItem[], actor: string, at: string): PlannedMenuItem[] {
  const before = new Map(previous.flatMap(item => item.subItems.map(sub => [sub.id, sub] as const)));
  return next.map(item => ({
    ...item,
    subItems: item.subItems.map(sub => {
      const { allergenReview: _clientRecord, ...row } = sub;
      if (row.evidenceStatus !== "completed") return row;
      const prior = before.get(row.id);
      if (prior?.allergenReview && isRowConfirmed({ allergens: row.allergens, review: prior.allergenReview, identity: row.name, mayContainNotes: row.mayContainNotes })) return { ...row, allergenReview: prior.allergenReview };
      if (prior && prior.evidenceStatus === "completed" && !prior.allergenReview && sameAllergens(prior, row)) return row;
      try {
        const review: AllergenRowReview = confirmRow({ allergens: row.allergens, identity: row.name, mayContainNotes: row.mayContainNotes, actor, now: at }).review;
        return { ...row, allergenReview: review };
      } catch {
        return row;
      }
    }),
  }));
}
