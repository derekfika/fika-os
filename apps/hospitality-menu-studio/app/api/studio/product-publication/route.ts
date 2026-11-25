import type { NextRequest } from "next/server";
import { z } from "zod";
import { dateSchema, idSchema, revisionSchema } from "../../../../../shared/hospitality-menu-studio-content";
import { publicationDigest } from "../../../../../shared/hospitality-menu-studio-publication";
import { studioProductMenuId } from "../../../../../shared/hospitality-menu-studio-product-publication";
import { assertStudioRequestHost, authoriseStudio, requireSameOrigin, studioSessionCookie } from "../../../../lib/auth";
import { readStudioCatalogue } from "../../../../lib/catalogue";
import { cpuDishReview } from "../../../../lib/cpu-dish-review";
import { deliverStudioPublication } from "../../../../lib/hub-publication";
import { StudioProblem } from "../../../../lib/problem";
import { studioRuntime } from "../../../../lib/runtime";
import { studioStore } from "../../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestFields = { itemId: idSchema, version: revisionSchema, effectiveDate: dateSchema };
const publicationCommand = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("review"), ...requestFields }),
  z.strictObject({ action: z.literal("publish"), ...requestFields, reviewToken: publicationDigest, confirmed: z.literal(true) }),
]);
const headers = { "Cache-Control": "private, no-store" };
const maximumBytes = 4_096;

export async function POST(request: NextRequest) {
  try {
    const config = studioRuntime();
    assertStudioRequestHost(config, request.headers.get("host"));
    requireSameOrigin(request, config);
    const cookie = request.cookies.get(config.name)?.value;
    const actor = await authoriseStudio(cookie, config);
    if (config.mode !== "staging" || !config.publicationPilot || !cookie || !actor.canPublish) throw denied();
    const command = publicationCommand.parse(await readJson(request));
    const pilot = actor.publicationPilot;
    if (pilot?.menuId !== studioProductMenuId(command.itemId) ||
        command.effectiveDate < pilot.firstDate || command.effectiveDate > pilot.lastDate) throw denied();

    const db = studioStore(config);
    const catalogue = await readStudioCatalogue(config.hub, studioSessionCookie(config, cookie));
    const safety = cpuDishReview().evidence;
    const signingKey = await db.publicationSigningKey(command.action === "review");
    const evidence = { actor, catalogue, signingKey, safety };
    const publications = db.productPublications();
    if (command.action === "review") return Response.json(await publications.review(command, evidence), { headers });
    const { action: _action, ...input } = command;
    const publication = await publications.publish(input, evidence, ({ manifest, body }) => deliverStudioPublication(manifest, body));
    return Response.json({ publication }, { headers });
  } catch (error) {
    const problem = error instanceof StudioProblem ? error
      : error instanceof z.ZodError || error instanceof SyntaxError ? new StudioProblem(422, "INVALID_REQUEST", "Check the product, date and revision.")
      : new StudioProblem(503, "PRODUCT_PUBLICATION_UNAVAILABLE", "Product publication could not be verified.");
    return Response.json({ code: problem.code, error: problem.message }, { status: problem.status, headers });
  }
}

function denied() {
  return new StudioProblem(403, "PRODUCT_PUBLICATION_SCOPE_DENIED", "This product and date are outside your approved publication scope.");
}

async function readJson(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new StudioProblem(415, "INVALID_CONTENT_TYPE", "Studio requires a JSON request.");
  }
  const tooLarge = () => new StudioProblem(413, "INVALID_REQUEST", "The product publication request exceeds its size limit.");
  if (Number(request.headers.get("content-length")) > maximumBytes) throw tooLarge();
  if (!request.body) throw new StudioProblem(422, "INVALID_REQUEST", "The publication request could not be read.");
  const reader = request.body.getReader();
  const bytes = new Uint8Array(maximumBytes);
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (length + value.byteLength > maximumBytes) throw tooLarge();
      bytes.set(value, length);
      length += value.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8").decode(bytes.subarray(0, length))) as unknown;
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
