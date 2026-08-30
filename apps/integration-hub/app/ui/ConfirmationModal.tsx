"use client";

import { useEffect, useRef } from "react";

export default function ConfirmationModal({ title, description, confirmLabel = "Confirm", destructive = false, busy = false, onCancel, onConfirm }: { title: string; description: string; confirmLabel?: string; destructive?: boolean; busy?: boolean; onCancel: () => void; onConfirm: () => void | Promise<void> }) {
  const firstAction = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);
  const cancelRef = useRef(onCancel);
  busyRef.current = busy;
  cancelRef.current = onCancel;
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    firstAction.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape" && !busyRef.current) cancelRef.current(); };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); opener.current?.focus(); };
  }, []);
  return <div className="detail-backdrop" role="presentation">
    <section className="detail-modal confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="confirmation-modal-title" aria-describedby="confirmation-modal-description" onMouseDown={event => event.stopPropagation()}>
      <header><div><small>Confirm action</small><h2 id="confirmation-modal-title">{title}</h2></div></header>
      <div className="connection-dialog-body"><p id="confirmation-modal-description">{description}</p></div>
      <footer className="modal-actions"><button type="button" ref={firstAction} disabled={busy} onClick={onCancel}>Cancel</button><button type="button" className={destructive ? "danger" : "primary"} disabled={busy} onClick={() => void onConfirm()}>{busy ? "Working…" : confirmLabel}</button></footer>
    </section>
  </div>;
}
