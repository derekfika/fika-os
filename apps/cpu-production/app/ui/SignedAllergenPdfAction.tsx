"use client";

import { useEffect, useState } from "react";

type DocumentStatus = { state: "loading" | "ready" | "unsigned" | "pending" | "failed" | "revoked" | "stale" | "unavailable"; message: string; url?: string };

export default function SignedAllergenPdfAction({ orderId }: { orderId: string }) {
  const [status, setStatus] = useState<DocumentStatus>({ state: "loading", message: "Checking signed allergen document…" });
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/signed-allergen-pdf?orderId=${encodeURIComponent(orderId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => ({ ok: response.ok, body: await response.json() as Omit<DocumentStatus, "state"> & { state?: DocumentStatus["state"] } }))
      .then(({ ok, body }) => {
        if (!controller.signal.aborted) setStatus({ state: ok && body.state === "ready" ? "ready" : (body.state || "unavailable"), message: body.message || "Signed allergen document status could not be loaded.", url: body.url });
      })
      .catch(() => { if (!controller.signal.aborted) setStatus({ state: "unavailable", message: "Signed allergen document status could not be loaded." }); });
    return () => controller.abort();
  }, [orderId]);
  return <section aria-label="Signed allergen document">
    <h3>Signed allergen checker</h3>
    {status.state === "ready" && status.url
      ? <p><a className="kitchen-button" href={status.url} target="_blank" rel="noopener noreferrer">View / Print signed allergens (PDF)</a></p>
      : <p role="status">{status.message}</p>}
  </section>;
}
