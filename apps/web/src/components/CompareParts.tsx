import Link from 'next/link';
import { agreeingSignalNames, type Cohort, type PairComparison, type SignalName } from '@/lib/cohort';

export const SIGNAL_LABELS: Record<SignalName, string> = {
  codeStructural: 'Code structure',
  codeExact: 'Exact code',
  pastedBlock: 'Same inserted block',
  answers: 'Answer wording'
};

export const SIGNAL_HELP: Record<SignalName, string> = {
  codeStructural: 'Share of the code that matches when variable names, numbers and strings are ignored.',
  codeExact: 'Share of the code that matches token for token, names included.',
  pastedBlock: 'A block of code added in one edit (paste, autocomplete or formatting) that appears in both recordings.',
  answers: 'How alike the closest pair of written answers is.'
};

export function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

/** "3 of 3 agree: code, same inserted block, answer wording", or "Code only". */
export function agreementText(pair: PairComparison): string {
  const names = agreeingSignalNames(pair);
  if (names.length === 0) return 'No strong signal';
  if (names.length === 1) return `${names[0][0].toUpperCase()}${names[0].slice(1)} only`;
  return `${names.length} of 3 agree: ${names.join(', ')}`;
}

/** 0-4: how strongly to shade a matrix cell or chip. */
export function shade(value: number | null): number {
  if (value === null) return 0;
  if (value >= 0.85) return 4;
  if (value >= 0.7) return 3;
  if (value >= 0.5) return 2;
  return 1;
}

export function pairHref(pair: PairComparison): string {
  return `/instructor/compare/${pair.a.submissionId}/${pair.b.submissionId}`;
}

/**
 * Student × student grid. Each cell counts the kinds of evidence that are high
 * for the pair (code, the same inserted block, answer wording), so pairs where
 * several agree stand out even when everyone's code is alike; it opens the pair.
 */
export function CompareMatrix({ cohort }: { cohort: Cohort }) {
  const find = (x: string, y: string) =>
    cohort.pairs.find(
      (p) => (p.a.submissionId === x && p.b.submissionId === y) || (p.a.submissionId === y && p.b.submissionId === x)
    );
  return (
    <div className="table-wrap">
      <table className="compare-matrix">
        <caption className="sr-only">Strongest similarity signal for each pair of students</caption>
        <thead>
          <tr>
            <td />
            {cohort.students.map((s) => (
              <th key={s.submissionId} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cohort.students.map((row) => (
            <tr key={row.submissionId}>
              <th scope="row">{row.name}</th>
              {cohort.students.map((col) => {
                if (row.submissionId === col.submissionId) {
                  return <td key={col.submissionId} className="compare-cell compare-self" aria-label="Same student" />;
                }
                const pair = find(row.submissionId, col.submissionId);
                if (!pair) return <td key={col.submissionId} className="compare-cell" />;
                const agreeing = agreeingSignalNames(pair).length;
                return (
                  <td key={col.submissionId} className={`compare-cell agree-${agreeing}`}>
                    <Link
                      href={`/instructor/compare/${row.submissionId}/${col.submissionId}`}
                      aria-label={`${row.name} and ${col.name}: ${agreementText(pair)}`}
                      title={agreementText(pair)}
                    >
                      <span className="agree-dots" aria-hidden="true">
                        {[0, 1, 2].map((i) => (
                          <span key={i} className={i < agreeing ? 'on' : ''} />
                        ))}
                      </span>
                    </Link>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One chip per signal; outlined when it is clearly above what is typical for the class. */
export function SignalChips({ pair }: { pair: PairComparison }) {
  return (
    <div className="signal-chips">
      {(Object.keys(SIGNAL_LABELS) as SignalName[]).map((name) => {
        const value = pair.signals[name];
        return (
          <span
            key={name}
            className={`signal-chip shade-${shade(value)} ${pair.aboveTypical[name] ? 'above-typical' : ''}`}
            title={`${SIGNAL_HELP[name]}${pair.aboveTypical[name] ? ' Clearly above what is typical for this class.' : ''}`}
          >
            <span className="signal-chip-label">{SIGNAL_LABELS[name]}</span> {pct(value)}
            {pair.aboveTypical[name] && <span className="signal-chip-flag"> · above typical</span>}
          </span>
        );
      })}
    </div>
  );
}

/** Marks every occurrence of the given phrases in a text (case-insensitive). */
export function MarkPhrases({ text, phrases }: { text: string; phrases: string[] }) {
  const wanted = phrases.map((p) => p.trim()).filter((p) => p.length > 0);
  if (wanted.length === 0) return <>{text}</>;
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const phrase of wanted) {
    const needle = phrase.toLowerCase();
    let from = 0;
    for (let at = lower.indexOf(needle, from); at !== -1; at = lower.indexOf(needle, from)) {
      ranges.push([at, at + needle.length]);
      from = at + needle.length;
    }
  }
  ranges.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r]);
  }
  const parts: React.ReactNode[] = [];
  let pos = 0;
  merged.forEach(([start, end], i) => {
    if (start > pos) parts.push(text.slice(pos, start));
    parts.push(<mark key={i}>{text.slice(start, end)}</mark>);
    pos = end;
  });
  if (pos < text.length) parts.push(text.slice(pos));
  return <>{parts}</>;
}

/** A code file with matched lines highlighted and numbered. */
export function NumberedCode({ code, highlight }: { code: string; highlight: number[] }) {
  const marked = new Set(highlight);
  const lines = code.replace(/\n$/, '').split(/\r?\n/);
  return (
    <pre className="compare-code">
      {lines.map((line, i) => (
        <span key={i} className={`compare-line ${marked.has(i + 1) ? 'matched' : ''}`}>
          <span className="compare-ln" aria-hidden="true">
            {i + 1}
          </span>
          {line || ' '}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}
