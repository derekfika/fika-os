import type { NextRequest } from "next/server";
import { assertLocalPreviewHost, authoriseStudio, requireSameOrigin } from "../../../lib/auth";
import { studioHandlers } from "../../../lib/http";
import { studioRuntime } from "../../../lib/runtime";
import { studioStore } from "../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = studioHandlers(async request => {
  const config = studioRuntime();
  assertLocalPreviewHost(config, request.headers.get("host"));
  return authoriseStudio((request as NextRequest).cookies.get(config.name)?.value, config);
}, studioStore, requireSameOrigin);

export const GET = handlers.GET;
export const POST = handlers.POST;
