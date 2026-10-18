import { z } from "zod";

/** Statuses CPU Production drives through the Hub transition API. The domain transition table (production-domain.ts) remains the authority on which moves are legal. */
export const Transition = z.object({ action: z.literal("transition"), canonicalId: z.string().min(8), expectedVersion: z.number().int().positive(), status: z.enum(["draft", "needs_review", "accepted", "planning", "planned", "rejected", "needs_clarification", "scheduled", "in_production", "partially_complete", "complete", "cancelled", "blocked", "failed", "reconciliation_required"]), reason: z.string().trim().min(3).max(1000) }).strict();
