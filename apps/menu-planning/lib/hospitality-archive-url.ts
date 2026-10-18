import { approvedCredentialedUpstream } from "@fika/server-shared/credentialed-upstream";

/**
 * Hospitality endpoint used for the optional publication PDF archive.
 * Hosted runtimes never fall back to localhost: when the endpoint is not configured the archive
 * is reported as not configured and no request is made. A configured value must pass the shared
 * credentialed-upstream check (production services only in production; never production from staging).
 */
export function hospitalityArchiveBase(env: Record<string, string | undefined> = process.env): string | undefined {
  const configured = env.HOSPITALITY_BOOKING_BASE_URL?.trim();
  if (configured) return approvedCredentialedUpstream("hospitality", configured, env.FIKA_RUNTIME_MODE);
  return ["staging", "production"].includes(env.FIKA_RUNTIME_MODE || "") ? undefined : "http://localhost:3300";
}
