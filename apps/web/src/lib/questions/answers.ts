import type { SubmissionRecord } from '../types';
import type { AnswerSet, QuestionSet, StudentQuestion } from './types';

export const MAX_ANSWER_CHARS = 3000;

/** A reason the answers cannot be accepted, with the HTTP status that fits it. */
export class AnswerError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Checks a student's answers against the rules: the questions are ready, the
 * hour since submitting has not passed, nothing was answered before, and every
 * question has an answer of reasonable length.
 */
export function acceptAnswers(
  record: SubmissionRecord,
  set: QuestionSet | null,
  existing: AnswerSet | null,
  input: { questionId: string; text: string }[],
  now: number
): AnswerSet {
  if (!set || set.status !== 'ready') {
    throw new AnswerError('The questions are not ready yet.', 409);
  }
  if (existing) {
    throw new AnswerError('Your answers were already submitted.', 409);
  }
  if (now > record.questionsCloseAt) {
    throw new AnswerError('The time to answer has ended: answers closed one hour after you submitted.', 410);
  }
  const byId = new Map(input.map((a) => [a.questionId, a.text]));
  const answers = set.questions.map((q, i) => {
    const text = (byId.get(q.id) ?? '').trim();
    if (!text) {
      throw new AnswerError(`Answer question ${i + 1} before submitting.`, 400);
    }
    if (text.length > MAX_ANSWER_CHARS) {
      throw new AnswerError(`Your answer to question ${i + 1} is longer than ${MAX_ANSWER_CHARS} characters.`, 400);
    }
    return { questionId: q.id, text };
  });
  return { submittedAt: now, answers };
}

/** The questions as the student may see them. */
export function studentView(set: QuestionSet): StudentQuestion[] {
  return set.questions.map((q) => ({ id: q.id, type: q.type, text: q.text, excerpts: q.excerpts }));
}
