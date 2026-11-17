/**
 * Line diff for the short before/after excerpts shown next to a question, so
 * the student can see exactly which lines changed. Excerpts are a few dozen
 * lines at most, so a plain LCS table is fast enough.
 */

/** A piece of a line: `changed` pieces are what differs from the matching line on the other side. */
export interface Span {
  text: string;
  changed: boolean;
}

export interface DiffLine {
  /** Kept on both sides, removed from before, or added in after. */
  kind: 'same' | 'removed' | 'added';
  /** The line split into spans; a modified line marks only the characters that changed. */
  spans: Span[];
}

export interface ExcerptDiff {
  before: DiffLine[];
  after: DiffLine[];
  /** True when nothing differs except, possibly, whitespace at line ends. */
  identical: boolean;
}

export function splitLines(code: string): string[] {
  return code.replace(/\r?\n$/, '').split(/\r?\n/);
}

const norm = (line: string) => line.trimEnd();

export function diffExcerpts(before: string, after: string): ExcerptDiff {
  const a = splitLines(before);
  const b = splitLines(after);
  // lcs[i][j]: longest common subsequence of a[i..] and b[j..].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = norm(a[i]) === norm(b[j]) ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const left: DiffLine[] = [];
  const right: DiffLine[] = [];
  // Removed and added lines waiting to be paired up, so a modified line shows its changed characters.
  let removed: string[] = [];
  let added: string[] = [];
  const flush = () => {
    const pairs = Math.min(removed.length, added.length);
    removed.forEach((line, k) => {
      left.push({ kind: 'removed', spans: k < pairs ? changedSpans(line, added[k]).a : [{ text: line, changed: true }] });
    });
    added.forEach((line, k) => {
      right.push({ kind: 'added', spans: k < pairs ? changedSpans(removed[k], line).b : [{ text: line, changed: true }] });
    });
    removed = [];
    added = [];
  };

  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && norm(a[i]) === norm(b[j])) {
      flush();
      left.push({ kind: 'same', spans: [{ text: a[i], changed: false }] });
      right.push({ kind: 'same', spans: [{ text: b[j], changed: false }] });
      i++;
      j++;
    } else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      added.push(b[j++]);
    } else {
      removed.push(a[i++]);
    }
  }
  flush();
  const identical = left.every((l) => l.kind === 'same') && right.every((l) => l.kind === 'same');
  return { before: left, after: right, identical };
}

/**
 * Marks the middle part that differs between two versions of a line, keeping
 * the common start and end plain. Lines that share little are marked whole.
 */
export function changedSpans(x: string, y: string): { a: Span[]; b: Span[] } {
  let start = 0;
  while (start < x.length && start < y.length && x[start] === y[start]) start++;
  let end = 0;
  while (end < x.length - start && end < y.length - start && x[x.length - 1 - end] === y[y.length - 1 - end]) end++;
  const shared = start + end;
  // Little in common (ignoring indentation): show the whole line as changed.
  const content = Math.max(x.trim().length, y.trim().length, 1);
  if (shared - Math.min(leading(x), leading(y)) < content * 0.3) {
    return { a: [{ text: x, changed: true }], b: [{ text: y, changed: true }] };
  }
  const pieces = (s: string): Span[] =>
    [
      { text: s.slice(0, start), changed: false },
      { text: s.slice(start, s.length - end), changed: true },
      { text: s.slice(s.length - end), changed: false }
    ].filter((p) => p.text.length > 0);
  return { a: pieces(x), b: pieces(y) };
}

function leading(s: string): number {
  return s.length - s.trimStart().length;
}
