import { oplocIdsMatch } from "@fika/server-shared/governed-oplocs";
import { withDeliveredInLoadTimeout } from "../../lib/dashboard-load-timeout";
import { publicHubBase } from "../../lib/upstream-config";

type GrabAndGoSite = {
  oplocId: string;
  label: string;
  services?: { deliveredIn: boolean; grabAndGo: boolean };
};

export type GrabAndGoAccess =
  | { status: "ready"; sites: GrabAndGoSite[]; accountScope: string }
  | { status: "denied" | "sign-in" | "unavailable" };

export function selectGrabAndGoSite(sites: readonly GrabAndGoSite[], requestedId?: string) {
  if (!requestedId) return sites[0];
  return sites.find(site => oplocIdsMatch(site.oplocId, requestedId));
}

export async function redirectForSessionFailure(response: Response, current: () => boolean) {
  if (response.status !== 401) return false;
  const body = (await response.clone().json().catch(() => undefined)) as { error?: { code?: string } } | undefined;
  const code = body?.error?.code;
  if (!current()) return true;
  if (code !== "FIKA_SESSION_MISSING" && code !== "FIKA_SESSION_INVALID") return false;
  const hub = publicHubBase(process.env.NEXT_PUBLIC_INTEGRATION_HUB_BASE_URL);
  const returnTo = window.location.href;
  window.location.assign(`${hub}/?returnTo=${encodeURIComponent(returnTo)}&appId=delivered-in&launchError=${encodeURIComponent(code)}`);
  return true;
}

export async function readGrabAndGoAccess(signal: AbortSignal, redirectOnSessionFailure = false): Promise<GrabAndGoAccess> {
  try {
    return await withDeliveredInLoadTimeout(async () => {
      const response = await fetch("/api/delivered-in/access?service=grab-and-go", {
        cache: "no-store",
        signal,
      });
      if (response.status === 401) {
        if (redirectOnSessionFailure) {
          await redirectForSessionFailure(response, () => !signal.aborted);
        }
        return { status: "sign-in" };
      }
      if (response.status === 403) return { status: "denied" };
      if (!response.ok) return { status: "unavailable" };

      const body = await response.json() as {
        access?: { email?: string; oplocIds?: string[] };
        sites?: GrabAndGoSite[];
      };
      if (typeof body.access?.email !== "string" || !body.access.email ||
          !Array.isArray(body.access.oplocIds) || !Array.isArray(body.sites)) {
        return { status: "unavailable" };
      }
      const { email, oplocIds } = body.access;
      const sites = body.sites.filter(site => oplocIds.includes(site.oplocId));
      return { status: "ready", sites, accountScope: email.toLowerCase() };
    });
  } catch {
    return { status: "unavailable" };
  }
}
