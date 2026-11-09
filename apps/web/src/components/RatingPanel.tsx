'use client';

import { useEffect, useRef, useState } from 'react';
import type { Agreement, InstructorFeedback, OwnLevel } from '@/lib/research/feedback';

export interface RatedQuestion {
  id: string;
  number: number;
  type: 'process' | 'code';
  text: string;
  /** The answer reviewer's level, shown for comparison; null when there is no review. */
  reviewLevel: OwnLevel | null;
}

const AGREEMENTS: { value: Agreement; label: string }[] = [
  { value: 'agree', label: 'Agree' },
  { value: 'too-high', label: 'Too high' },
  { value: 'too-low', label: 'Too low' }
];
const LEVELS: { value: OwnLevel; label: string }[] = [
  { value: 'strong', label: 'Strong' },
  { value: 'partial', label: 'Partial' },
  { value: 'limited', label: 'Limited' }
];
const SAVE_DELAY_MS = 600;

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * The instructor's own rating of each answer and question, for the research
 * pilot. Saved automatically; the student never sees it.
 */
export function RatingPanel({
  submissionId,
  questions,
  initial
}: {
  submissionId: string;
  questions: RatedQuestion[];
  initial: InstructorFeedback;
}) {
  const [feedback, setFeedback] = useState<InstructorFeedback>(initial);
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState('');
  const dirty = useRef(false);

  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(async () => {
      setState('saving');
      try {
        const response = await fetch(`/api/submissions/${submissionId}/feedback`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ answers: feedback.answers, questions: feedback.questions, overall: feedback.overall })
        });
        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Saving failed (${response.status}).`);
        }
        setState('saved');
        setError('');
      } catch (err) {
        setState('error');
        setError(err instanceof Error ? err.message : 'Saving failed.');
      }
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [feedback, submissionId]);

  const update = (change: (draft: InstructorFeedback) => void) => {
    dirty.current = true;
    setFeedback((current) => {
      const draft: InstructorFeedback = structuredClone(current);
      change(draft);
      return draft;
    });
  };
  const answerOf = (id: string) => feedback.answers[id] ?? { agreement: null, ownLevel: null, note: '' };
  const questionOf = (id: string) => feedback.questions[id] ?? { useful: null, note: '' };
  const rated = questions.filter((q) => answerOf(q.id).agreement !== null).length;

  return (
    <section className="card rating-panel" id="ratings">
      <div className="rating-head">
        <h2>Your ratings</h2>
        <span className={`rating-save rating-save-${state}`} role="status">
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? error : `${rated} of ${questions.length} rated`}
        </span>
      </div>
      <p className="hint">
        For the research pilot: do you agree with each review, and was each question useful? This is never shown to
        the student, and the export replaces names with participant codes.
      </p>

      <ol className="rating-list">
        {questions.map((q) => {
          const answer = answerOf(q.id);
          const question = questionOf(q.id);
          return (
            <li key={q.id} className="rating-item">
              <p className="rating-question">
                <span className={`badge badge-${q.type}`}>{q.type === 'process' ? 'Process' : 'Code'}</span> {q.text}
              </p>
              <div className="rating-row">
                <span className="rating-label">
                  Review said <b>{q.reviewLevel ? LEVELS.find((l) => l.value === q.reviewLevel)!.label : 'nothing yet'}</b>
                </span>
                <div className="segmented" role="group" aria-label={`Do you agree with the review of answer ${q.number}?`}>
                  {AGREEMENTS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={answer.agreement === option.value ? 'active' : ''}
                      aria-pressed={answer.agreement === option.value}
                      disabled={!q.reviewLevel}
                      onClick={() =>
                        update((d) => {
                          d.answers[q.id] = { ...answer, agreement: answer.agreement === option.value ? null : option.value };
                        })
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <label className="rating-select">
                  Your level{' '}
                  <select
                    value={answer.ownLevel ?? ''}
                    onChange={(e) =>
                      update((d) => {
                        d.answers[q.id] = { ...answer, ownLevel: (e.target.value || null) as OwnLevel | null };
                      })
                    }
                  >
                    <option value="">–</option>
                    {LEVELS.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="rating-check">
                  <input
                    type="checkbox"
                    checked={question.useful === true}
                    onChange={(e) =>
                      update((d) => {
                        d.questions[q.id] = { ...question, useful: e.target.checked ? true : null };
                      })
                    }
                  />{' '}
                  Useful question
                </label>
              </div>
              <textarea
                className="rating-note"
                rows={1}
                maxLength={2000}
                placeholder="Note (optional)"
                aria-label={`Note on answer ${q.number}`}
                value={answer.note}
                onChange={(e) =>
                  update((d) => {
                    d.answers[q.id] = { ...answer, note: e.target.value };
                  })
                }
              />
            </li>
          );
        })}
      </ol>

      <div className="rating-overall">
        <label className="rating-check">
          <input
            type="checkbox"
            checked={feedback.overall.followUp}
            onChange={(e) =>
              update((d) => {
                d.overall.followUp = e.target.checked;
              })
            }
          />{' '}
          Follow up with this student
        </label>
        <textarea
          className="rating-note"
          rows={2}
          maxLength={2000}
          placeholder="Overall note (optional)"
          aria-label="Overall note"
          value={feedback.overall.note}
          onChange={(e) =>
            update((d) => {
              d.overall.note = e.target.value;
            })
          }
        />
      </div>
    </section>
  );
}
