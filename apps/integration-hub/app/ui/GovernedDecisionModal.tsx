"use client";
import { useState, type ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";

export default function GovernedDecisionModal({ title, eyebrow = "Review decision", introduction, confirmLabel, busy = false, destructive = false, requireNote = false, confirmDisabled = false, children, summary = [], close, submit }: { title: string; eyebrow?: string; introduction: string; confirmLabel: string; busy?: boolean; destructive?: boolean; requireNote?: boolean; confirmDisabled?: boolean; children?: ReactNode; summary?: { label: string; value: string }[]; close: () => void; submit: (note: string) => Promise<void> | void }) {
  const [note, setNote] = useState("");
  return <div className="detail-backdrop" role="dialog" aria-modal="true" aria-labelledby="governed-decision-title" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><section className="detail-modal decision-modal"><header><div><small>{eyebrow}</small><h2 id="governed-decision-title">{title}</h2></div><button className="icon" aria-label="Close decision" onClick={close}><X /></button></header>
    {destructive && <div className="warning"><AlertTriangle /><span>This action changes local governed data. Review the scope before continuing.</span></div>}
    <p>{introduction}</p>
    {summary.length > 0 && <dl className="readable-summary">{summary.map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>}
    {children}
    <label>Add a note {requireNote ? <span>(required)</span> : <span>(optional)</span>}<textarea value={note} minLength={requireNote ? 10 : undefined} maxLength={1000} onChange={event => setNote(event.target.value)} placeholder={requireNote ? "Explain the exceptional context for this decision." : "Add exceptional context not already shown above."} /><small>Routine audit wording is generated from the selected action and displayed evidence.</small></label>
    <div className="actions"><button onClick={close}>Cancel</button><button className={destructive ? "danger" : "primary"} disabled={busy || confirmDisabled || (requireNote && note.trim().length < 10)} onClick={() => void submit(note)}>{busy ? "Working…" : confirmLabel}</button></div>
  </section></div>;
}
