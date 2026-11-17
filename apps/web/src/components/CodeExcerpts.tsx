import { diffExcerpts, splitLines, type DiffLine } from '@/lib/diff';
import type { QuestionExcerpt } from '@/lib/questions/types';

/**
 * Code shown next to a question or hint. A before/after pair is shown as a
 * diff: removed lines in red, added lines in green, and inside a changed line
 * only the characters that changed are marked, so the student can see exactly
 * what is being compared. A slice of a file shows real line numbers with the
 * lines being asked about highlighted.
 */
export function CodeExcerpts({ excerpts }: { excerpts: QuestionExcerpt[] }) {
  if (excerpts.length === 0) return null;
  if (excerpts.length === 2 && excerpts.every((e) => e.focus === undefined)) {
    return <BeforeAfter before={excerpts[0]} after={excerpts[1]} />;
  }
  return (
    <div className="excerpts">
      {excerpts.map((excerpt) => (
        <FocusedExcerpt key={excerpt.label} excerpt={excerpt} />
      ))}
    </div>
  );
}

function FocusedExcerpt({ excerpt }: { excerpt: QuestionExcerpt }) {
  const lines = splitLines(excerpt.code);
  const first = excerpt.startLine;
  const focus = excerpt.focus;
  if (!excerpt.code || first === undefined) {
    return (
      <div>
        <p className="code-name">{excerpt.label}</p>
        <pre>{excerpt.code || '(empty)'}</pre>
      </div>
    );
  }
  const inFocus = (n: number) => focus !== undefined && n >= focus.start && n <= focus.end;
  return (
    <div>
      <p className="code-name">
        {excerpt.label}
        {focus && <span className="xc-key xc-key-focus">highlighted below</span>}
      </p>
      <pre className="xc" aria-label={excerpt.label}>
        {lines.map((line, i) => {
          const n = first + i;
          const focused = inFocus(n);
          return (
            <span key={i} className={`xc-line${focused ? ' xc-focus' : ''}`}>
              <span className="xc-ln" aria-hidden="true">
                {n}
              </span>
              <span className="xc-mark" aria-hidden="true">
                {focused ? '▶' : ' '}
              </span>
              {focused && <span className="sr-only">Asked about: </span>}
              {line || ' '}
              {'\n'}
            </span>
          );
        })}
      </pre>
    </div>
  );
}

function BeforeAfter({ before, after }: { before: QuestionExcerpt; after: QuestionExcerpt }) {
  const diff = diffExcerpts(before.code, after.code);
  return (
    <div className="xc-compare">
      <p className="xc-legend">
        {diff.identical ? (
          'The code is the same before and after; the question is about what happened around it.'
        ) : (
          <>
            Comparing the two versions: <span className="xc-key xc-key-removed">− removed</span>{' '}
            <span className="xc-key xc-key-added">+ added</span>. Inside a changed line, the darker part is exactly
            what changed.
          </>
        )}
      </p>
      <div className="excerpts excerpts-pair">
        <DiffSide label={before.label} lines={diff.before} empty={!before.code} />
        <DiffSide label={after.label} lines={diff.after} empty={!after.code} />
      </div>
    </div>
  );
}

function DiffSide({ label, lines, empty }: { label: string; lines: DiffLine[]; empty: boolean }) {
  return (
    <div>
      <p className="code-name">{label}</p>
      {empty ? (
        <pre>(empty)</pre>
      ) : (
        <pre className="xc" aria-label={label}>
          {lines.map((line, i) => (
            <span key={i} className={`xc-line xc-${line.kind}`}>
              <span className="xc-ln" aria-hidden="true">
                {i + 1}
              </span>
              <span className="xc-mark" aria-hidden="true">
                {line.kind === 'removed' ? '−' : line.kind === 'added' ? '+' : ' '}
              </span>
              {line.kind !== 'same' && <span className="sr-only">{line.kind === 'removed' ? 'Removed: ' : 'Added: '}</span>}
              {line.spans.length === 0 || line.spans.every((s) => !s.text)
                ? ' '
                : line.spans.map((span, k) =>
                    span.changed && line.spans.length > 1 ? (
                      <mark key={k} className="xc-change">
                        {span.text}
                      </mark>
                    ) : (
                      <span key={k}>{span.text}</span>
                    )
                  )}
              {'\n'}
            </span>
          ))}
        </pre>
      )}
    </div>
  );
}
