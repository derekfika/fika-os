import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import { sessionCookieConfig } from "@fika/server-shared/runtime-config";

export type BeveragePreviewAccess = "allow" | "missing" | "invalid" | "denied" | "misconfigured";
export type BeveragePreviewClaims = Pick<DecodedIdToken, "email" | "email_verified">;

export function beveragePreviewCookieName(env: NodeJS.ProcessEnv = process.env) {
  return sessionCookieConfig(env).name;
}

export function beveragePreviewAccessDecision(env: NodeJS.ProcessEnv, cookie: string | undefined, claims?: BeveragePreviewClaims): BeveragePreviewAccess {
  if (env.FIKA_BEVERAGE_PREVIEW_ONLY !== "1") return "allow";
  const local = env.FIKA_RUNTIME_MODE === "local" && ["demo-fika-os", "fika-os-local"].includes(env.FIREBASE_PROJECT_ID || "") && env.FIKA_BEVERAGE_PREVIEW_LOCAL_AUTH === "fixture";
  if (local) return cookie && cookie !== "fixture:beverage-preview-reviewer" ? "denied" : "allow";
  if (env.FIKA_RUNTIME_MODE !== "staging" || env.FIREBASE_PROJECT_ID !== "fika-os-dev") return "misconfigured";
  if (!cookie) return "missing";
  if (!claims) return "invalid";
  const reviewers = new Set((env.FIKA_BEVERAGE_PREVIEW_REVIEWER_EMAILS || "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
  if (!reviewers.size || !claims.email || claims.email_verified !== true) return reviewers.size ? "denied" : "misconfigured";
  return reviewers.has(claims.email.trim().toLowerCase()) ? "allow" : "denied";
}

async function verifyStagingSession(cookie: string): Promise<BeveragePreviewClaims> {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (projectId !== "fika-os-dev") throw new Error("Beverage preview session verification requires the dedicated staging project.");
  const app = getApps().find(item => item.name === "beverage-preview-auth") || initializeApp({ projectId }, "beverage-preview-auth");
  return getAuth(app).verifySessionCookie(cookie, true);
}

export async function checkBeveragePreviewAccess(env: NodeJS.ProcessEnv = process.env, cookie?: string, verify = verifyStagingSession): Promise<BeveragePreviewAccess> {
  let claims: BeveragePreviewClaims | undefined;
  const initial = beveragePreviewAccessDecision(env, cookie);
  if (initial === "allow" || initial === "missing" || initial === "misconfigured") return initial;
  try { claims = await verify(cookie!); }
  catch { return "invalid"; }
  return beveragePreviewAccessDecision(env, cookie, claims);
}
