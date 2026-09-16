import { z } from "zod";
import { OPERATIONAL_ALLERGEN_STATES } from "../../shared/allergen-contract";

export const SubItem = z.object({ id: z.string().min(1), productionItemId: z.string().min(1).optional(), name: z.string(), quantity: z.number().positive().nullable(), allergens: z.record(z.string(), z.enum(OPERATIONAL_ALLERGEN_STATES)), mayContainNotes: z.string().optional(), note: z.string(), evidenceStatus: z.enum(["not_completed", "completed", "requires_review"]) });
export const MenuItem = z.object({ id: z.string().min(1), sourceLineId: z.string().optional(), name: z.string(), note: z.string(), subItems: z.array(SubItem) });
export const ExpectedLineage = z.object({ productionOrderId: z.string(), serviceDate: z.string(), sourceDayId: z.string(), sourcePublicationId: z.string().optional(), sourcePublicationDayId: z.string(), sourceVersion: z.number().int().positive(), sourceContentHash: z.string().length(64), matrixContentHash: z.string().length(64) });
export const MasterReviewOperation = z.object({ action: z.literal("mark-planned"), orderId: z.string(), menuItems: z.array(MenuItem).min(1), planningNotes: z.string().default("") }).strict();
export const MasterSignCommand = z.object({
  action: z.literal("sign-master-matrix"),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  role: z.enum(["production_chef", "head_chef_site_manager"]),
  printedName: z.string().trim().min(2).max(120),
  attestation: z.string().trim().min(10).max(500),
  signatureDataUrl: z.string().regex(/^data:image\/png;base64,/).max(500000),
  orderIds: z.array(z.string().min(1)).min(1).max(100),
  expectedLineages: z.array(ExpectedLineage).min(1).max(100),
  reviewOperations: z.array(MasterReviewOperation).min(1).max(100),
  commandId: z.string().trim().min(8),
}).strict();
