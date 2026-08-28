"use client";
import Link from "next/link";
import styles from "./admission-error.module.css";

export function AdmissionError({ application, code, message, supportingText, requestId, signInUrl }: { application: string; code: string; message: string; supportingText?: string; requestId?: string; signInUrl?: string }) {
  return <main className={styles.page}><section className={styles.card}><div className={styles.brand}>FIKA OS</div><p className={styles.app}>{application}</p><h1>We couldn’t open {application}</h1><p className={styles.message}>{message}</p>{supportingText && <p className={styles.supporting}>{supportingText}</p>}<div className={styles.actions}>{signInUrl ? <a href={signInUrl}>Sign in again</a> : <button onClick={() => window.location.reload()}>Try again</button>}<Link href={process.env.NEXT_PUBLIC_FIKA_HUB_URL || "/"}>Return to FIKA OS</Link></div><small>Error code: {code}{requestId && <> · Reference: {requestId}</>}</small></section></main>;
}
