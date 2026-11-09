'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { StudentQuestion } from '@/lib/questions/types';
import { formatDateTime } from './format';

export type QuestionsStatus = 'pending' | 'ready' | 'failed';

export interface QuestionsState {
  status: QuestionsStatus;
  closesAt: number;
  questions: StudentQuestion[];
  answered: boolean;
  answers: { questionId: string; text: string }[];
  answeredAt?: number;
}

const MAX_ANSWER_CHARS = 3000;
const POLL_MS = 3000;
const WARN_MS = 5 * 60 * 1000;

function timeLeft(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** The student's four questions: waits for them, counts down the hour, and sends the answers once. */
export function QuestionsForm({ submissionId, initial }: { submissionId: string; initial: QuestionsState }) {
  const [state, setState] = useState<QuestionsState>(initial);
  const [now, setNow] = useState<number | null>(null);
  const draftKey = `codelapse-answers-${submissionId}`;
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Clock: set on the client only, so the server and client render the same first frame.
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Restore drafts after a refresh.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) setDrafts(JSON.parse(saved) as Record<string, string>);
    } catch {
      // Drafts are a convenience; ignore storage problems.
    }
  }, [draftKey]);

  // Poll while the questions are being prepared.
  useEffect(() => {
    if (state.status !== 'pending') return;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/submissions/${submissionId}/questions`, { cache: 'no-store' });
        if (!response.ok) return;
        const next = (await response.json()) as QuestionsState;
        if (next.status !== 'pending') setState((s) => ({ ...s, ...next }));
      } catch {
        // Try again on the next tick.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [state.status, submissionId]);

  const updateDraft = useCallback(
    (id: string, text: string) => {
      setDrafts((current) => {
        const next = { ...current, [id]: text };
        try {
          localStorage.setItem(draftKey, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });
    },
    [draftKey]
  );

  const steps = (
    <StatusSteps status={state.status} answered={state.answered} closed={now !== null && now > state.closesAt} />
  );

  const unanswered = useMemo(
    () => state.questions.filter((q) => !(drafts[q.id] ?? '').trim()).length,
    [state.questions, drafts]
  );

  async function submit() {
    setSending(true);
    setError(null);
    try {
      const answers = state.questions.map((q) => ({ questionId: q.id, text: drafts[q.id] ?? '' }));
      const response = await fetch(`/api/submissions/${submissionId}/answers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers })
      });
      const json = (await response.json().catch(() => ({}))) as { error?: string; submittedAt?: number };
      if (response.status === 201) {
        try {
          localStorage.removeItem(draftKey);
        } catch {
          // ignore
        }
        setState((s) => ({
          ...s,
          answered: true,
          answers: answers.map((a) => ({ ...a, text: a.text.trim() })),
          answeredAt: json.submittedAt ?? Date.now()
        }));
      } else {
        setError(json.error ?? 'Your answers could not be sent. Try again.');
        setConfirming(false);
      }
    } catch {
      setError('Your answers could not be sent. Check your connection and try again.');
      setConfirming(false);
    } finally {
      setSending(false);
    }
  }

  if (state.status === 'pending') {
    return (
      <>
      {steps}
      <section className="card questions" aria-live="polite">
        <h2>Four questions about your work</h2>
        <p className="preparing">
          <span className="spinner" aria-hidden="true" /> Preparing your questions…
        </p>
        <p className="muted">
          This usually takes under a minute. Answer before <strong>{formatDateTime(state.closesAt)}</strong>, one
          hour after you submitted.
        </p>
      </section>
      </>
    );
  }

  if (state.status === 'failed') {
    return (
      <>
      {steps}
      <section className="card questions">
        <h2>Four questions about your work</h2>
        <p>Your questions could not be prepared. Your instructor has been told; you do not need to do anything.</p>
      </section>
      </>
    );
  }

  if (state.answered) {
    const byId = new Map(state.answers.map((a) => [a.questionId, a.text]));
    return (
      <>
      {steps}
      <section className="card questions">
        <h2>Your answers</h2>
        <div className="notice notice-success" role="status">
          Answers received{state.answeredAt ? ` at ${formatDateTime(state.answeredAt)}` : ''}. Thank you.
        </div>
        <ol className="question-list">
          {state.questions.map((q) => (
            <li key={q.id} className="question">
              <p className="question-text">{q.text}</p>
              <Excerpts question={q} />
              <p className="answer-label">Your answer</p>
              <p className="answer-readonly">{byId.get(q.id) ?? ''}</p>
            </li>
          ))}
        </ol>
      </section>
      </>
    );
  }

  const closed = now !== null && now > state.closesAt;
  if (closed) {
    return (
      <>
      {steps}
      <section className="card questions">
        <h2>Four questions about your work</h2>
        <p>
          The time to answer has ended. Answers closed at {formatDateTime(state.closesAt)}, one hour after you
          submitted.
        </p>
      </section>
      </>
    );
  }

  const remaining = now === null ? null : state.closesAt - now;
  return (
    <>
    {steps}
    <section className="card questions">
      <div className="questions-head">
        <h2>Four questions about your work</h2>
        <p className={`countdown${remaining !== null && remaining < WARN_MS ? ' countdown-warn' : ''}`} role="timer">
          Time left: {remaining === null ? '–' : timeLeft(remaining)}
        </p>
      </div>
      <p className="muted">
        Answer in your own words, in a few sentences each. Answers close at {formatDateTime(state.closesAt)}. Your
        drafts are kept in this browser until you submit.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setConfirming(true);
        }}
      >
        <fieldset disabled={sending}>
          <ol className="question-list">
            {state.questions.map((q, i) => {
              const text = drafts[q.id] ?? '';
              return (
                <li key={q.id} className="question">
                  <label htmlFor={`answer-${q.id}`} className="question-text">
                    {q.text}
                  </label>
                  <Excerpts question={q} />
                  <textarea
                    id={`answer-${q.id}`}
                    className="answer-input"
                    rows={5}
                    maxLength={MAX_ANSWER_CHARS}
                    value={text}
                    onChange={(e) => updateDraft(q.id, e.target.value)}
                    aria-describedby={`count-${q.id}`}
                    aria-label={`Answer to question ${i + 1}`}
                  />
                  <p id={`count-${q.id}`} className="char-count">
                    {text.length} / {MAX_ANSWER_CHARS}
                  </p>
                </li>
              );
            })}
          </ol>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {confirming ? (
            <div className="confirm-box" role="alertdialog" aria-label="Confirm submitting answers">
              <p>
                <strong>You can submit once.</strong>{' '}
                {unanswered > 0
                  ? `${unanswered} ${unanswered === 1 ? 'question has' : 'questions have'} no answer yet.`
                  : 'Your answers cannot be changed afterwards.'}
              </p>
              <div className="form-actions">
                <button type="button" className="button" onClick={() => setConfirming(false)}>
                  Keep editing
                </button>
                <button type="button" className="button button-primary" onClick={submit} disabled={sending}>
                  {sending ? 'Sending…' : 'Submit answers'}
                </button>
              </div>
            </div>
          ) : (
            <div className="form-actions">
              <button type="submit" className="button button-primary">
                Submit answers
              </button>
            </div>
          )}
        </fieldset>
      </form>
    </section>
    </>
  );
}

