"use client";

import { useEffect, useState } from "react";
import { findSpellingIssues, spellKey, type SpellFinding } from "@/lib/menu-spellcheck";

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
    return { ignored: Array.isArray(parsed?.ignored) ? parsed.ignored : [], added: Array.isArray(parsed?.added) ? parsed.added : [] };
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
  useEffect(() => { setLists(readLists()); }, []);
  const update = (next: SpellLists) => { setLists(next); writeLists(next); };
  return {
    ignored: new Set(lists.ignored),
    added: new Set(lists.added),
    ignore: (word: string) => update({ ...lists, ignored: [...new Set([...lists.ignored, spellKey(word)])] }),
    addWord: (word: string) => update({ ...lists, added: [...new Set([...lists.added, spellKey(word)])] }),
  };
}

/** A dish name with flagged words underlined. Plain text only, so it sits safely inside buttons. */
export function SpellUnderlinedText({ text, ignored, added }: { text: string; ignored: ReadonlySet<string>; added: ReadonlySet<string> }) {
  const findings = findSpellingIssues(text, { ignored, addedWords: added });
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
export function SpellcheckPanel({ items, ignored, added, onIgnore, onAddWord, onClose }: {
  items: SpellPanelItem[];
  ignored: ReadonlySet<string>;
  added: ReadonlySet<string>;
  onIgnore: (word: string) => void;
  onAddWord: (word: string) => void;
  onClose: () => void;
}) {
  const rows = items.flatMap(item => findSpellingIssues(item.dishLabel, { ignored, addedWords: added }).map(finding => ({ item, finding })));
  return <section className="spell-panel" role="dialog" aria-label="Spelling suggestions" onKeyDown={event => { if (event.key === "Escape") onClose(); }}>
    <header className="spell-panel-header">
      <strong>Spelling suggestions</strong>
      <button type="button" className="modal-close" onClick={onClose} aria-label="Close spelling suggestions">Close</button>
    </header>
    {rows.length === 0 && <p className="form-help">No spelling suggestions for this week.</p>}
    <ul className="spell-panel-list">
      {rows.map(({ item, finding }, index) => <li key={`${item.dishLabel}-${finding.start}-${index}`}>
        <div className="spell-panel-row">
          <span className="spell-flag">{finding.word}</span>
          <span aria-hidden="true">→</span>
          <strong>{finding.suggestions[0]}</strong>
        </div>
        <small>{item.dayName} · {item.slot} · {item.dishLabel}</small>
        <div className="spell-panel-actions">
          <button type="button" className="button button-soft" onClick={() => onIgnore(finding.word)}>Ignore</button>
          <button type="button" className="button button-soft" onClick={() => onAddWord(finding.word)}>Add to dictionary</button>
        </div>
      </li>)}
    </ul>
    <p className="form-help">Suggestions do not change dish names. Change a name in the Dish Library, which keeps IDs, allergen evidence and published history.</p>
  </section>;
}
