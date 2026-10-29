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

export type SpellPanelItem = { dishLabel: string; dayName: string; slot: string };

/**
 * Compact list of flagged dish names with suggestions. Dish text is changed through the
 * Dish Library, so the panel offers Ignore and Add to dictionary only.
 */
export function SpellcheckPanel({ items, ignored, added, dictionary, onIgnore, onAddWord, onClose }: {
  items: SpellPanelItem[];
  ignored: ReadonlySet<string>;
  added: ReadonlySet<string>;
  dictionary: SpellingDictionary;
  onIgnore: (word: string) => void;
  onAddWord: (word: string) => void;
  onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
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
      {rows.map(({ item, finding }, index) => <li key={`${item.dishLabel}-${finding.start}-${index}`}>
        <div className="spell-panel-row">
          <span className="spell-flag">{finding.word}</span>
          <span aria-hidden="true">→</span>
          <strong>{finding.suggestions[0]}</strong>
        </div>
        {finding.suggestions.length > 1 && <p className="form-help">Also: {finding.suggestions.slice(1).join(" · ")}</p>}
        <small>{item.dayName} · {item.slot} · {item.dishLabel}</small>
        <div className="spell-panel-actions">
          <button type="button" className="button button-soft" aria-label={`Ignore ${finding.word} in spelling checks`} onClick={() => { onIgnore(finding.word); closeButton.current?.focus(); }}>Ignore</button>
          <button type="button" className="button button-soft" aria-label={`Add ${finding.word} to this browser's dictionary`} onClick={() => { onAddWord(finding.word); closeButton.current?.focus(); }}>Add to dictionary</button>
        </div>
      </li>)}
    </ul>
    <p className="form-help">Suggestions do not change dish names. Change a name in the Dish Library, which keeps IDs, allergen evidence and published history. Ignore and dictionary choices apply only in this browser.</p>
  </PlannerModal>;
}
