/** A service token may be absent only in an explicitly local runtime. */
export function internalTokenAllowed(
  request: { headers: { get(name: string): string | null } },
  env: NodeJS.ProcessEnv = process.env,
) {
  const configured = env.FIKA_INTERNAL_API_TOKEN?.trim();
  if (!configured) return env.FIKA_RUNTIME_MODE === "local" && env.NODE_ENV !== "production";
  return request.headers.get("x-fika-internal-token") === configured;
}
