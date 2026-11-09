import type { Session, Snapshot } from './models';

/**
 * Similarity measures for comparing students' work with each other: C code
 * (MOSS-style fingerprints), short written answers, and blocks of code added
 * in one large edit. Pure and browser-safe. The scores say how much two pieces
 * of work have in common; they do not say why.
 */

// ---------------------------------------------------------------- C tokens

export type TokenKind = 'identifier' | 'keyword' | 'number' | 'string' | 'char' | 'operator';

export interface CToken {
  text: string;
  kind: TokenKind;
  /** 1-based line the token starts on. */
  line: number;
}

const KEYWORDS = new Set([
  'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extern',
  'float', 'for', 'goto', 'if', 'inline', 'int', 'long', 'register', 'restrict', 'return', 'short', 'signed',
  'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while', 'bool',
  '_Bool', 'true', 'false', 'NULL', 'size_t'
]);

const OPERATORS = [
  '>>=', '<<=', '...', '->', '++', '--', '&&', '||', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '&=',
  '|=', '^=', '<<', '>>'
];

/**
 * Splits C source into tokens. Comments, whitespace and preprocessor lines
 * (#include, #define, ...) are skipped, so formatting and headers do not count
 * towards similarity.
 */
export function tokenizeC(source: string): CToken[] {
  const tokens: CToken[] = [];
  let i = 0;
  let line = 1;
  let atLineStart = true;
  const n = source.length;

  while (i < n) {
    const c = source[i];
    if (c === '\n') {
      line++;
      i++;
      atLineStart = true;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') {
      i++;
      continue;
    }
    if (atLineStart && c === '#') {
      // Preprocessor line, including backslash continuations.
      while (i < n && source[i] !== '\n') {
        if (source[i] === '\\' && source[i + 1] === '\n') {
          line++;
          i += 2;
          continue;
        }
        i++;
      }
      continue;
    }
    atLineStart = false;

    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const start = i;
      const startLine = line;
      i++;
      while (i < n && source[i] !== c && source[i] !== '\n') {
        if (source[i] === '\\') i++;
        i++;
      }
      i++;
      tokens.push({ text: source.slice(start, i), kind: c === '"' ? 'string' : 'char', line: startLine });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      const start = i;
      while (i < n && /[0-9A-Za-z_.]/.test(source[i])) i++;
      tokens.push({ text: source.slice(start, i), kind: 'number', line });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_]/.test(source[i])) i++;
      const text = source.slice(start, i);
      tokens.push({ text, kind: KEYWORDS.has(text) ? 'keyword' : 'identifier', line });
      continue;
    }
    const op = OPERATORS.find((o) => source.startsWith(o, i)) ?? c;
    tokens.push({ text: op, kind: 'operator', line });
    i += op.length;
  }
  return tokens;
}

// ---------------------------------------------------------------- fingerprints

/** Tokens per fingerprint. Long enough that ordinary shared idioms rarely match. */
export const EXACT_K = 8;
export const STRUCTURAL_K = 12;
/** Winnowing window: one fingerprint is kept from every 4 consecutive k-grams. */
export const WINNOW_WINDOW = 4;

interface Fingerprint {
  hash: number;
  firstLine: number;
  lastLine: number;
}

function tokenKey(token: CToken, structural: boolean): string {
  if (!structural) return token.text;
  switch (token.kind) {
    case 'identifier':
      return 'id';
    case 'number':
      return 'num';
    case 'string':
    case 'char':
      return 'str';
    default:
      return token.text;
  }
}

/** FNV-1a, 32-bit: deterministic and fast enough for student-sized files. */
function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function kgrams(tokens: CToken[], k: number, structural: boolean): Fingerprint[] {
  const keys = tokens.map((t) => tokenKey(t, structural));
  const grams: Fingerprint[] = [];
  for (let i = 0; i + k <= tokens.length; i++) {
    grams.push({
      hash: hashString(keys.slice(i, i + k).join('\u0001')),
      firstLine: tokens[i].line,
      lastLine: tokens[i + k - 1].line
    });
  }
  return grams;
}

/** MOSS winnowing: the smallest hash in each window (rightmost on ties). */
function winnow(grams: Fingerprint[], window: number): Fingerprint[] {
  if (grams.length <= window) return grams;
  const chosen = new Set<number>();
  for (let start = 0; start + window <= grams.length; start++) {
    let best = start;
    for (let i = start; i < start + window; i++) {
      if (grams[i].hash <= grams[best].hash) best = i;
    }
    chosen.add(best);
  }
  return [...chosen].sort((a, b) => a - b).map((i) => grams[i]);
}

