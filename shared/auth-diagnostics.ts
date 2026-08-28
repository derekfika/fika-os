type HeaderSource = { headers?: { get(name: string): string | null } };

export function requestIdFor(request: HeaderSource) {
  return request.headers?.get("x-request-id") || crypto.randomUUID();
}

export function sessionCookiePresent(request: HeaderSource, cookieName = "fika_os_session") {
  const cookie = request.headers?.get("cookie") || "";
  return cookie.split(";").some((part) => part.trim().startsWith(`${cookieName}=`));
}

export function logAuthDiagnostic(
  request: HeaderSource,
  values: { authStage: string; status: number; code: string; cookieName?: string; requestId?: string },
) {
  console.warn("FIKA auth diagnostic", {
    requestId: values.requestId || requestIdFor(request),
    cookiePresent: sessionCookiePresent(request, values.cookieName),
    runtimeMode: process.env.FIKA_RUNTIME_MODE || "unknown",
    appId: "logistics",
    authStage: values.authStage,
    status: values.status,
    code: values.code,
  });
}
