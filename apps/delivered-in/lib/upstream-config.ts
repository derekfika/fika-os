export type CredentialedUpstream = "hub" | "menu" | "cpu";

const productionOrigins: Record<CredentialedUpstream, string> = {
  hub: "https://fika-os-prod-hub--fika-os.europe-west4.hosted.app",
  menu: "https://fika-os-prod-menu--fika-os.europe-west4.hosted.app",
  cpu: "https://fika-os-prod-cpu--fika-os.europe-west4.hosted.app",
};

/** Resolve an upstream that receives a browser cookie or FIKA internal token. */
export function credentialedUpstreamBase(
  service: CredentialedUpstream,
  configured: string | undefined,
  fallback: string,
  runtimeMode = process.env.FIKA_RUNTIME_MODE,
) {
  const candidate = (configured || fallback).replace(/\/$/, "");
  if (runtimeMode !== "production") return candidate;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error(`Production ${service} upstream URL is invalid; credentials were not forwarded.`);
  }

  const expected = new URL(productionOrigins[service]);
  if (
    url.origin !== expected.origin ||
    url.pathname !== "/" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(`Production ${service} upstream is not the approved production service; credentials were not forwarded.`);
  }
  return url.origin;
}

/** Resolve the browser Hub destination used when the shared session expires. */
export function publicHubBase(
  configured: string | undefined,
  runtimeMode = process.env.NEXT_PUBLIC_FIKA_RUNTIME_MODE,
) {
  const candidate = (configured || "http://localhost:3200").replace(/\/$/, "");
  if (runtimeMode !== "production") return candidate;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Production Hub sign-in destination is invalid.");
  }
  if (url.origin !== "https://os.fikacatering.com" || url.pathname !== "/" || url.username || url.password || url.search || url.hash) {
    throw new Error("Production Hub sign-in destination is not the approved production Hub.");
  }
  return url.origin;
}
