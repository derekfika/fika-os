import { reviewedImportRecipeSchema, type LocalDocumentImportPreview, type LocalImportCandidate, type LocalImportPreview, type ReviewedImportRecipe } from "../../lib/contracts";
import type { BeverageClassification } from "../../lib/domain";

export type ReviewForm = Omit<ReviewedImportRecipe, "ingredients" | "equipment"> & {
  ingredients: { name: string; amount: string; unit: string }[];
  equipmentText: string;
  classification: BeverageClassification | "";
};

export type ReviewSource = { kind: "text"; text: string } | { kind: "document"; file: File };
export type ReviewSession = {
  source: ReviewSource;
  preview: LocalImportPreview | LocalDocumentImportPreview;
  forms: ReviewForm[];
  saved: number[];
};

export type PendingImport = { key: string; body: string; candidateIndex: number; source: ReviewSource };
export type ReviewedNameCheck = { normalizedName: string; duplicate: boolean };
export const normalizeReviewedName = (name: string) => name.trim().toLocaleLowerCase("en-GB");

export function initialReview(candidate: LocalImportCandidate): ReviewForm {
  const { equipment, ingredients, ...fields } = candidate.recipe;
  return { ...fields, equipmentText: equipment.join("\n"), classification: "", ingredients: ingredients.map(line => ({ name: line.name, amount: line.amount === undefined ? "" : String(line.amount), unit: line.unit || "" })) };
}

export function reviewCompleteness(form: ReviewForm): string[] {
  const issues: string[] = [];
  if (!form.name.trim()) issues.push("Drink name needs review.");
  if (!form.beverageType.trim() || form.beverageType === "Unclassified") issues.push("Drink type needs review.");
  if (!form.ingredients.length) issues.push("No ingredients are listed.");
  if (form.ingredients.some(line => !line.name.trim() || !line.amount.trim() || !line.unit.trim())) issues.push("Some ingredients need a name, quantity or unit.");
  if (!form.method.trim()) issues.push("Preparation method is missing.");
  return issues;
}

export function prepareImport(session: ReviewSession, selection: number, confirmed: boolean, key: string, nameCheck?: ReviewedNameCheck): { pending?: PendingImport; error?: string } {
  const candidate = session.preview.candidates[selection];
  const form = session.forms[selection];
  if (!candidate || !form || session.saved.includes(candidate.index)) return { error: "Select an unsaved candidate to review." };
  if (!confirmed) return { error: "Confirm that you have reviewed the selected recipe against its source." };
  if (!form.classification) return { error: "Choose whether this source is a classic, a FIKA original or a draft concept." };
  const reviewedName = normalizeReviewedName(form.name);
  if (reviewedName !== normalizeReviewedName(candidate.recipe.name) && (!nameCheck || nameCheck.normalizedName !== reviewedName)) return { error: "Check the edited name for a local duplicate before creating a draft." };
  if (form.ingredients.some(line => line.amount.trim() && !/^\d+(?:\.\d{1,3})?$/.test(line.amount.trim()))) return { error: "Use a positive quantity with up to three decimal places, or leave it blank." };
  const result = reviewedImportRecipeSchema.safeParse({
    name: form.name, beverageType: form.beverageType, description: form.description,
    method: form.method, glassware: form.glassware, garnish: form.garnish,
    equipment: form.equipmentText.split(/\r?\n/).map(item => item.trim()).filter(Boolean),
    ingredients: form.ingredients.map(line => ({ name: line.name, ...(line.amount.trim() ? { amount: Number(line.amount) } : {}), ...(line.unit.trim() ? { unit: line.unit } : {}) })),
  });
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue.path.map(part => typeof part === "number" ? String(part + 1) : String(part)).join(" ");
    return { error: `${field || "Recipe"}: ${issue.message}` };
  }
  const review = { sourceHash: session.preview.sourceHash, candidateIndex: candidate.index, candidateHash: candidate.candidateHash, classification: form.classification, reviewed: true, reviewedCandidate: result.data };
  const body = session.source.kind === "text" ? { text: session.source.text, ...review } : review;
  return { pending: { key, candidateIndex: candidate.index, body: JSON.stringify(body), source: session.source } };
}
