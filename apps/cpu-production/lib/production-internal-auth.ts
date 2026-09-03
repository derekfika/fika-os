import type { NextRequest } from "next/server";

export function internalProductionRequestAllowed(request: Pick<NextRequest, "headers">, env: NodeJS.ProcessEnv = process.env) {
  const configured = env.FIKA_INTERNAL_API_TOKEN?.trim();
  if (!configured) return env.NODE_ENV !== "production" && env.FIKA_RUNTIME_MODE === "local";
  return request.headers.get("x-fika-internal-token") === configured;
}
