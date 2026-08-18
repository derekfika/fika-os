import { readFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import { deterministicId, type MenuItem } from "./domain";
import { titleCase } from "./text";

// Brian's recipe documents are retained as evidence. This parser deliberately
// extracts wording and structure only; it never turns prose into allergen facts.
export type BrianRecipeCandidate = MenuItem & { sourcePath: string; sourceParagraphs: string[] };

function stableSourcePath(sourcePath: string): string {
  const normalised = sourcePath.replaceAll("\\", "/");
  const marker = "/REGIONAL MENUS 2026/";
  const markerIndex = normalised.toLowerCase().indexOf(marker.toLowerCase());
  return markerIndex >= 0 ? `regional/${normalised.slice(markerIndex + marker.length)}` : normalised;
}

function xmlText(xml: Uint8Array): string[] {
  const text = new TextDecoder().decode(xml);
  const paragraphs = [...text.matchAll(/<w:p[\s\S]*?<\/w:p>/g)].map(match => [...match[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(item => item[1]).join("").replace(/&amp;/g, "&").replace(/&#x2013;/g, "–").replace(/&#x2019;/g, "’").trim()).filter(Boolean);
  return paragraphs;
}

export function parseBrianRecipeDoc(buffer: Uint8Array, sourcePath: string, now = new Date().toISOString()): BrianRecipeCandidate {
  const files = fflateUnzip(buffer);
  const paragraphs = xmlText(files["word/document.xml"] || new Uint8Array());
  const title = paragraphs[0] || path.basename(sourcePath, ".docx");
  const ingredientsAt = paragraphs.findIndex(value => /^ingredients?$/i.test(value));
  const methodAt = paragraphs.findIndex(value => /^(method|preparation)$/i.test(value));
  const garnishAt = paragraphs.findIndex(value => /^garnish/i.test(value));
  const endIngredients = methodAt > ingredientsAt && methodAt >= 0 ? methodAt : paragraphs.length;
  const ingredientLines = ingredientsAt >= 0 ? paragraphs.slice(ingredientsAt + 1, endIngredients) : [];
  const methodEnd = garnishAt > methodAt && garnishAt >= 0 ? garnishAt : paragraphs.length;
  const methodSteps = methodAt >= 0 ? paragraphs.slice(methodAt + 1, methodEnd) : [];
  const yieldLine = paragraphs.find(value => /^yield\s*:/i.test(value));
  const description = paragraphs.slice(1, Math.max(1, ingredientsAt >= 0 ? ingredientsAt : Math.min(4, paragraphs.length))).join(" ") || undefined;
  const stablePath = stableSourcePath(sourcePath);
  const region = path.basename(path.dirname(stablePath)).toLowerCase() || "brian-recipe-import";
  const id = deterministicId("menu-item-brian", stablePath);
  const displayName = titleCase(title);
  return { canonicalId: id, sourceName: displayName, displayName, description, category: "delivered-in lunch", subcategory: region, recipeStatus: "draft", ingredients: ingredientLines.map(rawText => ({ name: rawText.replace(/:.*/, "").trim() || rawText, rawText })), yieldDescription: yieldLine?.replace(/^yield\s*:\s*/i, ""), methodSteps, preparationDescription: methodSteps.join(" ") || undefined, sourceEvidence: { document: stablePath, excerpt: paragraphs.slice(0, 8).join(" | "), importedAt: now }, weekId: "menu-week:brian-recipe-import", dayId: "", sourceReference: { workbook: "Brian regional recipe documents", sheet: region, rawValue: { sourcePath: stablePath, paragraphs } }, revision: 1, reviewStatus: "unreviewed", allergenEvidence: [], mayContainReviewed: false, audit: [{ action: "brian-recipe-candidate-created", at: now, by: "local-recipe-importer" }], sourcePath: stablePath, sourceParagraphs: paragraphs };
}

function fflateUnzip(buffer: Uint8Array): Record<string, Uint8Array> {
  // Kept behind one tiny adapter so the importer is easy to replace with a
  // server-side document service later.
  return unzipSync(buffer) as Record<string, Uint8Array>;
}

export async function importBrianRecipes(files: string[]): Promise<{ candidates: BrianRecipeCandidate[]; warnings: string[] }> {
  const candidates: BrianRecipeCandidate[] = [];
  for (const file of files) {
    try { candidates.push(parseBrianRecipeDoc(new Uint8Array(await readFile(file)), file)); }
    catch (error) { /* retain a visible warning rather than failing the pack */ }
  }
  return { candidates, warnings: candidates.length ? ["Allergen claims remain unreviewed until a chef verifies the supplied evidence."] : ["No readable Brian recipe documents were found."] };
}
