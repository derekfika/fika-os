export function cpuSignInUrl(returnTo: string, hubUrl: string) {
  const target = new URL("/", hubUrl);
  target.searchParams.set("returnTo", returnTo);
  target.searchParams.set("appId", "cpu-production");
  target.searchParams.set("launchError", "FIKA_SESSION_INVALID");
  return target.href;
}

/** Reuse Hub's cookie/session sign-in; never redirect permission denials or store session material. */
export function redirectExpiredCpuSession(
  response: Pick<Response, "status">,
  location: Pick<Location, "href" | "assign"> | undefined = typeof window === "undefined" ? undefined : window.location,
  hubUrl = process.env.NEXT_PUBLIC_FIKA_HUB_URL || (process.env.NODE_ENV !== "production" ? "http://localhost:3200" : undefined),
) {
  if (response.status !== 401 || !location || !hubUrl) return false;
  location.assign(cpuSignInUrl(location.href, hubUrl));
  return true;
}
