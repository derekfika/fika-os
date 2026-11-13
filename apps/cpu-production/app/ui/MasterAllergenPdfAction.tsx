"use client";
import { useEffect, useState } from "react";
export default function MasterAllergenPdfAction({ serviceDate }: { serviceDate: string }) {
  const [result, setResult] = useState<{ date: string; url?: string; message?: string }>();
  useEffect(() => {
    if (!serviceDate) return;
    const controller = new AbortController();
    fetch(`/api/signed-allergen-pdf?document=master&serviceDate=${encodeURIComponent(serviceDate)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => { if (!controller.signal.aborted) setResult({ date: serviceDate, url: ok && body.state === "ready" ? body.url : undefined, message: body.error?.message || "No current signed master is available for this date." }); })
      .catch(() => { if (!controller.signal.aborted) setResult({ date: serviceDate, message: "The signed master could not be checked. Reload to try again." }); });
    return () => controller.abort();
  }, [serviceDate]);
  if (!serviceDate) return null;
  return <div aria-label="Master Allergen Checker">{result?.date === serviceDate && result.url ? <a className="kitchen-button" href={result.url} target="_blank" rel="noopener noreferrer">View / Print Master Allergen Checker</a> : <span role="status">{result?.date === serviceDate ? result.message : "Checking current signed master…"}</span>}</div>;
}
