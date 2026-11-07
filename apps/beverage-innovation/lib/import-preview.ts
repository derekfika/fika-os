import { createHash } from "node:crypto";
import type { LocalImportCandidate } from "./contracts";

const MAX_SOURCE_LENGTH = 20_000;
const ingredientPattern = /^(\d+(?:\.\d{1,3})?)\s*(ml|mL|g|kg|each|piece|pieces|dash|dashes|portion|portions)\s+(.+)$/i;
const fields = new Set(["name", "drink", "type", "description", "ingredient", "ingredients", "method", "glassware", "garnish"]);

export type ImportClassification = LocalImportCandidate["classification"];

export function previewPastedRecipe(input: { text: string; classification: ImportClassification; existingNames?: string[] }): { candidate: LocalImportCandidate; sourceHash: string } {
  const text = input.text.replace(/\r\n?/g, "\n").trim();
  if (!text) throw Object.assign(new Error("Paste fictional recipe text to preview."), { status: 400, code: "BEVERAGE_IMPORT_SOURCE_REQUIRED" });
  if (text.length > MAX_SOURCE_LENGTH) throw Object.assign(new Error(`Text preview is limited to ${MAX_SOURCE_LENGTH} characters.`), { status: 413, code: "BEVERAGE_IMPORT_SOURCE_TOO_LARGE" });

  const candidate = { name: "", beverageType: "Unclassified", description: "", ingredients: [] as LocalImportCandidate["ingredients"], method: "", glassware: "", garnish: "", classification: input.classification, sourceLabel: "Pasted fictional text (preview only)", warnings: [] as string[] };
  const ingredients: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim().replace(/^[-*•]\s*/, "");
    if (!line) continue;
    const match = /^([a-z ]+):\s*(.*)$/i.exec(line);
    if (match && fields.has(match[1].trim().toLowerCase())) {
      const key = match[1].trim().toLowerCase(); const value = match[2].trim();
      if (key === "name" || key === "drink") candidate.name = value;
      else if (key === "type") candidate.beverageType = value || "Unclassified";
      else if (key === "description") candidate.description = value;
      else if (key === "method") candidate.method = value;
      else if (key === "glassware") candidate.glassware = value;
      else if (key === "garnish") candidate.garnish = value;
      else if (value) ingredients.push(value);
      continue;
    }
    if (!candidate.name) candidate.name = line;
    else if (ingredients.length || /\d/.test(line)) ingredients.push(line);
    else candidate.description ||= line;
  }

  for (const ingredient of ingredients.slice(0, 100)) {
    const match = ingredientPattern.exec(ingredient);
    if (match) {
      const units: Record<string, string> = { ml: "ml", g: "g", kg: "kg", each: "each", piece: "piece", pieces: "piece", dash: "dash", dashes: "dash", portion: "portion", portions: "portion" };
      candidate.ingredients.push({ amount: Number(match[1]), unit: units[match[2].toLowerCase()], name: match[3].trim() });
    }
    else {
      candidate.ingredients.push({ name: ingredient.replace(/^ingredient:\s*/i, "").trim() });
      candidate.warnings.push(`Quantity and unit need human review for “${ingredient.slice(0, 80)}”.`);
    }
  }
  if (!candidate.name) candidate.warnings.push("Drink name was not identified.");
  if (candidate.beverageType === "Unclassified") candidate.warnings.push("Type was not identified.");
  if (!candidate.ingredients.length) candidate.warnings.push("No ingredient lines were identified.");
  if (!candidate.method) candidate.warnings.push("Method was not identified.");
  if (input.existingNames?.some(name => name.trim().toLocaleLowerCase("en-GB") === candidate.name.trim().toLocaleLowerCase("en-GB"))) candidate.warnings.push("Possible duplicate name found. Confirm source and provenance before creating a record.");
  candidate.warnings.push("This is a preview only. Allergens and costs are not inferred; no beverage record was created.");
  return { candidate, sourceHash: createHash("sha256").update(text, "utf8").digest("hex") };
}
