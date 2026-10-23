"use client";

import { useEffect, useRef } from "react";
import styles from "./visit-chooser.module.css";

export type VisitChoiceOption = { request: string; label: string; detail: string };
export type VisitChoicePrompt = { customer: string; options: VisitChoiceOption[] };

/**
 * Shown only when a customer already has more than one physical visit on the target Run, so the
 * server cannot unambiguously pick one. Franco picks an existing visit or starts a New visit.
 * Contained modal: focus moves in, Tab is trapped, Escape/Cancel abandon the placement, focus returns.
 */
export function VisitChooser({ prompt, onChoose }: { prompt: VisitChoicePrompt; onChoose: (request?: string) => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  return <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) onChoose(undefined); }}>
    <div
      className={styles.dialog}
      role="dialog"
      aria-modal="true"
      aria-labelledby="visit-chooser-title"
      ref={dialog}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); onChoose(undefined); }
        if (event.key !== "Tab") return;
        const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") || []);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus(); }
      }}
    >
      <h2 id="visit-chooser-title">Which visit?</h2>
      <p>{prompt.customer} already has more than one visit on this run. Add this work to one of them, or start a new visit.</p>
      <ul className={styles.options}>
        {prompt.options.map((option) => <li key={option.request}><button type="button" onClick={() => onChoose(option.request)}><strong>{option.label}</strong><span>{option.detail}</span></button></li>)}
      </ul>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={() => onChoose(undefined)}>Cancel</button>
        <button type="button" className={styles.primary} onClick={() => onChoose("new")}>New visit</button>
      </div>
    </div>
  </div>;
}
