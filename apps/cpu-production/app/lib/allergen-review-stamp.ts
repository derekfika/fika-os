import { rowFingerprint } from "../../../shared/allergen-review";
import { confirmRowExplicit, explicitRowFingerprint, namedPositives, readExplicitAllergens, type NoKeyDeclarationRecord } from "../../../shared/allergen-declaration";
import { classifyRowAllergens, sameNamedAllergens } from "./allergen-explicit";
import type { PlannedMenuItem, PlannedSubItem } from "./production-plan";

const sameAllergens = (left: PlannedSubItem, right: PlannedSubItem, leftIdentity: string, rightIdentity: string) => rowFingerprint(leftIdentity, left.allergens, left.mayContainNotes) === rowFingerprint(rightIdentity, right.allergens, right.mayContainNotes);

/**
 * Server-owned allergen declaration and confirmation evidence for CPU rows (issue 225).
 *
 * Whatever `allergenReview` / `noKeyDeclaration` a client sends is discarded. The server then decides what the row actually holds:
 *  - named Contains / May contain are evidence and always survive; if present they win over any No Key flag (selecting an
 *    allergen clears No Key);
 *  - `no_key_allergens: "contains"` from a client is a DELIBERATE declaration and is stamped with the authenticated actor and time;
 *  - a row with neither is BLANK. It may persist as a draft, but it can never be completed: a blank row sent as completed is
 *    demoted to not completed and its automatic Clear values are discarded (nothing is inferred as No Key);
 *  - a legacy row whose No Key value was derived (all clear, no declaration) is preserved verbatim when the client sends it back
 *    unchanged: it is neither rewritten nor converted into a declaration. It stays unverified until a chef reviews it;
 *  - a completed row keeps its prior confirmation while the inputs are unchanged, otherwise the server stamps a new one.
 */
export function stampAllergenReviews(previous: PlannedMenuItem[], next: PlannedMenuItem[], actor: string, at: string): PlannedMenuItem[] {
  const before = new Map(previous.flatMap(item => item.subItems.map(sub => [sub.id, sub] as const)));
  return next.map(item => ({
    ...item,
    subItems: item.subItems.map(sub => {
      // CPU sub-items are often unnamed (the dish name is on the menu item), so identity falls back to the menu item name.
      const identityOf = (row: PlannedSubItem) => row.name.trim() || item.name;
      const { allergenReview: _clientReview, noKeyDeclaration: clientDeclaration, ...row } = sub;
      // The only client input about No Key is the intent flag. A bare no_key_allergens value (old automatic derivation) is never a declaration.
      const tickIntent = clientDeclaration?.declared === true;
      const prior = before.get(row.id);
      const raw = readExplicitAllergens(row.allergens);
      const positives = namedPositives(raw);
      const hasPositives = Object.keys(positives).length > 0;
      const wantsNoKey = raw.no_key_allergens === "contains" && tickIntent && !hasPositives;
      const priorKind = prior ? classifyRowAllergens(prior.allergens, { review: prior.allergenReview, declaration: prior.noKeyDeclaration }) : "blank";

      // Legacy automatic No Key / all-clear row sent back unchanged: keep the stored evidence exactly as it was.
      if (prior && priorKind === "legacy_unverified" && !tickIntent && !hasPositives && row.evidenceStatus === prior.evidenceStatus
        && sameNamedAllergens(prior.allergens, raw) && readExplicitAllergens(prior.allergens).no_key_allergens === raw.no_key_allergens) {
        return { ...row, allergens: prior.allergens, ...(prior.allergenReview ? { allergenReview: prior.allergenReview } : {}) };
      }

      if (!hasPositives && !wantsNoKey) return { ...row, allergens: {}, evidenceStatus: "not_completed" as const };

      const priorDeclaration: NoKeyDeclarationRecord | undefined = prior && priorKind === "declared"
        ? (prior.noKeyDeclaration?.declared && prior.noKeyDeclaration.declaredBy && prior.noKeyDeclaration.declaredAt ? prior.noKeyDeclaration as NoKeyDeclarationRecord : prior.allergenReview ? { declared: true, declaredBy: prior.allergenReview.confirmedBy, declaredAt: prior.allergenReview.confirmedAt } : undefined)
        : undefined;
      const declaration: NoKeyDeclarationRecord | undefined = wantsNoKey ? (priorDeclaration ?? { declared: true, declaredBy: actor, declaredAt: at }) : undefined;
      // Named values are stored exactly as sent (the server never turns an unticked box into Clear; only a client Mark checked does).
      // No Key is stored only as a declaration (contains) or, beside named allergens, as the true consequence (clear).
      const { no_key_allergens: _sentNoKey, ...named } = raw;
      const stored = { ...named, no_key_allergens: wantsNoKey ? "contains" as const : "clear" as const };
      const withDeclaration = { ...row, allergens: stored, ...(declaration ? { noKeyDeclaration: declaration } : {}) };
      if (row.evidenceStatus !== "completed") return withDeclaration;

      const reviewedInput = wantsNoKey ? { no_key_allergens: "contains" as const } : positives;
      const identity = identityOf(row);
      const priorReview = prior?.allergenReview;
      if (priorReview?.semantics === 3 && priorReview.inputFingerprint === explicitRowFingerprint(identity, reviewedInput, row.mayContainNotes)) return { ...withDeclaration, allergenReview: priorReview };
      if (priorReview?.semantics === 2 && hasPositives && priorReview.inputFingerprint === rowFingerprint(identity, positives, row.mayContainNotes)) return { ...withDeclaration, allergenReview: priorReview };
      // Historical completed rows with positives and no stored confirmation stay unstamped while unchanged.
      if (prior && hasPositives && prior.evidenceStatus === "completed" && !prior.allergenReview && sameAllergens(prior, row, identityOf(prior), identity)) return withDeclaration;
      try {
        return { ...withDeclaration, allergenReview: confirmRowExplicit({ allergens: reviewedInput, identity, mayContainNotes: row.mayContainNotes, actor, now: at }).review };
      } catch {
        return { ...withDeclaration, evidenceStatus: "not_completed" as const };
      }
    }),
  }));
}