function fingerprints(source: string, k: number, structural: boolean, starter: Set<number>): Fingerprint[] {
  return winnow(kgrams(tokenizeC(source), k, structural), WINNOW_WINDOW).filter((f) => !starter.has(f.hash));
}

/** Every k-gram of the starter code, so all of it is removed, not just its winnowed sample. */
function starterHashes(starterCode: string | undefined, k: number, structural: boolean): Set<number> {
  if (!starterCode) return new Set();
  return new Set(kgrams(tokenizeC(starterCode), k, structural).map((g) => g.hash));
}

export interface CodeComparison {
  /** 0-1: share of matching token fingerprints with identifiers kept (copying with the same names). */
  exact: number;
  /** 0-1: same, with identifiers, numbers and strings normalised (survives renaming). */
  structural: number;
  /** 1-based lines in each file covered by matching structural fingerprints. */
  matchedLinesA: number[];
  matchedLinesB: number[];
}

/**
 * Compares two C files. Each score is containment: shared fingerprints divided
 * by the fingerprints of the smaller file, so a small file copied into a large
 * one still scores high. Anything also in `starterCode` is ignored on both sides.
 * Files shorter than one fingerprint (about a dozen tokens) score 0.
 */
export function compareCode(a: string, b: string, options: { starterCode?: string } = {}): CodeComparison {
  const score = (k: number, structural: boolean) => {
    const starter = starterHashes(options.starterCode, k, structural);
    const fa = fingerprints(a, k, structural, starter);
    const fb = fingerprints(b, k, structural, starter);
    const ha = new Set(fa.map((f) => f.hash));
    const hb = new Set(fb.map((f) => f.hash));
    const smaller = Math.min(ha.size, hb.size);
    let shared = 0;
    ha.forEach((h) => hb.has(h) && shared++);
    return { value: smaller === 0 ? 0 : shared / smaller, fa, fb, ha, hb };
  };

  const exact = score(EXACT_K, false);
  const structural = score(STRUCTURAL_K, true);
  const lines = (prints: Fingerprint[], other: Set<number>) => {
    const covered = new Set<number>();
    for (const f of prints) {
      if (other.has(f.hash)) {
        for (let l = f.firstLine; l <= f.lastLine; l++) covered.add(l);
      }
    }
    return [...covered].sort((x, y) => x - y);
  };

  return {
    exact: round(exact.value),
    structural: round(structural.value),
    matchedLinesA: lines(structural.fa, structural.hb),
    matchedLinesB: lines(structural.fb, structural.ha)
  };
}

// ---------------------------------------------------------------- answers

const STOPWORDS = new Set(
  (
    'a an the and or but if then so of to in on at by for with from as is are was were be been being it its this that ' +
    'these those i me my we our you your he she they them their do does did dont not no yes have has had will would ' +
    'can could should just there here what which who when where why how than also into out up because about'
  ).split(' ')
);

/** Answers shorter than this many words are damped: two identical "I don't know"s are not a match. */
const SHORT_ANSWER_WORDS = 6;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9_]+/)
    .filter(Boolean);
}

function shingles(list: string[], n: number): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i + n <= list.length; i++) set.add(list.slice(i, i + n).join(' '));
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  a.forEach((x) => b.has(x) && shared++);
  return shared / (a.size + b.size - shared);
}

function cosine(a: string[], b: string[]): number {
  const count = (list: string[]) => {
    const m = new Map<string, number>();
    list.forEach((w) => m.set(w, (m.get(w) ?? 0) + 1));
    return m;
  };
  const ca = count(a.filter((w) => !STOPWORDS.has(w)));
  const cb = count(b.filter((w) => !STOPWORDS.has(w)));
  if (ca.size === 0 || cb.size === 0) return 0;
  let dot = 0;
  ca.forEach((v, w) => (dot += v * (cb.get(w) ?? 0)));
  const norm = (m: Map<string, number>) => Math.sqrt([...m.values()].reduce((t, v) => t + v * v, 0));
  return dot / (norm(ca) * norm(cb));
}

export interface TextComparison {
  score: number;
  sharedPhrases: string[];
}

/**
 * Compares two short written answers: the larger of word 3-gram overlap
 * (Jaccard) and word-frequency cosine over content words. Very short answers
 * are damped, since short stock phrases match by chance. sharedPhrases are the
 * longest runs of four or more words both answers contain, as written in `a`.
 */
export function compareText(a: string, b: string): TextComparison {
  const wa = words(a);
  const wb = words(b);
  const raw = Math.max(jaccard(shingles(wa, 3), shingles(wb, 3)), cosine(wa, wb));
  const shortest = Math.min(wa.length, wb.length);
  const damping = shortest < SHORT_ANSWER_WORDS ? shortest / 8 : 1;
  return { score: round(Math.min(1, raw * damping)), sharedPhrases: sharedPhrases(a, wb) };
}

