import { headers } from "next/headers";
import RotationsManager from "./RotationsManager";
import MenuPlanningShell from "../menu-planning-shell";
import styles from "./rotations.module.css";
import { readRotationAccess, rotationsHubFetch } from "@/lib/hospitality-rotations-hub";
import type { RotationHead, RotationRevision } from "../../../shared/hospitality-rotations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Resources = { dishes: Array<{ id: string; name: string; category: string; revision: number; itemId?: string; hospitalityClass?: string }>; items: Array<{ id: string; name: string; category: string; dishId?: string; classification?: string }>; classifications: Array<{ id: string; label: string }> };

async function hubJson<T>(path: string, cookie: string | null): Promise<{ ok: true; body: T } | { ok: false; status: number; message?: string }> {
  try {
    const response = await rotationsHubFetch(path, cookie, { headers: { accept: "application/json" } });
    const body = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
    return response.ok ? { ok: true, body } : { ok: false, status: response.status, message: body.error?.message };
  } catch (error) { return { ok: false, status: 503, message: (error as Error).message }; }
}

export default async function HospitalityRotationsPage() {
  const cookie = (await headers()).get("cookie");
  let access;
  try { access = await readRotationAccess(cookie); }
  catch (error) { return <State message={(error as { status?: number }).status === 401 ? "Sign in to view Hospitality Rotations." : "Rotations access could not be verified. Refresh the page or contact your administrator."} />; }
  const permissions = access.permissions;
  if (!permissions.View) return <State message="You do not have View access to Hospitality Rotations." />;

  const managed = await hubJson<{ head: RotationHead; draft: RotationRevision | null }>("/api/hospitality-rotations?mode=manage", cookie);
  if (!managed.ok) return <State message={managed.status === 403 ? "The Rotations manager requires Manage access." : "The Rotations service is unavailable. Your saved versions have not been changed."} />;
  const resources = await hubJson<Resources>("/api/hospitality-rotations?mode=resources", cookie);
  // Name the failing dependency; never substitute sample data or an empty list.
  if (!resources.ok) return <State message={`Hospitality dishes and catalogue options are unavailable${resources.message ? `: ${resources.message}` : ""}. No sample data is shown.`} />;

  return <MenuPlanningShell section="Hospitality Rotations">
    <RotationsManager styles={styles} permissions={permissions} initialHead={managed.body.head} initialDraft={managed.body.draft} dishes={resources.body.dishes} items={resources.body.items} classifications={resources.body.classifications} />
  </MenuPlanningShell>;
}

function State({ message }: { message: string }) {
  return <MenuPlanningShell section="Hospitality Rotations"><section className={styles.panel} role="status" style={{ margin: 16 }}><p>{message}</p></section></MenuPlanningShell>;
}
