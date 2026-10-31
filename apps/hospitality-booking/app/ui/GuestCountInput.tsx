"use client";

import { useEffect, useId, useState } from "react";
import { guestCountMessage } from "../../lib/guest-count";
import styles from "./GuestCountInput.module.css";

export default function GuestCountInput({ value, minimum, onChange, field, surface, submittedError }: {
  value: number; minimum: number | null; onChange: (value: number) => void;
  field: string; surface: "booking" | "rcoa"; submittedError?: string;
}) {
  const id = useId();
  const [text, setText] = useState(value ? String(value) : "");
  const [blurred, setBlurred] = useState(false);
  useEffect(() => {
    setText(current => Number(current || 0) === value ? current : value ? String(value) : "");
  }, [value]);
  const message = guestCountMessage(value, minimum, text === "" && !blurred && !submittedError);
  return <>
    <input className={styles.input} type="number" inputMode="numeric" min={minimum ?? 1} step="1" aria-required="true"
      data-booking-field={surface === "booking" ? field : undefined} data-rcoa-field={surface === "rcoa" ? field : undefined}
      aria-invalid={message ? true : undefined} aria-describedby={`${id}-hint${message ? ` ${id}-error` : ""}`}
      value={text} onChange={event => { setText(event.target.value); setBlurred(false); onChange(Number(event.target.value || 0)); }} onBlur={() => setBlurred(true)} />
    <small id={`${id}-hint`} className={styles.hint}>{minimum === null ? "Guest minimum unavailable." : `Minimum: ${minimum} ${minimum === 1 ? "guest" : "guests"}.`}</small>
    <span id={`${id}-error`} className={styles.error} aria-live="polite" aria-atomic="true">{message}</span>
  </>;
}

export function GuestCountNotice({ message, onEdit, label = "Edit guest count" }: { message: string; onEdit: () => void; label?: string }) {
  return <div className={styles.notice} role="status"><span>{message}</span><button type="button" onClick={onEdit}>{label}</button></div>;
}
