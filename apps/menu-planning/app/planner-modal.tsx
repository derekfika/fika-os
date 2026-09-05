"use client";

import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";

type PlannerModalProps = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  dismissible?: boolean;
  busy?: boolean;
  className?: string;
  style?: CSSProperties;
};

const focusable = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])";

export default function PlannerModal({ title, children, onClose, dismissible = true, busy = false, className = "", style }: PlannerModalProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  const busyRef = useRef(busy);
  const titleId = useId();
  onCloseRef.current = onClose;
  dismissibleRef.current = dismissible;
  busyRef.current = busy;

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const first = dialog.querySelector<HTMLElement>("[data-modal-autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])");
    (first || dialog).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (dismissibleRef.current && !busyRef.current) { event.preventDefault(); onCloseRef.current(); }
        return;
      }
      if (event.key !== "Tab") return;
      const elements = Array.from(dialog.querySelectorAll<HTMLElement>(focusable));
      if (!elements.length) { event.preventDefault(); return; }
      const firstElement = elements[0];
      const lastElement = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) { event.preventDefault(); lastElement.focus(); }
      else if (!event.shiftKey && document.activeElement === lastElement) { event.preventDefault(); firstElement.focus(); }
    };
    dialog.addEventListener("keydown", onKeyDown);
    return () => {
      dialog.removeEventListener("keydown", onKeyDown);
      openerRef.current?.focus();
    };
  }, []);

  return <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (dismissible && !busy && event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className={`planner-modal ${className}`} style={style} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <h2 id={titleId} className="sr-only">{title}</h2>
      {busy && <p className="planner-modal-busy" role="status">This operation is in progress. Keep this window open until it finishes.</p>}
      {children}
    </section>
  </div>;
}
