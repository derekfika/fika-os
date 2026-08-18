import type { CanonicalEntityType } from "./schemas";

export const DeferredImportEntityTypes: CanonicalEntityType[] = ["Till Item", "Till Item Variation"];

export function isImportDeferred(entityType: string) {
  return DeferredImportEntityTypes.includes(entityType as CanonicalEntityType);
}
