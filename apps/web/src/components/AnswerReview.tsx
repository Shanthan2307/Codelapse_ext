import type { ReactNode } from 'react';
import type { AnswerEvaluation, EvaluationSet, UnderstandingLevel } from '@/lib/evaluation/types';

export const LEVEL_LABELS: Record<UnderstandingLevel, string> = {
  strong: 'Strong evidence of understanding',
  partial: 'Partial evidence of understanding',
  limited: 'Limited evidence of understanding'
};

const SHORT_LEVEL: Record<UnderstandingLevel, string> = { strong: 'strong', partial: 'partial', limited: 'limited' };

const SCALES: { key: keyof AnswerEvaluation['scores']; label: string; help: string }[] = [
  { key: 'specificity', label: 'Specific', help: 'Refers to concrete details of this code or session, rather than generalities.' },
  { key: 'consistency', label: 'Consistent', help: 'Fits what the submitted code and the recording show.' },
  { key: 'reasoning', label: 'Reasoning', help: 'Explains why, correctly, rather than only what the code does.' }
];

/** "2 strong · 1 partial · 1 limited", leaving out levels with no answers. */
export function LevelCounts({ counts, stacked = false }: { counts: EvaluationSet['counts']; stacked?: boolean }) {
  const parts = (['strong', 'partial', 'limited'] as const).filter((level) => counts[level] > 0);
  if (parts.length === 0) {
    return <span className="muted">No answers reviewed</span>;
  }
  return (
    <span className={stacked ? 'level-counts level-counts-stacked' : 'level-counts'}>
      {parts.map((level, i) => (
        <span key={level} className="level-count">
          {i > 0 && !stacked && <span className="level-sep"> · </span>}
          <span className={`level-dot level-dot-${level}`} aria-hidden="true" />
          {counts[level]} {SHORT_LEVEL[level]}
        </span>
      ))}
    </span>
  );
}

/**
 * The answer text with each evidence quote marked. Quotes are matched without
 * regard to case; any quote that cannot be found is listed underneath instead.
 */
export function HighlightedAnswer({ text, quotes }: { text: string; quotes: string[] }) {
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  const unmatched: string[] = [];
  for (const quote of quotes) {
    const q = quote.trim();
    if (!q) continue;
    const start = lower.indexOf(q.toLowerCase());
    if (start === -1) {
      unmatched.push(q);
    } else {
      ranges.push([start, start + q.length]);
    }
  }
  // Merge overlapping quotes so each character is marked at most once.
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([...range]);
    }
  }
  const pieces: ReactNode[] = [];
  let cursor = 0;
  merged.forEach(([start, end], i) => {
    if (start > cursor) pieces.push(text.slice(cursor, start));
    pieces.push(<mark key={i}>{text.slice(start, end)}</mark>);
    cursor = end;
  });
  if (cursor < text.length) pieces.push(text.slice(cursor));

  return (
    <>
      <p className="answer-readonly">{pieces}</p>
      {unmatched.length > 0 && (
        <ul className="quote-list">
          {unmatched.map((q) => (
            <li key={q}>&ldquo;{q}&rdquo;</li>
          ))}
        </ul>
      )}
    </>
  );
}

/** The evaluator's notes on one answer, shown under it. */
export function AnswerEvaluationView({ evaluation }: { evaluation: AnswerEvaluation }) {
  return (
    <div className="answer-review">
      <div className="answer-review-head">
        <span className={`level level-${evaluation.level}`}>{LEVEL_LABELS[evaluation.level]}</span>
        {!evaluation.addressesQuestion && <span className="level-note">Doesn&apos;t answer the question</span>}
      </div>
      <p className="scores">
        {SCALES.map((scale, i) => (
          <span key={scale.key} title={scale.help} className="score">
            {i > 0 && <span className="level-sep"> · </span>}
            {scale.label} {evaluation.scores[scale.key]}/3
          </span>
        ))}
      </p>
      {evaluation.explanation && <p className="review-explanation">{evaluation.explanation}</p>}
      {evaluation.concerns.length > 0 && (
        <div className="review-concerns">
          <p className="code-name">Worth a look</p>
          <ul>
            {evaluation.concerns.map((concern) => (
              <li key={concern}>{concern}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
