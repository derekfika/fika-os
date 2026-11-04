import { assertOneOffMenuDestination, type MenuDestination } from "./menu-destination";
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
  /** Legacy routing-key field: an explicit one-off snapshot uses its day-scoped ID, never a Hub OPLOC record. */
  destinationOplocId: string;
  destination?: MenuDestination;
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
      allergenReview?: { status: "confirmed"; semantics: 2 | 3; confirmedBy: string; confirmedAt: string; statement: "recipe-ingredients-allergens-verified"; inputFingerprint: string };
      noKeyDeclaration?: { declared: true; declaredBy: string; declaredAt: string };
      allergenEvidenceStatus?: "confirmed" | "unreviewed" | "missing" | "conflicting";
      mayContainNotes?: string; allergenDetailNotes?: string;
      sourcePublicationDayId?: string;
      sourceVersion?: number;
      sourceContentHash?: string;
    };
  }>;
};

export type SourceAllergenSnapshot = NonNullable<ExternalProductionMaterialisation["lines"][number]["approvedAllergenSnapshot"]>;

export const approvedAllergenSnapshotSchema = z.object({
  allergens: z.record(z.string(), z.enum(OPERATIONAL_ALLERGEN_STATES)),
  allergenEvidenceStatus: z.enum(["confirmed", "unreviewed", "missing", "conflicting"]).optional(),
  mayContainNotes: z.string().optional(),
  allergenDetailNotes: z.string().optional(),
  allergenReview: z.object({ status: z.literal("confirmed"), semantics: z.union([z.literal(2), z.literal(3)]), confirmedBy: z.string().min(1), confirmedAt: z.string().min(1), statement: z.literal("recipe-ingredients-allergens-verified"), inputFingerprint: z.string().min(1) }).optional(),
  noKeyDeclaration: z.object({ declared: z.literal(true), declaredBy: z.string().min(1), declaredAt: z.string().min(1) }).optional(),
  sourcePublicationDayId: z.string().optional(),
  sourceVersion: z.number().int().positive().optional(),
  sourceContentHash: z.string().optional(),
}).superRefine((snapshot, context) => {
  if (snapshot.allergens.no_key_allergens === "contains" && Object.entries(snapshot.allergens).some(([key, state]) => key !== "no_key_allergens" && (state === "contains" || state === "may_contain"))) context.addIssue({ code: "custom", message: "No Key Allergens cannot coexist with named allergen declarations.", path: ["allergens"] });
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
  destination: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("governed"), id: z.string().min(1), label: z.string().min(1) }).strict(),
    z.object({ kind: z.literal("one-off"), id: z.string().min(1), sourceDayId: z.string().min(1), label: z.string().trim().min(1), address: z.string().trim().min(1), contact: z.string().optional(), deliveryInstructions: z.string().optional() }).strict(),
  ]).optional(),
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
    approvedAllergenSnapshot: approvedAllergenSnapshotSchema.optional(),
  })).min(1),
}).strict();

export function parseExternalProductionMaterialisation(value: unknown) {
  const input = externalProductionMaterialisationInput.parse(value) as ExternalProductionMaterialisation;
  if (input.destination && input.destination.id !== input.destinationOplocId) throw Object.assign(new Error("The materialisation destination snapshot and routing identity differ."), { status: 422 });
  if (input.destination?.kind === "one-off") {
    if (input.sourceDomain !== "menu-planning") throw new Error("This source cannot publish a Menu one-off destination.");
    assertOneOffMenuDestination(input.destination, input.sourceEntityId);
  }
  return input;
}
