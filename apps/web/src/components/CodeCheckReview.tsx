import type { CodeCheck, HintProgress } from '@/lib/codecheck/types';
import { AutoRefresh } from './AutoRefresh';
import { CodeExcerpts } from './CodeExcerpts';
import { RetryButton } from './RetryButton';
import { formatDateTime } from './format';

const STATUS_TEXT: Record<CodeCheck['status'], string> = { pending: 'Checking', ready: 'Ready', failed: 'Failed' };

/**
 * The code check for the instructor: the reviewer's verdict and traced
 * inputs, every hint, and how far the student went with them.
 */
export function CodeCheckReview({
  submissionId,
  check,
  progress
}: {
  submissionId: string;
  check: CodeCheck | null;
  progress: HintProgress | null;
}) {
  const status = check?.status ?? 'pending';
  return (
    <section className="card" id="code-check">
      <h2>
        Code check <span className={`q-status q-status-${status}`}>{STATUS_TEXT[status]}</span>
        {check?.status === 'ready' && (
          <span className={`cc-sev ${check.works ? 'cc-sev-ok' : 'cc-sev-error'}`} style={{ marginLeft: 8 }}>
            {check.works ? 'Works' : 'Has problems'}
          </span>
        )}
      </h2>
      <p className="hint">
        {check?.model ? `Checked by ${check.model} (prompt ${check.promptVersion}) by tracing inputs by hand; nothing was run. ` : ''}
        The student sees the issues and hints, one hint at a time; the traces and explanations below are for you only.
      </p>

      {status === 'pending' && (
        <>
          <p className="muted">Checking the code…</p>
          <AutoRefresh everyMs={5000} />
        </>
      )}

      {status === 'failed' && (
        <div className="callout callout-error">
          <p>
            <strong>The code could not be checked.</strong> {check?.error ?? 'No reason was recorded.'}
          </p>
          <RetryButton url={`/api/submissions/${submissionId}/code-check/retry`} />
        </div>
      )}

      {check?.status === 'ready' && (
        <>
          {check.summaryForInstructor && <p>{check.summaryForInstructor}</p>}
          {check.notesForInstructor && (
            <div className="callout">
              <p>
                <strong>Note from the checker:</strong> {check.notesForInstructor}
              </p>
            </div>
          )}
          <details>
            <summary>Inputs traced ({check.traces.length})</summary>
            <div className="table-wrap">
              <table className="cc-trace">
                <thead>
                  <tr>
                    <th scope="col">Input</th>
                    <th scope="col">Expected</th>
                    <th scope="col">This code gives</th>
                    <th scope="col">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {check.traces.map((t, i) => (
                    <tr key={i}>
                      <td><code>{t.input}</code></td>
                      <td><code>{t.expected}</code></td>
                      <td><code>{t.actual}</code></td>
                      <td>{t.passes ? 'Passes' : <strong>Fails</strong>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          {check.issues.map((issue, i) => {
            const p = progress?.issues[issue.id];
            const shown = p?.hintsShown ?? 1;
            return (
              <article key={issue.id} className="cc-issue">
                <div className="cc-issue-head">
                  <span className={`cc-sev cc-sev-${issue.severity}`}>{issue.severity === 'error' ? 'Error' : 'Warning'}</span>
                  <h3>
                    {i + 1}. {issue.title}
                  </h3>
                  {issue.concept && <span className="muted">{issue.concept}</span>}
                </div>
                <CodeExcerpts excerpts={[issue.excerpt]} />
                <p>
                  <strong>Shown to the student:</strong> {issue.whatHappens}
                </p>
                <p>
                  <strong>The actual mistake:</strong> {issue.explanationForInstructor}
                </p>
                <ol className="cc-hints">
                  {issue.hints.map((hint, k) => (
                    <li key={k} className="cc-hint" style={k < shown ? undefined : { opacity: 0.55 }}>
                      <span className="cc-hint-n">
                        Hint {k + 1} {k < shown ? (k === 0 ? '· shown' : `· opened ${p?.revealedAt[k - 1] ? formatDateTime(p.revealedAt[k - 1]) : ''}`) : '· not opened'}
                      </span>
                      {hint}
                    </li>
                  ))}
                </ol>
                <p className="answer-label">Student&rsquo;s thinking</p>
                {p?.reflection ? (
                  <p className="answer-readonly">
                    {p.reflection}
                    {p.reflectionAt && <span className="muted"> ({formatDateTime(p.reflectionAt)})</span>}
                  </p>
                ) : (
                  <p className="muted">Nothing written yet.</p>
                )}
              </article>
            );
          })}
        </>
      )}
    </section>
  );
}
