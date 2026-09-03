import { z } from "zod";
import type { ExternalProductionMaterialisation } from "@fika/server-shared/external-production";

const allergenSnapshot = z.object({
  allergens: z.record(z.string(), z.string()),
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
