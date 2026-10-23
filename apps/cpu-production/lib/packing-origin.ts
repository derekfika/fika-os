let diagnosed = false;
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
  // Existing trace flag; one safe technical sample per process, never credentials
  // or a Firestore audit write. Makes the App Hosting proxy boundary observable.
  if (env.FIKA_DATA_SOURCE_TRACE === "1" && !diagnosed) {
    diagnosed = true;
    const safeOrigin = (value: string | null) => {
      try {
        return new URL(value || "").origin;
      } catch {
        return "invalid-or-missing";
      }
    };
    const proto = request.headers
      .get("x-forwarded-proto")
      ?.split(",", 1)[0]
      ?.trim();
    const host = request.headers
      .get("x-forwarded-host")
      ?.split(",", 1)[0]
      ?.trim();
    console.info("CPU packing origin diagnostic", {
      event: "cpu.packing.origin",
      expectedOrigin: expected,
      browserOrigin: safeOrigin(origin),
      internalOrigin: safeOrigin(request.url),
      forwardedOrigin:
        proto === "https" || proto === "http"
          ? safeOrigin(`${proto}://${host}`)
          : "invalid-or-missing",
      allowed: origin === expected,
    });
  }
  if (origin !== expected) throw denied();
}
