import type { NextRequest } from "next/server";
import { internalTokenAllowed } from "../../shared/internal-auth";

export function internalCpuRequestAllowed(
  request: Pick<NextRequest, "headers">,
  env: NodeJS.ProcessEnv = process.env,
) {
  return internalTokenAllowed(request, env);
}
