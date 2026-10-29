import { headers } from "next/headers";
import RotationsManager from "./RotationsManager";
import styles from "../rotations-preview/rotations-preview.module.css";
import { hubUserFetch } from "@/lib/hub";
import type { RotationHead, RotationRevision } from "../../../shared/hospitality-rotations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Permissions = { View: boolean; Manage: boolean; Publish: boolean };

async function hubGet(path: string, cookie: string | null) {
  return hubUserFetch(path, cookie, { headers: { accept: "application/json" } });
}

export default async function RotationsManagerPage() {
  const cookie = (await headers()).get("cookie");
  const accessResponse = await hubGet("/api/hospitality-rotations?mode=access", cookie);
  if (!accessResponse.ok) return <AccessState styles={styles} message={accessResponse.status === 401 ? "Sign in to view Hospitality Rotations." : "Rotations access could not be verified. Refresh the page or contact your administrator."} />;
  const accessBody = await accessResponse.json() as { permissions?: Permissions };
  const permissions = accessBody.permissions || { View: false, Manage: false, Publish: false };
  if (!permissions.View) return <AccessState styles={styles} message="You do not have View access to Hospitality Rotations." />;

  const manageResponse = await hubGet("/api/hospitality-rotations?mode=manage", cookie);
  if (!manageResponse.ok) return <AccessState styles={styles} message={manageResponse.status === 403 ? "The Rotations manager requires Manage access." : "The Rotations service is unavailable. Your saved versions have not been changed."} />;
  const managed = await manageResponse.json() as { head: RotationHead; draft: RotationRevision | null };
  const resourcesResponse = await hubGet("/api/hospitality-rotations?mode=resources", cookie);
  if (!resourcesResponse.ok) return <AccessState styles={styles} message="Canonical Dish Library and Hospitality catalogue options are unavailable. No sample data is shown." />;
  const resources = await resourcesResponse.json() as { dishes: Array<{ id: string; name: string; category: string; revision: number }>; items: Array<{ id: string; name: string; category: string }> };

  return <RotationsManager styles={styles} permissions={permissions} initialHead={managed.head} initialDraft={managed.draft} dishes={resources.dishes} items={resources.items} />;
}

function AccessState({ styles, message }: { styles: Record<string, string>; message: string }) {
  return <main className={styles.page}><header className={styles.header}><div><p className={styles.eyebrow}>Hospitality · Menu management</p><h1>Rotations</h1></div></header><section className={styles.panel} role="status"><p>{message}</p></section></main>;
}
