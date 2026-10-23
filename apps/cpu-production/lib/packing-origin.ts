/** CPU-only browser write boundary. Configured public origins take precedence over
 * internal App Hosting URLs. Forwarded hosts never establish trust. */
export function assertPackingOrigin(
  request: Request,
  env: Record<string, string | undefined> = process.env,
) {
  const denied = () =>
    Object.assign(
      new Error("Cross-origin packing updates are not permitted."),
      { status: 403 },
    );
  const origin = request.headers.get("origin");
  if (!origin) throw denied();
  const mode =
    env.FIKA_RUNTIME_MODE ||
    (env.NODE_ENV === "production" ? "production" : "local");
  let expected: string;
  if (mode === "local") expected = new URL(request.url).origin;
  else {
    const allowed =
      mode === "staging"
        ? [
            "https://cpu-staging.fikacatering.com",
            "https://fika-cpu-production-staging--fika-os-dev.europe-west4.hosted.app",
          ]
        : mode === "production"
          ? [
              "https://cpu.fikacatering.com",
              "https://fika-os-prod-cpu--fika-os.europe-west4.hosted.app",
            ]
          : [];
    const configured = env.CPU_PUBLIC_BASE_URL || env.CPU_PRODUCTION_BASE_URL;
    try {
      const url = new URL(configured || "");
      if (
        !allowed.includes(url.origin) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname !== "/"
      )
        throw Error();
      expected = url.origin;
    } catch {
      throw Object.assign(
        new Error("CPU public origin is not configured correctly."),
        { status: 503 },
      );
    }
  }
  if (origin !== expected) throw denied();
}