/** Where the student is: received, then questions, then answers. Updates as the page polls. */
function StatusSteps({ status, answered, closed }: { status: QuestionsStatus; answered: boolean; closed: boolean }) {
  const questions =
    status === 'ready'
      ? { cls: 'step-done', icon: '✓', text: 'Questions ready' }
      : status === 'failed'
        ? { cls: 'step-problem', icon: '!', text: 'Questions unavailable' }
        : { cls: 'step-current', icon: '…', text: 'Preparing questions' };
  const answers = answered
    ? { cls: 'step-done', icon: '✓', text: 'Answered' }
    : status === 'ready' && closed
      ? { cls: 'step-problem', icon: '!', text: 'Time ended' }
      : status === 'ready'
        ? { cls: 'step-current', icon: '3', text: 'Answer the questions' }
        : { cls: '', icon: '3', text: 'Answer the questions' };
  return (
    <ol className="status-steps" aria-label="Submission progress">
      <li className="step-done">
        <span className="step-icon" aria-hidden="true">✓</span>Received
      </li>
      <li className={questions.cls} aria-current={questions.cls === 'step-current' ? 'step' : undefined}>
        <span className="step-icon" aria-hidden="true">{questions.icon}</span>
        {questions.text}
      </li>
      <li className={answers.cls} aria-current={answers.cls === 'step-current' ? 'step' : undefined}>
        <span className="step-icon" aria-hidden="true">{answers.icon}</span>
        {answers.text}
      </li>
    </ol>
  );
}

function Excerpts({ question }: { question: StudentQuestion }) {
  if (question.excerpts.length === 0) return null;
  return (
    <div className={question.excerpts.length > 1 ? 'excerpts excerpts-pair' : 'excerpts'}>
      {question.excerpts.map((excerpt) => (
        <div key={excerpt.label}>
          <p className="code-name">{excerpt.label}</p>
          <pre>{excerpt.code || '(empty)'}</pre>
        </div>
      ))}
    </div>
  );
}
