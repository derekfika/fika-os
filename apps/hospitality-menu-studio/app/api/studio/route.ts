import type { NextRequest } from "next/server";
import { assertStudioRequestHost, authoriseStudioRequest, requireSameOrigin, studioSessionCookie } from "../../../lib/auth";
import { readStudioBookingImpact } from "../../../lib/booking-impact";
import { catalogueUnavailable, readStudioCatalogue } from "../../../lib/catalogue";
import { cpuDishReview } from "../../../lib/cpu-dish-review";
import { deliverStudioPublication } from "../../../lib/hub-publication";
import { studioHandlers } from "../../../lib/http";
import { assertStudioDraftCommand, localStudioSafetyAvailable, stagedStudioSafetyAvailable, studioRuntime } from "../../../lib/runtime";
import { studioStore } from "../../../lib/store";
import { studioRouteTrace } from "../../../lib/data-trace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = studioHandlers(async request => {
  const config = studioRuntime();
  assertStudioRequestHost(config, request.headers.get("host"));
  return authoriseStudioRequest(request, (request as NextRequest).cookies.get(config.name)?.value, config);
}, studioStore, requireSameOrigin, request => {
  const config = studioRuntime();
  const cookie = (request as NextRequest).cookies.get(config.name)?.value;
  if (!cookie || config.fixture) throw catalogueUnavailable();
  return readStudioCatalogue(config.hub, studioSessionCookie(config, cookie));
}, command => {
  const config = studioRuntime();
  if (config.mode === "staging") assertStudioDraftCommand(command.action, stagedStudioSafetyAvailable(), config.publicationPilot);
}, localStudioSafetyAvailable, (request, target) => {
  const config = studioRuntime();
  const cookie = (request as NextRequest).cookies.get(config.name)?.value;
  return cookie && !config.fixture ? readStudioBookingImpact(config.hub, studioSessionCookie(config, cookie), target)
    : Promise.resolve({ status: "unavailable" });
}, () => stagedStudioSafetyAvailable() ? cpuDishReview() : undefined, deliverStudioPublication);

export const GET = studioRouteTrace("/api/studio", handlers.GET);
export const POST = studioRouteTrace("/api/studio", handlers.POST);
