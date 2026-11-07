import type { LocalImportPreview } from "./contracts";
import { normaliseImportName } from "./import-preview";
import { findBeveragesByName } from "./repository";

export async function addLocalImportDuplicateWarnings(result: LocalImportPreview) {
  const names = new Set(result.candidates.map(candidate => normaliseImportName(candidate.recipe.name)).filter(Boolean));
  const duplicates = new Set(await Promise.all([...names].map(async name =>
    (await findBeveragesByName(name, 1)).length ? name : undefined,
  )));
  for (const candidate of result.candidates) {
    if (duplicates.has(normaliseImportName(candidate.recipe.name))) {
      candidate.warnings.push("Possible duplicate name in the local Beverage records. Check before saving.");
    }
  }
}
