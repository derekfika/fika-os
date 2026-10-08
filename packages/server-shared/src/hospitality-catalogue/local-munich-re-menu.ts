import type { HospitalityMenuCatalogue } from "./hospitality-menu-catalogue";
import { localCfcMenuCatalogue } from "./local-cfc-menu";

/**
 * Deterministic development conversion of the generic Fika hospitality
 * brochure. The brochure is shared menu evidence for Munich Re for now; it is
 * deliberately not treated as Munich Re branding or as structured allergen
 * evidence.
 */
const items = localCfcMenuCatalogue.items.map((item) => ({
  ...item,
  canonicalId: item.canonicalId.replace("hospitality-menu-item:cfc:", "hospitality-menu-item:munich-re:"),
  source: {
    ...item.source,
    provider: "munich-re-generic-brochure",
    sourcePath: "Fika Hospitality Brochure_2026.pptx",
  },
  description: "Published from the generic Fika hospitality brochure; confirm availability and dietary detail during review.",
}));

export const localMunichReMenuCatalogue: HospitalityMenuCatalogue = {
  schemaVersion: "fika.hospitality-menu-catalogue.v1",
  generatedAt: "2026-08-05T00:00:00.000Z",
  source: { path: "Fika Hospitality Brochure_2026.pptx", itemCount: items.length },
  categories: [...new Set(items.map((item) => item.category))].map((name) => ({
    canonicalId: `hospitality-menu-category:munich-re:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
  })),
  items,
  validationReport: {
    sourceItemCount: items.length,
    generatedItemCount: items.length,
    missingCanonicalFields: [
      { field: "dietaryInformation", reason: "Not supplied as structured data by the brochure source" },
      { field: "allergenInformation", reason: "Not supplied as structured data by the brochure source" },
    ],
  },
};
