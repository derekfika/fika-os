import type { NextRequest } from "next/server";
import { assertStudioRequestHost, authoriseStudio, requireSameOrigin, studioSessionCookie } from "../../../lib/auth";
import { catalogueUnavailable, readStudioCatalogue } from "../../../lib/catalogue";
import { studioHandlers } from "../../../lib/http";
import { assertStudioDraftCommand, localStudioSafetyAvailable, studioRuntime } from "../../../lib/runtime";
import { studioStore } from "../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = studioHandlers(async request => {
  const config = studioRuntime();
  assertStudioRequestHost(config, request.headers.get("host"));
  return authoriseStudio((request as NextRequest).cookies.get(config.name)?.value, config);
}, studioStore, requireSameOrigin, request => {
  const config = studioRuntime();
  const cookie = (request as NextRequest).cookies.get(config.name)?.value;
  if (!cookie || config.fixture) throw catalogueUnavailable();
  return readStudioCatalogue(config.hub, studioSessionCookie(config, cookie));
}, command => {
  if (studioRuntime().mode === "staging") assertStudioDraftCommand(command.action);
}, localStudioSafetyAvailable);

export const GET = handlers.GET;
export const POST = handlers.POST;
