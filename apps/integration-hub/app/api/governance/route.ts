import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/lib/api";
import { requireActor } from "@/lib/auth";
import { assertPermission } from "@/lib/authmod";
import {
  governanceOverview,
  recordCompletenessDecision,
  recordSourceMapping,
  resolveLegacyLifecycle,
  transitionCanonicalLifecycle,
} from "@/lib/governance-repository";

const Command = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("completeness-decision"),
      fieldId: z.string(),
      classification: z.enum([
        "mapped-now",
        "retained-not-mapped",
        "deliberately-excluded",
        "restricted-sensitive",
        "unavailable-from-provider",
        "unknown-investigation",
      ]),
      decisionReason: z.string().trim().max(1000).default(""),
    })
    .strict(),
  z
    .object({
      action: z.literal("source-mapping"),
      sourceProvider: z.string(),
      sourceEntityType: z.string(),
      sourceIdentifier: z.string(),
      sourceLabel: z.string().optional(),
      oplocId: z.string().optional(),
      targetCanonicalId: z.string().optional(),
      mappingStatus: z.enum([
        "unresolved",
        "confirmed",
        "rejected",
        "deferred",
        "historical",
        "irrelevant",
      ]),
      decisionReason: z.string().trim().max(1000).default(""),
    })
    .strict(),
  z
    .object({
      action: z.literal("lifecycle"),
      canonicalId: z.string(),
      expectedVersion: z.number().int().positive(),
      target: z.enum(["draft", "needs-review", "published", "archived"]),
      reason: z.string().trim().max(1000).default(""),
    })
    .strict(),
  z.object({ action: z.literal("resolve-legacy-lifecycle") }).strict(),
]);

export async function GET(req: NextRequest) {
  try {
    const actor = await requireActor(req);
    assertPermission(actor, "canonical.view");
    return NextResponse.json(await governanceOverview(), noStore());
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(req: NextRequest) {
  try {
    const actor = await requireActor(req);
    const command = Command.parse(await req.json());
    let mutation: { record: unknown } | undefined;
    if (command.action === "completeness-decision") {
      assertPermission(actor, "canonical.edit");
      await recordCompletenessDecision(actor, command);
    }
    if (command.action === "source-mapping") {
      assertPermission(actor, "canonical.edit");
      if (
        command.mappingStatus === "confirmed" &&
        command.sourceEntityType.includes("location")
      )
        assertPermission(actor, "oploc.approve-identity");
      await recordSourceMapping(actor, command);
    }
    if (command.action === "lifecycle") {
      assertPermission(
        actor,
        command.target === "published"
          ? "canonical.publish"
          : "canonical.lifecycle",
      );
      mutation = { record: await transitionCanonicalLifecycle(actor, command) };
    }
    let resolution:
      | Awaited<ReturnType<typeof resolveLegacyLifecycle>>
      | undefined;
    if (command.action === "resolve-legacy-lifecycle") {
      assertPermission(actor, "canonical.publish");
      resolution = await resolveLegacyLifecycle(actor);
    }
    return NextResponse.json(
      {
        ...(await governanceOverview()),
        ...(mutation ? { mutation } : {}),
        ...(resolution ? { resolution } : {}),
      },
      noStore(),
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function noStore() {
  return { headers: { "Cache-Control": "no-store, max-age=0" } };
}
