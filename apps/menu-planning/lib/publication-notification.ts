export type PublicationChangeNotification = {
  event: "publication_changed";
  publicationDayId: string;
  serviceDate: string;
  version: number;
  action: "published" | "amended" | "withdrawn" | "republished";
};

export async function notifyCpuPublicationChanged(notification: PublicationChangeNotification) {
  const base = (process.env.CPU_PRODUCTION_BASE_URL || "http://localhost:3400").replace(/\/$/, "");
  try {
    const response = await fetch(`${base}/api/menu-publications/invalidate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(notification),
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error(`CPU invalidation returned ${response.status}.`);
    return true;
  } catch (error) {
    console.error("CPU publication invalidation failed; fallback refresh will recover.", error);
    return false;
  }
}
