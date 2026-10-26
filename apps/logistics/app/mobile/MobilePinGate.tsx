"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import shell from "./driver-shell.module.css";
import MobileWorkflow from "./MobileWorkflow";

type Vehicle = "van1" | "van2";
const vehicleId = (label: "Van 1" | "Van 2"): Vehicle => label === "Van 1" ? "van1" : "van2";

export default function MobilePinGate({ vehicle }: { vehicle: "Van 1" | "Van 2" }) {
  const id = vehicleId(vehicle);
  const [state, setState] = useState<"checking" | "locked" | "ready">("checking");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const checkSession = useCallback(async () => {
    try {
      const response = await fetch(`/api/logistics/mobile/session?vehicle=${id}`, { cache: "no-store" });
      const body = await response.json().catch(() => null) as { vehicleId?: string; error?: { message?: string } } | null;
      if (response.ok && body?.vehicleId === id) { setState("ready"); setError(""); return; }
      setState("locked");
      setError(response.status === 403 ? "This session belongs to another vehicle. Sign out before continuing." : "");
    } catch { setState("locked"); setError("Vehicle sign-in could not be checked. Check the connection and retry."); }
  }, [id]);

  useEffect(() => { void checkSession(); }, [checkSession]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !/^\d{6,12}$/.test(pin)) { setError("Enter the vehicle PIN using 6 to 12 digits."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/logistics/mobile/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ vehicleId: id, pin }) });
      const body = await response.json().catch(() => null) as { vehicleId?: string; error?: { message?: string } } | null;
      setPin("");
      if (!response.ok || body?.vehicleId !== id) { setError(body?.error?.message || "Vehicle sign-in failed. Try again or contact the Logistics administrator."); return; }
      setState("ready");
    } catch { setPin(""); setError("Vehicle sign-in could not be completed. Check the connection and retry."); }
    finally { setBusy(false); }
  }

  async function signOut() {
    setBusy(true);
    try { await fetch("/api/logistics/mobile/session", { method: "DELETE" }); }
    finally { setBusy(false); setPin(""); setError(""); setState("locked"); }
  }

  if (state === "checking") return <main className="mobile-pin-shell" aria-live="polite"><p>Checking {vehicle} access…</p></main>;
  if (state === "ready") return <><div className={shell.topbar}><span className={shell.vehicle}>{vehicle} session</span><span aria-hidden="true" /><button type="button" className={shell.signOut} onClick={() => void signOut()} disabled={busy}>{busy ? "Signing out…" : "Sign out"}</button></div><MobileWorkflow fixedVan={vehicle} /></>;
  return <main className="mobile-pin-shell">
    <section className="mobile-pin-card" aria-labelledby="mobile-pin-title">
      <p className="mobile-pin-eyebrow">FIKA OS · LOGISTICS</p>
      <h1 id="mobile-pin-title">{vehicle} mobile access</h1>
      <p>Enter the PIN for this vehicle to open its dated driver view.</p>
      <form onSubmit={signIn}>
        <label htmlFor="vehicle-pin">{vehicle} PIN</label>
        <input id="vehicle-pin" name="pin" type="password" inputMode="numeric" autoComplete="off" pattern="[0-9]{6,12}" minLength={6} maxLength={12} value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 12))} required aria-describedby={error ? "vehicle-pin-error" : "vehicle-pin-help"} />
        <small id="vehicle-pin-help">Use the authorised PIN for {vehicle} only.</small>
        {error && <p id="vehicle-pin-error" className="mobile-pin-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy || pin.length < 6}>{busy ? "Checking PIN…" : "Continue"}</button>
      </form>
      <button className="mobile-pin-retry" type="button" onClick={() => void checkSession()} disabled={busy}>Check session again</button>
    </section>
  </main>;
}
