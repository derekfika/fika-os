import { z } from "zod";

const OPERATIONAL_ALLERGEN_STATES = ["clear", "contains", "may_contain", "unrecorded"] as const;

export type ExternalProductionMaterialisation = {
  sourceDomain: "grab-and-go" | "menu-planning";
  sourceEntityId: string;
  /** Menu Planning publication identity; retained across the CPU hand-off. */
  publicationId?: string;
  sourceVersion: number;
  sourceContentHash?: string;
  sourcePublicationDayId?: string;
  destinationOplocId: string;
  destinationLabel?: string;
  serviceDate: string;
  requiredBy?: string;
  serviceWindow?: { startTime: string; endTime?: string };
  status: "submitted" | "published" | "amended" | "cancelled" | "withdrawn";
  lines: Array<{
    sourceLineId: string;
    canonicalItemId?: string;
    itemName: string;
    quantity: number;
    unit: string;
    workstream?: "sandwiches" | "hospitality" | "delivered_in" | "grab_and_go" | "unassigned";
    approvedAllergenSnapshot?: {
      allergens: Record<string, string>;
      allergenEvidenceStatus?: "confirmed" | "unreviewed" | "missing" | "conflicting";
      mayContainNotes?: string;
      sourcePublicationDayId?: string;
      sourceVersion?: number;
      sourceContentHash?: string;
    };
  }>;
};

const allergenSnapshot = z.object({
  allergens: z.record(z.string(), z.enum(OPERATIONAL_ALLERGEN_STATES)),
  allergenEvidenceStatus: z.enum(["confirmed", "unreviewed", "missing", "conflicting"]).optional(),
  mayContainNotes: z.string().optional(),
  sourcePublicationDayId: z.string().optional(),
  sourceVersion: z.number().int().positive().optional(),
  sourceContentHash: z.string().optional(),
});

/** Runtime boundary for every external production publisher. */
export const externalProductionMaterialisationInput = z.object({
  sourceDomain: z.enum(["grab-and-go", "menu-planning"]),
  sourceEntityId: z.string().trim().min(1),
  publicationId: z.string().trim().min(1).optional(),
  sourceVersion: z.number().int().positive(),
  sourceContentHash: z.string().optional(),
  sourcePublicationDayId: z.string().optional(),
  destinationOplocId: z.string().trim().min(1),
  destinationLabel: z.string().optional(),
  serviceDate: z.string(),
  requiredBy: z.string().optional(),
  serviceWindow: z.object({ startTime: z.string(), endTime: z.string().optional() }).optional(),
  status: z.enum(["submitted", "published", "amended", "cancelled", "withdrawn"]),
  lines: z.array(z.object({
    sourceLineId: z.string().min(1),
    canonicalItemId: z.string().optional(),
    itemName: z.string().min(1),
    quantity: z.number().nonnegative(),
    unit: z.string().min(1),
    workstream: z.enum(["sandwiches", "hospitality", "delivered_in", "grab_and_go", "unassigned"]).optional(),
    approvedAllergenSnapshot: allergenSnapshot.optional(),
  })).min(1),
}).strict();

export function parseExternalProductionMaterialisation(value: unknown) {
  return externalProductionMaterialisationInput.parse(value) as ExternalProductionMaterialisation;
}
