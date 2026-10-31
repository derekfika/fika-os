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

type LockedPageState = {
  scrollX: number;
  scrollY: number;
  htmlOverflow: string;
  htmlScrollbarGutter: string;
  bodyPosition: string;
  bodyTop: string;
  bodyLeft: string;
  bodyWidth: string;
  bodyOverflow: string;
};

let modalLockCount = 0;
let lockedPage: LockedPageState | undefined;

/** Freeze the document once for nested dialogs, then restore its exact inline styles and scroll. */
function acquirePageScrollLock() {
  if (modalLockCount === 0) {
    const html = document.documentElement;
    const body = document.body;
    lockedPage = {
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      htmlOverflow: html.style.overflow,
      htmlScrollbarGutter: html.style.scrollbarGutter,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyWidth: body.style.width,
      bodyOverflow: body.style.overflow,
    };
    // Keep the viewport gutter while suppressing the root scrollbar so centred fixed dialogs
    // do not move horizontally when focus or internal scrolling changes the page overflow.
    html.style.scrollbarGutter = "stable";
    html.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `${-lockedPage.scrollY}px`;
    body.style.left = `${-lockedPage.scrollX}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
  }
  modalLockCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    modalLockCount = Math.max(0, modalLockCount - 1);
    if (modalLockCount !== 0 || !lockedPage) return;
    const state = lockedPage;
    lockedPage = undefined;
    const html = document.documentElement;
    const body = document.body;
    html.style.overflow = state.htmlOverflow;
    html.style.scrollbarGutter = state.htmlScrollbarGutter;
    body.style.position = state.bodyPosition;
    body.style.top = state.bodyTop;
    body.style.left = state.bodyLeft;
    body.style.width = state.bodyWidth;
    body.style.overflow = state.bodyOverflow;
    window.scrollTo(state.scrollX, state.scrollY);
  };
}

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
    const releasePageScroll = acquirePageScrollLock();
    const dialog = dialogRef.current;
    if (!dialog) { releasePageScroll(); return; }
    const first = dialog.querySelector<HTMLElement>("[data-modal-autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])");
    (first || dialog).focus({ preventScroll: true });
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
      openerRef.current?.focus({ preventScroll: true });
      releasePageScroll();
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
