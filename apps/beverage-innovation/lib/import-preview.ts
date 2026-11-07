import { createHash } from "node:crypto";
import {
  MAX_PASTED_RECIPE_CANDIDATES,
  reviewedImportRecipeSchema,
  type LocalImportCandidate,
  type LocalImportPreview,
  type ReviewedImportRecipe,
} from "./contracts";

const MAX_SOURCE_LENGTH = 20_000;
export const PASTED_RECIPE_SOURCE_LABEL = "Pasted fictional text";
const ingredientUnits: Record<string, string> = {
  ml: "ml", g: "g", kg: "kg", each: "each", piece: "piece", pieces: "piece",
  dash: "dash", dashes: "dash", portion: "portion", portions: "portion",
};
const ingredientPattern = /^(\d+(?:\.\d{1,3})?)\s*(ml|g|kg|each|pieces?|dash(?:es)?|portions?)\s+(.+)$/i;
const fieldPattern = /^([a-z ]+):\s*(.*)$/i;
const ignoredFields = new Set(["allergen", "allergens", "dietary", "cost", "costs", "costing", "price", "selling price"]);

export function importFingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function normaliseImportName(name: string): string {
  return name.trim().toLocaleLowerCase("en-GB");
}

function sourceError(message: string, status: number, code: string) {
  return Object.assign(new Error(message), { status, code });
}

function splitRecipes(text: string): string[][] {
  const sections: string[][] = [];
  let lines: string[] = [];
  let sawNameLabel = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = /^-{3,}$/.test(line);
    const nameLabel = /^(?:[-*•]\s+)?(?:name|drink)\s*:/i.test(line);
    if (separator || (nameLabel && sawNameLabel)) {
      if (lines.length) sections.push(lines);
      lines = [];
      sawNameLabel = false;
    }
    if (!separator) lines.push(line);
    if (nameLabel) sawNameLabel = true;
  }
  if (lines.length) sections.push(lines);
  if (sections.length > MAX_PASTED_RECIPE_CANDIDATES) {
    throw sourceError(`Preview at most ${MAX_PASTED_RECIPE_CANDIDATES} drinks at a time.`, 413, "BEVERAGE_IMPORT_TOO_MANY_CANDIDATES");
  }
  return sections;
}

function parseRecipe(lines: string[]): Omit<LocalImportCandidate, "index" | "candidateHash"> {
  const recipe: ReviewedImportRecipe = {
    name: "", beverageType: "Unclassified", description: "", ingredients: [],
    method: "", glassware: "", garnish: "", equipment: [],
  };
  const warnings: string[] = [];
  let section: "ingredients" | "method" | "description" | "equipment" | "ignored" | undefined;
  let explicitName = false;
  let ignoredClaims = false;
  const addIngredient = (line: string) => {
    const match = ingredientPattern.exec(line);
    const amount = match ? Number(match[1]) : undefined;
    if (match && amount !== undefined && amount >= 0.001 && amount <= 1_000_000) {
      recipe.ingredients.push({ name: match[3].trim(), amount, unit: ingredientUnits[match[2].toLowerCase()] });
    } else {
      recipe.ingredients.push({ name: line });
      warnings.push(`Quantity and unit need human review for “${line.slice(0, 80)}”.`);
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/^[-*•]\s+/, "");
    if (!line) continue;
    const field = fieldPattern.exec(line);
    const key = field?.[1].trim().toLowerCase();
    const value = field?.[2].trim() || "";
    if (key === "name" || key === "drink") {
      recipe.name = value;
      explicitName = true;
      section = undefined;
    } else if (key === "type" || key === "glassware" || key === "garnish") {
      if (key === "type") recipe.beverageType = value || "Unclassified";
      else recipe[key] = value;
      section = undefined;
    } else if (key === "method" || key === "description") {
      recipe[key] = [recipe[key], value].filter(Boolean).join("\n");
      section = key;
    } else if (key === "ingredient" || key === "ingredients") {
      if (value) addIngredient(value);
      section = "ingredients";
    } else if (key === "equipment") {
      if (value) recipe.equipment.push(value);
      section = "equipment";
    } else if (key && ignoredFields.has(key)) {
      ignoredClaims = true;
      section = "ignored";
    } else if (section === "method" || section === "description") {
      recipe[section] = [recipe[section], line].filter(Boolean).join("\n");
    } else if (section === "equipment") {
      recipe.equipment.push(line);
    } else if (section === "ingredients" || (section !== "ignored" && ingredientPattern.test(line))) {
      addIngredient(line);
    } else if (!section && !key && !explicitName && !recipe.name) {
      recipe.name = line;
    } else if (!section && !key && !recipe.description) {
      recipe.description = line;
    }
  }

  if (!recipe.name) warnings.push("Drink name was not identified.");
  else if (!explicitName) warnings.push("The first unlabelled line was treated as the drink name. Check it against the source.");
  if (recipe.beverageType === "Unclassified") warnings.push("Type was not identified.");
  if (!recipe.ingredients.length) warnings.push("No ingredient lines were identified.");
  if (!recipe.method) warnings.push("Method was not identified.");
  if (!reviewedImportRecipeSchema.safeParse({ ...recipe, name: recipe.name || "Review required" }).success) {
    warnings.push("One or more fields exceed the draft limits. Review and shorten them before creating a draft.");
  }
  const confidence = !recipe.name || !recipe.ingredients.length ? "low" : warnings.length ? "medium" : "high";
  if (ignoredClaims) warnings.push("Cost, price, dietary and allergen statements were omitted from the candidate.");
  warnings.push("Review against the source before saving. This preview does not create a record or infer allergens or costs.");
  return { recipe, confidence, warnings };
}

export function previewPastedRecipes(text: string): LocalImportPreview {
  if (text.length > MAX_SOURCE_LENGTH) {
    throw sourceError(`Text preview is limited to ${MAX_SOURCE_LENGTH} characters.`, 413, "BEVERAGE_IMPORT_SOURCE_TOO_LARGE");
  }
  const source = text.replace(/\r\n?/g, "\n").trim();
  const sections = splitRecipes(source);
  if (!sections.length) throw sourceError("Paste fictional recipe text to preview.", 400, "BEVERAGE_IMPORT_SOURCE_REQUIRED");
  const sourceHash = importFingerprint(source);
  const candidates = sections.map((lines, index) => ({
    ...parseRecipe(lines),
    index,
    candidateHash: importFingerprint(JSON.stringify(["pasted-text-v1", sourceHash, index, lines])),
  }));
  const nameCounts = new Map<string, number>();
  for (const { recipe } of candidates) {
    const name = normaliseImportName(recipe.name);
    if (name) nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
  }
  for (const candidate of candidates) {
    if ((nameCounts.get(normaliseImportName(candidate.recipe.name)) || 0) > 1) {
      candidate.warnings.push("Possible duplicate name within the pasted source. Check that these are distinct drinks.");
    }
  }
  return { sourceHash, sourceLabel: PASTED_RECIPE_SOURCE_LABEL, candidates };
}

export function requirePastedRecipeCandidate(input: { text: string; sourceHash: string; candidateIndex: number; candidateHash: string }) {
  const preview = previewPastedRecipes(input.text);
  const candidate = preview.candidates[input.candidateIndex];
  if (preview.sourceHash !== input.sourceHash || !candidate || candidate.candidateHash !== input.candidateHash) {
    throw sourceError("The recipe source or selected candidate changed. Preview and review it again.", 409, "BEVERAGE_IMPORT_PREVIEW_CHANGED");
  }
  return { sourceHash: preview.sourceHash, candidate: { index: candidate.index, hash: candidate.candidateHash } };
}
