import type { NextRequest } from "next/server";
import { assertStudioRequestHost, authoriseStudio, requireSameOrigin, studioSessionCookie } from "../../../lib/auth";
import { catalogueUnavailable, readStudioCatalogue } from "../../../lib/catalogue";
import { studioHandlers } from "../../../lib/http";
import { studioRuntime } from "../../../lib/runtime";
import { studioStore } from "../../../lib/store";
import { StudioProblem } from "../../../lib/problem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = studioHandlers(async request => {
  const config = studioRuntime();
  assertStudioRequestHost(config, request.headers.get("host"));
  return authoriseStudio((request as NextRequest).cookies.get(config.name)?.value, config);
}, studioStore, request => {
  const config = studioRuntime();
  requireSameOrigin(request, config);
  if (!config.writes) throw new StudioProblem(403, "STUDIO_WRITE_DENIED", "Studio staging preview is read-only.");
}, request => {
  const config = studioRuntime();
  const cookie = (request as NextRequest).cookies.get(config.name)?.value;
  if (!cookie || config.mode !== "local" || config.fixture) throw catalogueUnavailable();
  return readStudioCatalogue(config.hub, studioSessionCookie(config, cookie));
});

export const GET = handlers.GET;
export const POST = handlers.POST;