function sharedPhrases(original: string, other: string[]): string[] {
  const originalWords = original.split(/\s+/).filter(Boolean);
  const normalized = originalWords.map((w) => words(w).join(''));
  const runs: { start: number; length: number }[] = [];
  // Longest common word runs, by dynamic programming over the two word lists.
  let prev = new Array(other.length + 1).fill(0);
  for (let i = 1; i <= normalized.length; i++) {
    const row = new Array(other.length + 1).fill(0);
    for (let j = 1; j <= other.length; j++) {
      if (normalized[i - 1] && normalized[i - 1] === other[j - 1]) {
        row[j] = prev[j - 1] + 1;
        const endsHere = i === normalized.length || j === other.length || normalized[i] !== other[j];
        if (endsHere && row[j] >= 4) runs.push({ start: i - row[j], length: row[j] });
      }
    }
    prev = row;
  }
  runs.sort((x, y) => y.length - x.length || x.start - y.start);
  const used = new Set<number>();
  const phrases: string[] = [];
  for (const run of runs) {
    const indexes = Array.from({ length: run.length }, (_, k) => run.start + k);
    if (indexes.some((k) => used.has(k))) continue;
    indexes.forEach((k) => used.add(k));
    phrases.push(originalWords.slice(run.start, run.start + run.length).join(' '));
    if (phrases.length === 3) break;
  }
  return phrases;
}

// ---------------------------------------------------------------- inserted blocks

export interface InsertedBlock {
  text: string;
  sessionId: string;
  /** Session time (ms) of the edit. */
  at: number;
  filePath: string;
  chars: number;
}

/**
 * Code added in one large edit (paste, autocomplete, formatting), found from
 * snapshots whose edit data reports at least `minChars` bulk-inserted
 * characters. The inserted region is what differs between the file before and
 * after, found by trimming their common start and end.
 */
export function bulkInsertedBlocks(sessions: Session[], minChars = 80): InsertedBlock[] {
  const blocks: InsertedBlock[] = [];
  for (const session of sessions) {
    const previous = new Map<string, string>();
    const ordered: Snapshot[] = [...session.snapshots].sort((x, y) => x.timestamp - y.timestamp);
    for (const snap of ordered) {
      const before = previous.get(snap.filePath) ?? '';
      previous.set(snap.filePath, snap.content);
      if (!snap.edit || snap.edit.bulkInsertedChars < minChars) continue;
      const text = insertedRegion(before, snap.content).trim();
      if (text) {
        blocks.push({ text, sessionId: session.id, at: snap.timestamp, filePath: snap.filePath, chars: text.length });
      }
    }
  }
  return blocks;
}

function insertedRegion(before: string, after: string): string {
  let prefix = 0;
  const max = Math.min(before.length, after.length);
  while (prefix < max && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < max - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  return after.slice(prefix, after.length - suffix);
}

export interface BlockMatch {
  /** Indexes into the two block lists. */
  a: number;
  b: number;
  score: number;
  /** True when the blocks match in structure but their names differ. */
  renamed: boolean;
}

/** Minimum exact similarity for two inserted blocks to count as the same block. */
const BLOCK_MATCH_MIN = 0.6;
/** Structure this close counts as the same block with names changed. */
const BLOCK_STRUCTURE_MIN = 0.9;

/**
 * Pairs of inserted blocks that are essentially the same code: identical
 * after normalising whitespace, or exact similarity of at least 0.6.
 * score is the best pair's similarity (0 if none).
 */
export function compareInsertedBlocks(a: InsertedBlock[], b: InsertedBlock[]): { score: number; matches: BlockMatch[] } {
  const matches: BlockMatch[] = [];
  a.forEach((ba, i) => {
    b.forEach((bb, j) => {
      const same = ba.text.replace(/\s+/g, ' ') === bb.text.replace(/\s+/g, ' ');
      const code = same ? null : compareCode(ba.text, bb.text);
      // A block pasted with a few names changed is still the same block: count
      // near-identical structure as well as matching tokens.
      const score = same ? 1 : Math.max(code!.exact, code!.structural >= BLOCK_STRUCTURE_MIN ? code!.structural : 0);
      const renamed = !same && code!.exact < BLOCK_MATCH_MIN;
      if (score >= BLOCK_MATCH_MIN) matches.push({ a: i, b: j, score, renamed });
    });
  });
  matches.sort((x, y) => y.score - x.score || x.a - y.a || x.b - y.b);
  return { score: matches[0]?.score ?? 0, matches };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
