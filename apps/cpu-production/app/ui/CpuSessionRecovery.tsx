"use client";

import { useEffect, useRef, useState } from "react";
import { CPU_SESSION_OBSERVATION_EVENT, cpuSignInUrl, fetchCpuApi, type CpuSessionCode, type CpuSessionObservation } from "../lib/session-recovery";
import styles from "./CpuSessionRecovery.module.css";

export default function CpuSessionRecovery({ onRecovered }: { onRecovered: () => void }) {
  const [failure, setFailure] = useState<{ code: CpuSessionCode; href?: string }>();
  const [denied, setDenied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const latest = useRef(0);
  const recoveredCallback = useRef(onRecovered);
  recoveredCallback.current = onRecovered;
  useEffect(() => {
    const observe = (event: Event) => {
      const observation = (event as CustomEvent<CpuSessionObservation>).detail;
      if (!observation || !Number.isInteger(observation.request)) return;
      // A different admitted actor must not inherit this tab's forms or data.
      if (observation.code === "identity-changed") { window.location.reload(); return; }
      if (observation.request < latest.current) return;
      latest.current = observation.request;
      if (observation.code === "confirmed") { setFailure(undefined); setDenied(false); setMessage(""); return; }
      if (observation.code === "denied") {
        setDenied(true);
        setMessage("Your account is not permitted to complete this CPU request. Contact an administrator if you need access.");
        return;
      }
      if (observation.code !== "FIKA_SESSION_MISSING" && observation.code !== "FIKA_SESSION_INVALID") return;
      setFailure({ code: observation.code, href: cpuSignInUrl(process.env.NEXT_PUBLIC_FIKA_HUB_URL, window.location.href, observation.code) });
      setDenied(false);
      setMessage("");
    };
    window.addEventListener(CPU_SESSION_OBSERVATION_EVENT, observe);
    return () => window.removeEventListener(CPU_SESSION_OBSERVATION_EVENT, observe);
  }, []);

  async function checkLogin() {
    const startedAfter = latest.current;
    setChecking(true);
    setMessage("");
    try {
      const response = await fetchCpuApi("/api/production?cacheScope=1", { cache: "no-store" });
      const body = await response.json().catch(() => undefined);
      if (response.ok && typeof body?.cacheScope === "string" && body.cacheScope) {
        recoveredCallback.current(); // Refresh the current view's reads only; never replay a failed operation.
      } else if (latest.current === startedAfter) {
        setMessage("Login could not be checked. Check your connection and try again.");
      }
    } catch { if (latest.current === startedAfter) setMessage("Login could not be checked. Check your connection and try again."); }
    finally { setChecking(false); }
  }

  if (!failure) return null;
  return <section className={styles.banner} role="alert" aria-labelledby="cpu-session-title">
    <div><h2 id="cpu-session-title">{denied ? "CPU access is not available" : "Sign in again to continue"}</h2>
      {!denied && <p>Your FIKA OS session has expired or is no longer valid. Sign in with the same account in a new tab, then return here and check your login. Your current view and open form stay in this tab. If you use a different account, CPU reloads and clears unsaved entries.</p>}
      {!denied && !failure.href && <p>Open your usual Integration Hub sign-in page, then return to this tab.</p>}
      {message && <p role="status">{message}</p>}
    </div>
    <div className={styles.actions}>
      {!denied && failure.href && <a href={failure.href} target="_blank" rel="noopener noreferrer">Sign in again <span className={styles.srOnly}>(opens a new tab)</span></a>}
      <button type="button" disabled={checking} onClick={() => void checkLogin()}>{checking ? "Checking login…" : denied ? "Check access again" : "Check login"}</button>
    </div>
  </section>;
}
