import type { HospitalityMenuCatalogue, HospitalityMenuItem } from "./hospitality-menu-catalogue";
import { localCfcMenuCatalogue } from "./local-cfc-menu";
import { MUNICH_RE_FORM_SOURCE_PATH, MUNICH_RE_PROVIDER, munichReFormItems } from "./munich-re-form-catalogue";

/**
 * Munich RE serves the products on its live Hospitality Booking Form (see munich-re-form-catalogue.ts). The earlier
 * development conversion of the generic Fika brochure (a copy of the CFC rows) is kept as ARCHIVED history only: it is
 * never served or accepted for new bookings, but is not deleted, so its ids stay resolvable as retired.
 */
const legacyBrochureItems: HospitalityMenuItem[] = localCfcMenuCatalogue.items.map((item) => ({
  ...item,
  canonicalId: item.canonicalId.replace("hospitality-menu-item:cfc:", "hospitality-menu-item:munich-re:"),
  source: { ...item.source, provider: MUNICH_RE_PROVIDER, sourcePath: "Fika Hospitality Brochure_2026.pptx" },
  description: "Retired: development conversion of the generic Fika brochure, superseded by the Munich RE booking form.",
  lifecycleState: "archived" as const,
  sortOrder: 1000 + item.sortOrder,
}));

const items: HospitalityMenuItem[] = [...munichReFormItems, ...legacyBrochureItems];

export const localMunichReMenuCatalogue: HospitalityMenuCatalogue = {
  schemaVersion: "fika.hospitality-menu-catalogue.v1",
  generatedAt: "2026-10-29T00:00:00.000Z",
  source: { path: MUNICH_RE_FORM_SOURCE_PATH, itemCount: items.length },
  categories: [...new Set(munichReFormItems.map((item) => item.category))].map((name) => ({
    canonicalId: `hospitality-menu-category:munich-re:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
  })),
  items,
  validationReport: {
    sourceItemCount: munichReFormItems.length,
    generatedItemCount: items.length,
    missingCanonicalFields: [
      { field: "dietaryInformation", reason: "Not supplied as structured data by the booking form" },
      { field: "allergenInformation", reason: "Not supplied as structured data by the booking form; unrecorded, never clear" },
      { field: "vatRate", reason: "The booking form states no VAT treatment" },
    ],
  },
};
