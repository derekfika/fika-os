import { calendarDay, type Dish, type Menu, type Publication, type Review } from "../lib/contract";

export type PublicationReceipt = Pick<Publication, "id" | "menuId" | "revision" | "effectiveDate">;

export function acknowledgedPublication(value: unknown, menuId: string): PublicationReceipt | null {
  if (!value || typeof value !== "object") return null;
  const { id, menuId: receivedId, revision, effectiveDate } = value as Partial<PublicationReceipt>;
  if (typeof id !== "string" || !id || receivedId !== menuId ||
    typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1 ||
    typeof effectiveDate !== "string" || !Number.isFinite(calendarDay(effectiveDate))) return null;
  return { id, menuId, revision, effectiveDate };
}

const unavailableAuthorities =
  "Signed dish verification, catalogue eligibility and booking impact are unavailable.";

export type ReviewIssueTarget =
  | { kind: "menu" }
  | { kind: "section"; id: string; mapping?: true }
  | { kind: "dish"; id: string };

export type PresentedReviewIssue = { text: string; target?: ReviewIssueTarget };

/**
 * Existing review responses carry plain strings. Only known draft checks receive
 * direct navigation; unknown messages stay visible without assuming their meaning.
 */
export function presentReviewIssues(
  result: Review,
  menu: Menu,
  dishes: Dish[],
) {
  const editable: PresentedReviewIssue[] = [];
  const other: string[] = [];
  let authoritiesUnavailable = false;

  const menuChecks = new Set([
    "Enter a menu name.",
    "Enter a valid menu date range.",
    "Add at least one section.",
    "Choose a Monday to anchor the six-week cycle.",
    "Give each section a name.",
  ]);

  const reviewScreenChecks = new Set([
    "Choose an effective date within the menu dates and on or after today.",
    "Select a section included in this draft.",
    "Choose a rotating section for a week amendment.",
    "The selected dish is unavailable in this scope.",
  ]);

  for (const issue of result.issues) {
    if (reviewScreenChecks.has(issue)) {
      editable.push({ text: issue });
      continue;
    }
    if (issue === unavailableAuthorities) {
      authoritiesUnavailable = true;
      continue;
    }
    if (menuChecks.has(issue)) {
      editable.push({ text: issue, target: { kind: "menu" } });
      continue;
    }
    const sections = menu.sections.filter((section) => {
      const name = section.name.trim() || "Unnamed section";
      return [
        name + " needs a Hub catalogue mapping.",
        name + " duplicates a catalogue mapping.",
        name + " has an empty dish list.",
      ].includes(issue);
    });
    const dishMatches = dishes.filter((dish) => {
      const name = dish.name || "Unnamed dish";
      return [
        name + " needs a name and both descriptions.",
        name + " has an incomplete fixed assortment.",
      ].includes(issue);
    });
    if (sections.length + dishMatches.length === 1) {
      const target: ReviewIssueTarget = sections.length
        ? {
            kind: "section",
            id: sections[0]!.id,
            ...(issue.endsWith("catalogue mapping.") && { mapping: true }),
          }
        : { kind: "dish", id: dishMatches[0]!.id };
      editable.push({ text: issue, target });
    } else if (sections.length + dishMatches.length > 1) {
      // Names need not be unique. The overview lets the editor choose safely.
      editable.push({ text: issue, target: { kind: "menu" } });
    } else {
      other.push(issue);
    }
  }
  return { editable, other, authoritiesUnavailable };
}

export function assortmentProgress(
  total: number,
  expected: number,
  unit: string,
) {
  const label = unit.trim() || "items";
  if (!Number.isFinite(total) || !Number.isFinite(expected))
    return "Check the quantities for this box.";
  if (expected <= 0) return "Enter the expected total per box.";
  const difference = expected - total;
  const entered = total + " of " + expected + " " + label + " entered";
  if (difference > 0) return entered + " — " + difference + " remaining";
  if (difference < 0) return entered + " — " + Math.abs(difference) + " over";
  return entered;
}
