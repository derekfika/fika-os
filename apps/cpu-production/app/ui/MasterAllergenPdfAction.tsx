"use client";
import { useEffect, useState } from "react";
export default function MasterAllergenPdfAction({ serviceDate }: { serviceDate: string }) {
  const [result, setResult] = useState<{ date: string; url?: string; message?: string }>();
  const selectedDate = serviceDate ? new Date(`${serviceDate}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }) : "";
  useEffect(() => {
    if (!serviceDate) return;
    const controller = new AbortController();
    fetch(`/api/signed-allergen-pdf?document=master&serviceDate=${encodeURIComponent(serviceDate)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => { if (!controller.signal.aborted) setResult({ date: serviceDate, url: ok && body.state === "ready" && body.serviceDate === serviceDate && body.url === `/api/signed-allergen-pdf?document=master&serviceDate=${encodeURIComponent(serviceDate)}&download=pdf` ? body.url : undefined, message: body.error?.message || "No current signed master is available for this date." }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ date: serviceDate, message: "The signed master could not be checked. Reload to try again." }); });
    return () => controller.abort();
  }, [serviceDate]);
  if (!serviceDate) return null;
  return <div className="cpu-master-pdf-action" aria-label="Master Allergen Checker">{result?.date === serviceDate && result.url ? <a href={result.url} target="_blank" rel="noopener noreferrer">View / Print Master Allergens — {selectedDate}</a> : <span role="status">{result?.date === serviceDate ? `Master allergens unavailable / pending for ${selectedDate}. ${result.message}` : `Checking signed master for ${selectedDate}…`}</span>}</div>;
}
