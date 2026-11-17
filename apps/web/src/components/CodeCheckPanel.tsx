'use client';

import { useEffect, useState } from 'react';
import type { StudentCodeCheck, StudentIssue } from '@/lib/codecheck/types';
import { CodeExcerpts } from './CodeExcerpts';

const POLL_MS = 3000;
const MAX_REFLECTION_CHARS = 2000;

/**
 * The code check on the student's page. When the reviewer found a problem it
 * does not say what to change: it describes what happens and asks guiding
 * questions, one at a time, and the student writes what they think.
 */
export function CodeCheckPanel({ submissionId, initial }: { submissionId: string; initial: StudentCodeCheck }) {
  const [check, setCheck] = useState(initial);
  const url = `/api/submissions/${submissionId}/code-check`;

  useEffect(() => {
    if (check.status !== 'pending') return;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) return;
        const next = (await response.json()) as StudentCodeCheck;
        if (next.status !== 'pending') setCheck(next);
      } catch {
        // Try again on the next tick.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [check.status, url]);

  if (check.status === 'pending') {
    return (
      <section className="card" aria-live="polite">
        <h2>Code check</h2>
        <p className="preparing">
          <span className="spinner" aria-hidden="true" /> Checking whether your code does what the assignment asks…
        </p>
      </section>
    );
  }
  if (check.status === 'failed') {
    return (
      <section className="card">
        <h2>Code check</h2>
        <p className="muted">The automatic code check is not available for this submission. You do not need to do anything.</p>
      </section>
    );
  }

  const errors = check.issues.filter((i) => i.severity === 'error');
  const warnings = check.issues.filter((i) => i.severity === 'warning');
  return (
    <section className="card" aria-live="polite">
      <h2>Code check</h2>
      {check.works ? (
        <div className="notice notice-success" role="status">
          Your code gave the expected result for every input we traced through it.
          {warnings.length > 0 && ' There is still something worth a look below.'}
        </div>
      ) : (
        <p>
          Your code does not yet do everything the assignment asks: we found {errors.length === 1 ? 'one problem' : `${errors.length} problems`}.
          Instead of the answer, you get questions that lead you to it. Open one hint at a time and write what you think
          should change.
        </p>
      )}
      {check.issues.map((issue, i) => (
        <IssueCard key={issue.id} issue={issue} index={i} url={url} onUpdate={setCheck} />
      ))}
      <p className="hint">
        This check is made by an AI that traces your code by hand, and it can be wrong. If you are sure your code is right,
        say why in your thoughts.
      </p>
    </section>
  );
}

function IssueCard({
  issue,
  index,
  url,
  onUpdate
}: {
  issue: StudentIssue;
  index: number;
  url: string;
  onUpdate: (check: StudentCodeCheck) => void;
}) {
  const [draft, setDraft] = useState(issue.reflection);
  const [busy, setBusy] = useState<'reveal' | 'save' | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const more = issue.totalHints - issue.hints.length;

  async function send(body: Record<string, unknown>, kind: 'reveal' | 'save') {
    setBusy(kind);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueId: issue.id, ...body })
      });
      const json = (await response.json().catch(() => ({}))) as StudentCodeCheck & { error?: string };
      if (!response.ok) {
        setError(json.error ?? 'That did not work. Try again.');
        return;
      }
      onUpdate(json);
      if (kind === 'save') setSaved(true);
    } catch {
      setError('Could not reach the site. Check your connection and try again.');
    } finally {
      setBusy(null);
    }
  }

  const fieldId = `reflection-${issue.id}`;
  return (
    <article className="cc-issue">
      <div className="cc-issue-head">
        <span className={`cc-sev cc-sev-${issue.severity}`}>{issue.severity === 'error' ? 'Needs fixing' : 'Worth a look'}</span>
        <h3>
          {index + 1}. {issue.title}
        </h3>
        {issue.concept && <span className="muted">{issue.concept}</span>}
      </div>
      <CodeExcerpts excerpts={[issue.excerpt]} />
      <p>
        <strong>What happens:</strong> {issue.whatHappens}
      </p>
      <ol className="cc-hints" aria-label="Hints">
        {issue.hints.map((hint, k) => (
          <li key={k} className="cc-hint">
            <span className="cc-hint-n">
              Hint {k + 1} of {issue.totalHints}
            </span>
            {hint}
          </li>
        ))}
      </ol>
      {more > 0 && (
        <p className="cc-actions">
          <button type="button" className="button" disabled={busy !== null} onClick={() => send({ reveal: true }, 'reveal')}>
            {busy === 'reveal' ? 'Opening…' : 'Still stuck? Show the next hint'}
          </button>
          <span className="muted">Try answering the question above first.</span>
        </p>
      )}
      <label htmlFor={fieldId} className="answer-label">
        What do you think is going on, and what would you change?
      </label>
      <textarea
        id={fieldId}
        className="answer-input"
        rows={3}
        maxLength={MAX_REFLECTION_CHARS}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setSaved(false);
        }}
      />
      <p className="cc-actions">
        <button
          type="button"
          className="button button-primary"
          disabled={busy !== null || !draft.trim() || draft.trim() === issue.reflection}
          onClick={() => send({ reflection: draft }, 'save')}
        >
          {busy === 'save' ? 'Saving…' : 'Save my thinking'}
        </button>
        {saved && (
          <span className="muted" role="status">
            Saved.
          </span>
        )}
        {error && (
          <span className="form-error-inline" role="alert">
            {error}
          </span>
        )}
      </p>
    </article>
  );
}
