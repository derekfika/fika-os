"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Standard-width modal on the native <dialog>: focus is managed, Escape closes, focus returns to the invoker. */
export function Dialog({ open, title, onClose, children, footer, busy = false }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer: ReactNode; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const invoker = useRef<Element | null>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) { invoker.current = document.activeElement; dialog.showModal(); }
    if (!open && dialog.open) { dialog.close(); (invoker.current as HTMLElement | null)?.focus?.(); }
  }, [open]);
  return <dialog ref={ref} className="dialog" aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="dialog-title">{title}</h2>
    <div className="dialog-body">{children}</div>
    <div className="dialog-foot">{footer}</div>
  </dialog>;
}
