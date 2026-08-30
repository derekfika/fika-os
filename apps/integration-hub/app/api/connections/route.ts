import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import {
  connectionsOverview,
  saveConnectionCommand,
  type ConnectionCommand,
} from "@/lib/connections-service";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

const EmploymentCommand = z
  .object({
    action: z.literal("save-employment-connection"),
    canonicalId: z.string().min(8).max(160).optional(),
    expectedVersion: z.number().int().positive().optional(),
    legendId: z.string().min(8).max(160),
    employmentState: z.string().trim().min(1).max(120),
    startDate: z.iso.date().optional(),
    terminationDate: z.iso.date().optional(),
    contractualJobTitle: z.string().trim().max(160).optional(),
    contractHours: z.number().nonnegative().optional(),
  })
  .strict();
const HospitalityMenuRoutingCommand = z.object({
  action: z.literal("save-hospitality-menu-production-routing"),
  menuItemId: z.string().min(8).max(160),
  workstreams: z.array(z.enum(["sandwiches", "hospitality", "delivered_in"])).max(3),
}).strict();
const HospitalityMenuMergeCommand = z.object({
  action: z.literal("merge-hospitality-menu-items"),
  sourceMenuItemId: z.string().min(8).max(160),
  survivorMenuItemId: z.string().min(8).max(160),
}).strict();
const AssignmentCommand = z
  .object({
    action: z.literal("save-operational-assignment"),
    canonicalId: z.string().min(8).max(160).optional(),
    expectedVersion: z.number().int().positive().optional(),
    legendId: z.string().min(8).max(160),
    oplocId: z.string().min(8).max(160),
    assignmentRole: z.string().trim().min(1).max(160),
    designation: z.enum(["primary", "secondary"]),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().optional(),
    lifecycleState: z.enum(["active", "ended", "archived"]).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.effectiveTo && value.effectiveTo < value.effectiveFrom)
      context.addIssue({
        code: "custom",
        path: ["effectiveTo"],
        message: "Effective until cannot be before effective from.",
      });
  });
const StaffingRoleCommand = z
  .object({
    action: z.literal("save-staffing-role"),
    canonicalId: z.string().min(8).max(160).optional(),
    expectedVersion: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().max(1000).optional(),
    active: z.boolean(),
  })
  .strict();
const StaffingRequirementCommand = z
  .object({
    action: z.literal("save-site-staffing-requirement"),
    canonicalId: z.string().min(8).max(160).optional(),
    expectedVersion: z.number().int().positive().optional(),
    oplocId: z.string().min(8).max(160),
    staffingRoleId: z.string().min(8).max(160),
    requiredHeadcount: z.number().int().positive(),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.effectiveTo && value.effectiveTo < value.effectiveFrom)
      context.addIssue({
        code: "custom",
        path: ["effectiveTo"],
        message: "Effective until cannot be before effective from.",
      });
  });
const SiteRoleAssignmentCommand = z
  .object({
    action: z.literal("save-site-role-assignment"),
    canonicalId: z.string().min(8).max(160).optional(),
    expectedVersion: z.number().int().positive().optional(),
    legendId: z.string().min(8).max(160),
    oplocId: z.string().min(8).max(160),
    staffingRoleId: z.string().min(8).max(160),
    effectiveFrom: z.iso.date(),
    effectiveTo: z.iso.date().optional(),
    primaryLocation: z.boolean(),
    lifecycleState: z.enum(["active", "ended"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.effectiveTo && value.effectiveTo < value.effectiveFrom)
      context.addIssue({
        code: "custom",
        path: ["effectiveTo"],
        message: "Effective until cannot be before effective from.",
      });
  });
const RemoveAssignmentCommand = z
  .object({
    action: z.literal("remove-site-role-assignment"),
    canonicalId: z.string().min(8).max(160),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
const Command = z.discriminatedUnion("action", [
  HospitalityMenuMergeCommand,
  HospitalityMenuRoutingCommand,
  EmploymentCommand,
  AssignmentCommand,
  StaffingRoleCommand,
  StaffingRequirementCommand,
  SiteRoleAssignmentCommand,
  RemoveAssignmentCommand,
]);

async function handleGet(req: NextRequest) {
  try {
    const actor = await requireActor(req);
    assertPermission(actor, "canonical.view");
    return NextResponse.json(await connectionsOverview(), noStore());
  } catch (error) {
    return errorResponse(error);
  }
}

async function handlePost(req: NextRequest) {
  try {
    const actor = await requireActor(req, ["integration-admin"]);
    const command = Command.parse(await req.json()) as ConnectionCommand;
    return NextResponse.json(
      await saveConnectionCommand(actor, command),
      noStore(),
    );
  } catch (error) {
    return errorResponse(error);
  }
}
export async function GET(req: NextRequest) { return withDataTrace({ app: "integration-hub", action: "integration-hub.connections.load", path: req.nextUrl.pathname, requestId: req.headers.get("x-request-id") || undefined }, () => handleGet(req)); }
export async function POST(req: NextRequest) { return withDataTrace({ app: "integration-hub", action: "integration-hub.connections.mutation", path: req.nextUrl.pathname, requestId: req.headers.get("x-request-id") || undefined }, () => handlePost(req)); }

function noStore() {
  return { headers: { "Cache-Control": "no-store, max-age=0" } };
}
