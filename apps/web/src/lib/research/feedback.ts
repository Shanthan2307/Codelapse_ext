import { promises as fs } from 'fs';
import path from 'path';
import { dataDir } from '../store';

/**
 * The instructor's own ratings of a submission: whether they agree with each
 * answer review, how useful each question was, and an overall note. This is
 * the ground truth the pilot compares the evaluator against. Instructor-only.
 *
 *   <data>/submissions/<id>/instructor-feedback.json
 */
export type Agreement = 'agree' | 'too-high' | 'too-low';
export type OwnLevel = 'strong' | 'partial' | 'limited';

export interface InstructorFeedback {
  updatedAt: number;
  answers: Record<string, { agreement: Agreement | null; ownLevel: OwnLevel | null; note: string }>;
  questions: Record<string, { useful: boolean | null; note: string }>;
  overall: { note: string; followUp: boolean };
}

export const MAX_NOTE_CHARS = 2000;
const SAFE_ID = /^[a-z0-9-]+$/;
const SAFE_QUESTION_ID = /^[a-z0-9_-]{1,32}$/i;
const AGREEMENTS: readonly Agreement[] = ['agree', 'too-high', 'too-low'];
const LEVELS: readonly OwnLevel[] = ['strong', 'partial', 'limited'];

/** A problem with submitted feedback, worded for the instructor. */
export class FeedbackError extends Error {}

export function emptyFeedback(): InstructorFeedback {
  return { updatedAt: 0, answers: {}, questions: {}, overall: { note: '', followUp: false } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function note(value: unknown, where: string): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new FeedbackError(`${where}: the note must be text.`);
  if (value.length > MAX_NOTE_CHARS) throw new FeedbackError(`${where}: the note is longer than ${MAX_NOTE_CHARS} characters.`);
  return value;
}

function onlyKeys(value: Record<string, unknown>, allowed: string[], where: string): void {
  const extra = Object.keys(value).filter((k) => !allowed.includes(k));
  if (extra.length > 0) throw new FeedbackError(`${where}: unexpected field ${extra.join(', ')}.`);
}

function entries<T>(value: unknown, where: string, read: (entry: Record<string, unknown>, label: string) => T): Record<string, T> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new FeedbackError(`${where} must be an object keyed by question id.`);
  const out: Record<string, T> = {};
  for (const [id, entry] of Object.entries(value)) {
    if (!SAFE_QUESTION_ID.test(id)) throw new FeedbackError(`${where}: "${id}" is not a question id.`);
    if (!isRecord(entry)) throw new FeedbackError(`${where}.${id} must be an object.`);
    out[id] = read(entry, `${where}.${id}`);
  }
  return out;
}

/**
 * Checks feedback sent by the instructor page and returns a clean copy.
 * Unknown fields, wrong types and over-long notes are refused. If questionIds
 * is given, feedback for any other question is refused too.
 */
export function validateFeedback(input: unknown, questionIds?: string[], now: number = Date.now()): InstructorFeedback {
  if (!isRecord(input)) throw new FeedbackError('Feedback must be an object.');
  onlyKeys(input, ['updatedAt', 'answers', 'questions', 'overall'], 'Feedback');

  const answers = entries(input.answers, 'answers', (entry, label) => {
    onlyKeys(entry, ['agreement', 'ownLevel', 'note'], label);
    const agreement = entry.agreement ?? null;
    if (agreement !== null && !AGREEMENTS.includes(agreement as Agreement)) {
      throw new FeedbackError(`${label}: agreement must be agree, too-high, too-low or empty.`);
    }
    const ownLevel = entry.ownLevel ?? null;
    if (ownLevel !== null && !LEVELS.includes(ownLevel as OwnLevel)) {
      throw new FeedbackError(`${label}: your level must be strong, partial, limited or empty.`);
    }
    return { agreement: agreement as Agreement | null, ownLevel: ownLevel as OwnLevel | null, note: note(entry.note, label) };
  });

  const questions = entries(input.questions, 'questions', (entry, label) => {
    onlyKeys(entry, ['useful', 'note'], label);
    const useful = entry.useful ?? null;
    if (useful !== null && typeof useful !== 'boolean') throw new FeedbackError(`${label}: useful must be true, false or empty.`);
    return { useful: useful as boolean | null, note: note(entry.note, label) };
  });

  let overall = { note: '', followUp: false };
  if (input.overall !== undefined) {
    if (!isRecord(input.overall)) throw new FeedbackError('overall must be an object.');
    onlyKeys(input.overall, ['note', 'followUp'], 'overall');
    const followUp = input.overall.followUp ?? false;
    if (typeof followUp !== 'boolean') throw new FeedbackError('overall: followUp must be true or false.');
    overall = { note: note(input.overall.note, 'overall'), followUp };
  }

  if (questionIds) {
    const unknown = [...Object.keys(answers), ...Object.keys(questions)].filter((id) => !questionIds.includes(id));
    if (unknown.length > 0) throw new FeedbackError(`No such question: ${[...new Set(unknown)].join(', ')}.`);
  }
  return { updatedAt: now, answers, questions, overall };
}

function feedbackFile(id: string): string {
  return path.join(dataDir(), 'submissions', id, 'instructor-feedback.json');
}

export async function getFeedback(id: string): Promise<InstructorFeedback | null> {
  if (!SAFE_ID.test(id)) return null;
  try {
    return JSON.parse(await fs.readFile(feedbackFile(id), 'utf-8')) as InstructorFeedback;
  } catch {
    return null;
  }
}

export async function saveFeedback(id: string, feedback: InstructorFeedback): Promise<void> {
  if (!SAFE_ID.test(id)) throw new Error(`Unsafe submission id: ${id}`);
  const file = feedbackFile(id);
  // Write then rename, so a reader never sees half a file.
  await fs.writeFile(`${file}.tmp`, JSON.stringify(feedback, null, 2));
  await fs.rename(`${file}.tmp`, file);
}
