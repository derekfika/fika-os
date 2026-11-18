import { STUDIO_AUTH_HUB_ORIGIN, STUDIO_AUTHMOD_APP, STUDIO_STAGING_ORIGIN } from "./authmod-core/hospitality-studio-admission";

const studioHost = new URL(STUDIO_STAGING_ORIGIN).hostname;

export function launcherDestination(value: string | null, appId: string | null, launcherOrigin: string, allowedOrigins?: string[]) {
  let isStudioHost = false;
  if (value) {
    try { isStudioHost = new URL(value).hostname === studioHost; }
    catch { /* Relative or invalid destinations are handled below. */ }
  }
  if (appId === STUDIO_AUTHMOD_APP || isStudioHost) {
    const studioPreview = launcherOrigin === STUDIO_AUTH_HUB_ORIGIN && appId === STUDIO_AUTHMOD_APP && value === STUDIO_STAGING_ORIGIN + "/";
    return studioPreview ? { href: STUDIO_STAGING_ORIGIN + "/", kind: "studio" as const }
      : { href: "/", kind: "studio-denied" as const };
  }
  return { href: validateReturnTo(value, allowedOrigins), kind: "launcher" as const };
}

export function validateReturnTo(value: string | null | undefined, allowedOrigins = (process.env.FIKA_ALLOWED_APP_ORIGINS || "").split(",").map(item => item.trim()).filter(Boolean)) {
  if (!value) return "/";
  if (value.startsWith("/") && !value.startsWith("//") && !/[\u0000-\u001f\\]/.test(value)) return value;
  try {
    const target = new URL(value);
    if (allowedOrigins.includes(target.origin)) return target.href;
  } catch { /* invalid destinations are rejected below */ }
  throw Object.assign(new Error("The requested return destination is not allowed."), { status: 400, code: "FIKA_RETURN_TO_INVALID" });
}
