import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import {
  assertPermission,
  permissionsForRole,
  type CanonicalPermission,
} from "@/lib/authmod";
import {
  editableEntityType,
  type CanonicalEditorInput,
  type EditableEntityType,
} from "@/lib/canonical-editor";
import {
  approveAddress,
  assessExistingAddressPublication,
  canonicalEditorContext,
  previewCanonicalChange,
  previewLegacySiteDecision,
  publishValidExistingAddresses,
  saveCanonicalChange,
  saveLegacySiteDecision,
} from "@/lib/canonical-record-service";

const Change = z
  .object({
    action: z.enum(["preview", "save"]),
    entityType: z
      .string()
      .refine(editableEntityType, "Unsupported canonical entity type."),
    canonicalId: z.string().trim().min(8).max(160),
    expectedVersion: z.number().int().nonnegative().optional(),
    values: z.record(z.string(), z.unknown()),
    decisionReason: z.string().trim().max(1000).default(""),
    legacySourceCanonicalId: z.string().trim().min(8).max(160).optional(),
    allowDistinctDuplicate: z.boolean().optional(),
    inlineAddress: z
      .object({
        canonicalId: z.string().trim().min(8).max(160),
        expectedVersion: z.number().int().nonnegative().optional(),
        values: z.record(z.string(), z.unknown()),
        decisionReason: z.string().trim().max(1000).default(""),
        allowDistinctDuplicate: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const LegacyDecision = z
  .object({
    action: z.enum(["preview-legacy-decision", "save-legacy-decision"]),
    legacySourceCanonicalId: z.string().trim().min(8).max(160),
    oplocId: z.string().trim().min(8).max(160).optional(),
    mappingStatus: z.enum(["confirmed", "rejected", "deferred", "unresolved"]),
    decisionReason: z.string().trim().max(1000).default(""),
  })
  .strict();
const AddressApproval = z
  .object({
    action: z.literal("approve-address"),
    canonicalId: z.string().trim().min(8).max(160),
    expectedVersion: z.number().int().positive(),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();

export async function GET(req: NextRequest) {
  try {
    const actor = await requireActor(req);
    assertPermission(actor, "canonical.view");
    return NextResponse.json(
      {
        ...(await canonicalEditorContext()),
        permissions: permissionsForRole(actor.role),
      },
      noStore(),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireActor(req);
    const body = await req.json();
    if (body?.action === "assess-address-publication") {
      assertPermission(actor, "address.view");
      return NextResponse.json(
        await assessExistingAddressPublication(),
        noStore(),
      );
    }
    if (body?.action === "publish-valid-addresses") {
      assertPermission(actor, "address.publish");
      return NextResponse.json(
        await publishValidExistingAddresses(actor),
        noStore(),
      );
    }
    if (body?.action === "approve-address")
      return NextResponse.json(
        await approveAddress(actor, AddressApproval.parse(body)),
        noStore(),
      );
    if (
      body?.action === "preview-legacy-decision" ||
      body?.action === "save-legacy-decision"
    ) {
      const command = LegacyDecision.parse(body);
      assertPermission(
        actor,
        command.action === "save-legacy-decision"
          ? "oploc.approve-identity"
          : "canonical.edit",
      );
      const result =
        command.action === "save-legacy-decision"
          ? await saveLegacySiteDecision(actor, command)
          : await previewLegacySiteDecision(command);
      return NextResponse.json(result, noStore());
    }
    const command = Change.parse(body) as CanonicalEditorInput & {
      action: "preview" | "save";
    };
    assertPermission(
      actor,
      command.expectedVersion ? "canonical.edit" : "canonical.create",
    );
    if (command.action === "save") {
      if (command.entityType !== "Address")
        assertPermission(actor, approvalPermission(command.entityType));
      if (command.entityType === "OPLOC")
        assertPermission(actor, "oploc.approve-location-type");
    }
    const result =
      command.action === "save"
        ? await saveCanonicalChange(actor, command)
        : await previewCanonicalChange(actor, command);
    return NextResponse.json(result, noStore());
  } catch (error) {
    return errorResponse(error);
  }
}

function noStore() {
  return { headers: { "Cache-Control": "no-store, max-age=0" } };
}

function approvalPermission(
  entityType: EditableEntityType,
): CanonicalPermission {
  if (entityType === "OPLOC") return "oploc.approve-identity";
  if (entityType === "Address") return "address.approve";
  if (entityType === "Legend") return "legend.approve";
  if (entityType === "Employment") return "employment.manage";
  if (entityType === "Operational Assignment")
    return "operational-assignment.approve";
  if (entityType === "Operational Capability")
    return "operational-capability.approve-catalogue";
  return "operational-capability.approve-enablement";
}
