"use client";

import { useEffect, useState } from "react";
import { disablePush, enablePush, loadPushState, sendTestPush, type PushState } from "./driver-push-client";
import styles from "./push-settings.module.css";

const COPY: Record<PushState, { title: string; detail: string }> = {
  unsupported: { title: "Not available on this browser", detail: "This browser can't receive push notifications. Your notifications will still appear in the app." },
  "needs-install": { title: "Add to your Home Screen first", detail: "On iPhone, push notifications work from the Home Screen app. Tap Share, then Add to Home Screen, and open FIKA Logistics from there." },
  blocked: { title: "Notifications are blocked", detail: "Turn notifications on for this app in your phone's settings, then come back here." },
  unavailable: { title: "Not available yet", detail: "Push notifications aren't switched on for this environment yet." },
  off: { title: "Notifications are off on this phone", detail: "Turn them on to be alerted about changes to your run, even when the app is closed." },
  on: { title: "Notifications are on for this phone", detail: "You'll be alerted when your run changes today. Everything also stays in the Notifications tab." },
};

export default function PushSettings({ headers }: { headers: Record<string, string> }) {
  const [state, setState] = useState<PushState>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => { let live = true; void loadPushState(headers).then(next => { if (live) setState(next); }).catch(() => { if (live) setState("unsupported"); }); return () => { live = false; }; }, []);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await action(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Something went wrong. Please try again."); }
    finally { setBusy(false); }
  };

  const copy = state ? COPY[state] : undefined;
  return <section className={styles.card} aria-labelledby="push-settings-title">
    <p className={styles.kicker}>PUSH NOTIFICATIONS</p>
    {!copy ? <p className={styles.detail}>Checking this phone…</p> : <>
      <h2 id="push-settings-title" className={styles.title}>{copy.title}</h2>
      <p className={styles.detail}>{copy.detail}</p>
      <div className={styles.actions}>
        {state === "off" && <button type="button" className={styles.primary} disabled={busy} onClick={() => void run(async () => setState(await enablePush(headers)))}>Turn on notifications</button>}
        {state === "on" && <>
          <button type="button" className={styles.primary} disabled={busy} onClick={() => void run(async () => { const result = await sendTestPush(headers); setMessage(result.sent > 0 ? "Test sent. It should arrive in a few seconds." : result.devices === 0 ? "No phone is registered yet. Turn notifications off and on again." : "The test could not be delivered. Please try again."); })}>Send a test notification</button>
          <button type="button" className={styles.secondary} disabled={busy} onClick={() => void run(async () => setState(await disablePush(headers)))}>Turn off</button>
        </>}
      </div>
      <p className={styles.status} role="status" aria-live="polite">{message}</p>
    </>}
  </section>;
}
