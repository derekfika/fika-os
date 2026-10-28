/**
 * Compact UK English spellchecker for Menu Planning text.
 *
 * It flags only words it knows to be wrong: US spellings with a UK form, and common
 * culinary misspellings. It does not guess at unknown words, so culinary names and
 * brands are never flagged as misspelt. Coverage is therefore deliberately limited;
 * a full UK dictionary needs a governed dependency and is a follow-up.
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

const WORD = /[A-Za-z][A-Za-z'’]*/g;

/** Words a user has chosen to keep, plus any words added to the dictionary. */
export type SpellcheckOptions = { ignored?: ReadonlySet<string>; addedWords?: ReadonlySet<string> };

function matchCase(source: string, suggestion: string) {
  if (source === source.toUpperCase() && source.length > 1) return suggestion.toUpperCase();
  if (source[0] === source[0].toUpperCase()) return suggestion[0].toUpperCase() + suggestion.slice(1);
  return suggestion;
}

/** Find flagged words in free text. Returned offsets index into `text`. */
export function findSpellingIssues(text: string, options: SpellcheckOptions = {}): SpellFinding[] {
  const findings: SpellFinding[] = [];
  for (const match of text.matchAll(WORD)) {
    const word = match[0];
    const key = word.toLocaleLowerCase("en-GB").replace(/’/g, "'");
    if (options.ignored?.has(key) || options.addedWords?.has(key)) continue;
    const known = KNOWN_CORRECTIONS[key];
    if (!known) continue;
    const start = match.index ?? 0;
    findings.push({
      start,
      end: start + word.length,
      word,
      kind: known.kind,
      suggestions: known.suggestions.map(suggestion => matchCase(word, suggestion)),
    });
  }
  return findings;
}

/** Normalise a word for ignore and dictionary lists. */
export function spellKey(word: string) {
  return word.trim().toLocaleLowerCase("en-GB").replace(/’/g, "'");
}
