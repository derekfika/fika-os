"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { findSpellingIssues, spellKey, type SpellFinding, type SpellerLike } from "@/lib/menu-spellcheck";
import PlannerModal from "./planner-modal";

/**
 * Per-browser spelling lists. Ignoring or adding a word is advisory and never changes
 * dish text, canonical IDs, allergen evidence or published history. Storage can be
 * unavailable (private windows, blocked storage), so every access is guarded.
 */
const STORAGE_KEY = "fika-menu-spellcheck-v1";
type SpellLists = { ignored: string[]; added: string[] };
const EMPTY: SpellLists = { ignored: [], added: [] };

function readLists(): SpellLists {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null") as Partial<SpellLists> | null;
    const words = (value: unknown) => Array.isArray(value) ? value.filter((word): word is string => typeof word === "string").map(spellKey) : [];
    return { ignored: words(parsed?.ignored), added: words(parsed?.added) };
  } catch {
    return EMPTY;
  }
}

function writeLists(lists: SpellLists) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
  } catch {
    // Storage unavailable: the change lasts for this view only.
  }
}

export function useSpellcheckLists() {
  const [lists, setLists] = useState<SpellLists>(EMPTY);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setLists(readLists()); setHydrated(true); }, []);
  useEffect(() => { if (hydrated) writeLists(lists); }, [hydrated, lists]);
  const ignored = useMemo(() => new Set(lists.ignored), [lists.ignored]);
  const added = useMemo(() => new Set(lists.added), [lists.added]);
  return {
    ignored,
    added,
    ignore: (word: string) => setLists(current => ({ ...current, ignored: [...new Set([...current.ignored, spellKey(word)])] })),
    addWord: (word: string) => setLists(current => ({ ...current, added: [...new Set([...current.added, spellKey(word)])] })),
  };
}

export type SpellingDictionary = { speller?: SpellerLike; status: "loading" | "ready" | "unavailable"; retry: () => void };
export function useSpellingDictionary(): SpellingDictionary {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<SpellingDictionary, "retry">>({ status: "loading" });
  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    void import("@/lib/dictionary/client").then(module => module.loadEnGbSpeller(attempt > 0))
      .then(speller => { if (active) setState({ status: "ready", speller }); })
      .catch(() => { if (active) setState({ status: "unavailable" }); });
    return () => { active = false; };
  }, [attempt]);
  return { ...state, retry: () => setAttempt(value => value + 1) };
}

/** A dish name with flagged words underlined. Plain text only, so it sits safely inside buttons. */
export function SpellUnderlinedText({ text, ignored, added, speller }: { text: string; ignored: ReadonlySet<string>; added: ReadonlySet<string>; speller?: SpellerLike }) {
  const findings = useMemo(() => findSpellingIssues(text, { ignored, addedWords: added, speller }), [text, ignored, added, speller]);
  if (!findings.length) return <>{text}</>;
  const parts: Array<string | { finding: SpellFinding }> = [];
  let cursor = 0;
  for (const finding of findings) {
    if (finding.start > cursor) parts.push(text.slice(cursor, finding.start));
    parts.push({ finding });
    cursor = finding.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts.map((part, index) => typeof part === "string"
    ? <span key={index}>{part}</span>
    : <span key={index} className="spell-flag" title={`Possible spelling: ${part.finding.suggestions.join(" or ")}`}>{part.finding.word}</span>)}</>;
}

export type SpellPanelItem = { entryId: string; dayId: string; dishLabel: string; dayName: string; slot: string; replaceable: boolean };

/**
 * Compact list of flagged dish names with suggestions. Replacement is explicit and
 * limited to the selected editable draft occurrence through the caller's versioned command.
 */
