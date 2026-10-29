/**
 * UK English spellchecker for Menu Planning text.
 *
 * Two layers:
 *  1. Known corrections (US spellings and common culinary misspellings) always apply and are
 *     offered first with their UK form.
 *  2. An optional en_GB speller (Hunspell, loaded from the governed dictionary package). When
 *     supplied, words it does not recognise are flagged with ranked suggestions. Acronyms,
 *     numbers, CamelCase and possessive or apostrophe forms are not judged, which keeps false
 *     positives on brands and chef terminology low.
 *
 * Checks are advisory. Nothing here changes text; callers decide what to replace.
 */

export type SpellFindingKind = "us-spelling" | "misspelling";

export type SpellFinding = {
  start: number;
  end: number;
  word: string;
  kind: SpellFindingKind;
  suggestions: string[];
};

/** The subset of an nspell-style speller this module uses. */
export type SpellerLike = { correct(word: string): boolean; suggest(word: string): string[] };

/** Known wrong form (lower case) to the UK form(s) to offer. */
const KNOWN_CORRECTIONS: Record<string, { kind: SpellFindingKind; suggestions: string[] }> = {
  // US spellings with UK forms.
  color: { kind: "us-spelling", suggestions: ["colour"] },
  flavor: { kind: "us-spelling", suggestions: ["flavour"] },
  favorite: { kind: "us-spelling", suggestions: ["favourite"] },
  honor: { kind: "us-spelling", suggestions: ["honour"] },
  center: { kind: "us-spelling", suggestions: ["centre"] },
  caramelize: { kind: "us-spelling", suggestions: ["caramelise"] },
  caramelized: { kind: "us-spelling", suggestions: ["caramelised"] },
  caramelizing: { kind: "us-spelling", suggestions: ["caramelising"] },
  sauteed: { kind: "us-spelling", suggestions: ["sautéed"] },
  mold: { kind: "us-spelling", suggestions: ["mould"] },
  fiber: { kind: "us-spelling", suggestions: ["fibre"] },
  liter: { kind: "us-spelling", suggestions: ["litre"] },
  gray: { kind: "us-spelling", suggestions: ["grey"] },
  catalog: { kind: "us-spelling", suggestions: ["catalogue"] },
  lasagna: { kind: "us-spelling", suggestions: ["lasagne"] },
  yogurt: { kind: "us-spelling", suggestions: ["yoghurt", "yogurt"] },
  // Common culinary misspellings.
  sicilion: { kind: "misspelling", suggestions: ["Sicilian"] },
  tomatos: { kind: "misspelling", suggestions: ["tomatoes"] },
  vinagrette: { kind: "misspelling", suggestions: ["vinaigrette"] },
  bechamel: { kind: "misspelling", suggestions: ["béchamel"] },
  veloute: { kind: "misspelling", suggestions: ["velouté"] },
  mayonaise: { kind: "misspelling", suggestions: ["mayonnaise"] },
  parmesean: { kind: "misspelling", suggestions: ["Parmesan"] },
  mozarella: { kind: "misspelling", suggestions: ["mozzarella"] },
  brocolli: { kind: "misspelling", suggestions: ["broccoli"] },
  cauliflour: { kind: "misspelling", suggestions: ["cauliflower"] },
  aubergene: { kind: "misspelling", suggestions: ["aubergine"] },
  coriender: { kind: "misspelling", suggestions: ["coriander"] },
  tumeric: { kind: "misspelling", suggestions: ["turmeric"] },
  bisquit: { kind: "misspelling", suggestions: ["biscuit"] },
  rosemarry: { kind: "misspelling", suggestions: ["rosemary"] },
  cucumbr: { kind: "misspelling", suggestions: ["cucumber"] },
  reciepe: { kind: "misspelling", suggestions: ["recipe"] },
};

// Letters (including accents) with apostrophes inside a word, so "chef's" and "crème" are single tokens.
const WORD = /\p{L}[\p{L}\p{M}]*(?:['’]\p{L}[\p{L}\p{M}]*)*/gu;

/** Words a user has chosen to keep, plus any words added to the dictionary. */
export type SpellcheckOptions = { ignored?: ReadonlySet<string>; addedWords?: ReadonlySet<string>; speller?: SpellerLike | null };

function matchCase(source: string, suggestion: string) {
  if (source === source.toUpperCase() && source.length > 1) return suggestion.toUpperCase();
  if (source[0] === source[0].toUpperCase()) return suggestion[0].toUpperCase() + suggestion.slice(1);
  return suggestion;
}

/**
 * Words the dictionary layer does not judge: acronyms, numbers, CamelCase, very short words and
 * apostrophe forms other than a plain possessive. These are the main source of false positives.
 */
export function isDictionaryCandidate(word: string) {
  const base = word.replace(/['’]s$/i, "");
  if (base.length < 3) return false;
  if (/['’]/.test(base)) return false;
  if (base === base.toUpperCase()) return false;
  if (/\p{Ll}\p{Lu}/u.test(base)) return false;
  return true;
}

/** Speller suggestions in their own order, without duplicates or the word itself, matched to the source casing. */
function rankSuggestions(word: string, speller: SpellerLike) {
  const seen = new Set<string>([word.toLocaleLowerCase("en-GB")]);
  const ranked: string[] = [];
  for (const item of speller.suggest(word)) {
    const key = item.toLocaleLowerCase("en-GB");
    if (seen.has(key)) continue;
    seen.add(key);
    ranked.push(matchCase(word, item));
    if (ranked.length === 5) break;
  }
  return ranked;
}

/** Normalise a word for ignore and dictionary lists. */
export function spellKey(word: string) {
  return word.trim().toLocaleLowerCase("en-GB").replace(/’/g, "'");
}

/** Find flagged words in free text. Returned offsets index into `text`. */
export function findSpellingIssues(text: string, options: SpellcheckOptions = {}): SpellFinding[] {
  const findings: SpellFinding[] = [];
  for (const match of text.matchAll(WORD)) {
    const word = match[0];
    const key = spellKey(word);
    if (options.ignored?.has(key) || options.addedWords?.has(key)) continue;
    const start = match.index ?? 0;
    const known = KNOWN_CORRECTIONS[key];
    if (known) {
      findings.push({ start, end: start + word.length, word, kind: known.kind, suggestions: known.suggestions.map(suggestion => matchCase(word, suggestion)) });
      continue;
    }
    const speller = options.speller;
    if (!speller || !isDictionaryCandidate(word) || speller.correct(word)) continue;
    // A word with no suggestion cannot be corrected here, so it is not flagged (it can still be added to the dictionary by hand).
    const suggestions = rankSuggestions(word, speller);
    if (suggestions.length) findings.push({ start, end: start + word.length, word, kind: "misspelling", suggestions });
  }
  return findings;
}