export function SpellcheckPanel({ items, ignored, added, dictionary, onIgnore, onAddWord, onReplace, onClose }: {
  items: SpellPanelItem[];
  ignored: ReadonlySet<string>;
  added: ReadonlySet<string>;
  dictionary: SpellingDictionary;
  onIgnore: (word: string) => void;
  onAddWord: (word: string) => void;
  onReplace: (item: SpellPanelItem, finding: SpellFinding, replacement: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState<{ item: SpellPanelItem; finding: SpellFinding; replacement: string }>();
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const rows = useMemo(() => items.flatMap(item => findSpellingIssues(item.dishLabel, { ignored, addedWords: added, speller: dictionary.speller }).map(finding => ({ item, finding }))), [items, ignored, added, dictionary.speller]);
  return <PlannerModal title="Spelling suggestions" className="spell-panel" onClose={onClose}>
    <header className="spell-panel-header">
      <strong>Spelling suggestions</strong>
      <button ref={closeButton} type="button" className="modal-close" onClick={onClose} aria-label="Close spelling suggestions">Close</button>
    </header>
    {dictionary.status === "loading" && <p role="status">Loading the UK spelling dictionary… Common corrections are available.</p>}
    {dictionary.status === "unavailable" && <div role="alert"><p>The UK spelling dictionary is unavailable. Only common corrections are checked.</p><button type="button" className="button button-soft" onClick={dictionary.retry}>Retry dictionary</button></div>}
    {rows.length === 0 && <p className="form-help">{dictionary.status === "ready" ? "No spelling suggestions for this week." : "No common spelling suggestions for this week."}</p>}
    <ul className="spell-panel-list">
      {rows.map(({ item, finding }, index) => <li key={`${item.entryId}-${finding.start}-${index}`}>
        <div className="spell-panel-row">
          <span className="spell-flag">{finding.word}</span>
          <span aria-hidden="true">→</span>
          <strong>{finding.suggestions[0]}</strong>
        </div>
        {finding.suggestions.length > 1 && <p className="form-help">Also: {finding.suggestions.slice(1).join(" · ")}</p>}
        <small>{item.dayName} · {item.slot} · {item.dishLabel}</small>
        {item.replaceable && <div className="spell-panel-actions">
          {finding.suggestions.map(suggestion => <button key={suggestion} type="button" className="button button-soft" disabled={saving} onClick={() => { setFeedback(""); setPending({ item, finding, replacement: suggestion }); }}>{`Replace with ${suggestion}`}</button>)}
        </div>}
        {pending?.item.entryId === item.entryId && pending.finding.start === finding.start && <div className="spell-replace-confirm" role="group" aria-label="Confirm draft spelling replacement">
          <p>Replace this word in this draft menu row only? The Dish Library and published history stay unchanged. Changing the dish name may invalidate this row’s allergen review, which must then be completed again.</p>
          <div className="spell-panel-actions"><button type="button" className="button button-soft" disabled={saving} onClick={() => { setPending(undefined); closeButton.current?.focus(); }}>Cancel</button><button type="button" className="button button-primary" disabled={saving} onClick={async () => { setSaving(true); setFeedback(""); try { if (await onReplace(pending.item, pending.finding, pending.replacement)) { setPending(undefined); setFeedback(`Updated this draft row to “${pending.replacement}”.`); closeButton.current?.focus(); } } finally { setSaving(false); } }}>{saving ? "Replacing…" : `Confirm replacement`}</button></div>
        </div>}
        <div className="spell-panel-actions">
          <button type="button" className="button button-soft" aria-label={`Ignore ${finding.word} in spelling checks`} onClick={() => { onIgnore(finding.word); closeButton.current?.focus(); }}>Ignore</button>
          <button type="button" className="button button-soft" aria-label={`Add ${finding.word} to this browser's dictionary`} onClick={() => { onAddWord(finding.word); closeButton.current?.focus(); }}>Add to dictionary</button>
        </div>
      </li>)}
    </ul>
    {feedback && <p role="status" className="form-help">{feedback}</p>}
    <p className="form-help">Replace changes only the selected editable draft row through the versioned menu update. The canonical dish ID, portions and allocations stay in place. Published or locked rows cannot be replaced here. Ignore and dictionary choices apply only in this browser.</p>
  </PlannerModal>;
}

/** Small touch/hover/focus entry point; actions remain outside the dish-selection button. */
export function InlineSpellPopover({ item, ignored, added, dictionary, onReplace, onIgnore, onAddWord }: {
  item: SpellPanelItem;
  ignored: ReadonlySet<string>;
  added: ReadonlySet<string>;
  dictionary?: SpellerLike;
  onReplace: (item: SpellPanelItem, finding: SpellFinding, replacement: string) => Promise<boolean>;
  onIgnore: (word: string) => void;
  onAddWord: (word: string) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const findings = useMemo(() => findSpellingIssues(item.dishLabel, { ignored, addedWords: added, speller: dictionary }), [item.dishLabel, ignored, added, dictionary]);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{ finding: SpellFinding; replacement: string }>();
  const [saving, setSaving] = useState(false);
  const finding = findings[0];
  if (!finding) return null;
  const returnFocusToCell = () => window.setTimeout(() => trigger.current?.closest(".week-menu-cell")?.querySelector<HTMLButtonElement>(".week-menu-cell-button")?.focus(), 0);
  const replace = async () => {
    if (!pending) return;
    setSaving(true);
    try { if (await onReplace(item, pending.finding, pending.replacement)) { setPending(undefined); setOpen(false); returnFocusToCell(); } }
    finally { setSaving(false); }
  };
  return <div className="spell-inline" onMouseEnter={() => setOpen(true)} onMouseLeave={() => { if (!pending) setOpen(false); }} onFocusCapture={() => setOpen(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && !pending) setOpen(false); }}>
    <button ref={trigger} type="button" className="spell-inline-trigger" aria-expanded={open} aria-label={`Spelling suggestions for ${item.dishLabel}`} onClick={() => setOpen(value => !value)}><span aria-hidden="true">Aa</span><span className="sr-only">Spelling suggestions</span></button>
    {open && <div className="spell-inline-popover" role="region" aria-label={`Spelling suggestions for ${item.dishLabel}`}>
      <strong>{finding.word}</strong><span aria-hidden="true"> → </span>{finding.suggestions.map(suggestion => <button key={suggestion} type="button" className="spell-inline-option" disabled={!item.replaceable} onClick={() => setPending({ finding, replacement: suggestion })}>{suggestion}</button>)}
      {pending && <div className="spell-inline-confirm"><p>Replace in this draft row only? Allergen review may need to be completed again.</p><button type="button" className="spell-inline-option" disabled={saving} onClick={() => setPending(undefined)}>Cancel</button><button type="button" className="spell-inline-option" disabled={saving} onClick={() => void replace()}>{saving ? "Replacing…" : "Confirm Replace"}</button></div>}
      <div className="spell-inline-actions"><button type="button" className="spell-inline-option" onClick={() => { onIgnore(finding.word); setOpen(false); returnFocusToCell(); }}>Ignore</button><button type="button" className="spell-inline-option" onClick={() => { onAddWord(finding.word); setOpen(false); returnFocusToCell(); }}>Add to dictionary</button></div>
      {!item.replaceable && <p className="form-help">This row is published or locked. Use Dish Library to edit canonical names.</p>}
    </div>}
  </div>;
}
