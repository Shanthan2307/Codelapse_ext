import type { SubmissionRecord } from '../types';

export type QuestionType = 'process' | 'code';

/** Code shown next to a question so the student can recall what they did. */
export interface QuestionExcerpt {
  label: string;
  code: string;
}

export interface CodeRef {
  file: string;
  startLine: number;
  endLine: number;
}

/** A question as stored. rationale and strongAnswerPoints are never shown to the student. */
export interface GeneratedQuestion {
  id: string;
  type: QuestionType;
  /** The decision moment a process question is about. */
  momentId: string | null;
  /** The lines a code question is about. */
  codeRef: CodeRef | null;
  concept: string;
  text: string;
  excerpts: QuestionExcerpt[];
  /** Why the generator asked this: shared with the evaluator. */
  rationale: string;
  /** What a strong answer would likely cover: a hypothesis for the evaluator, not an answer key. */
  strongAnswerPoints: string[];
}

/**
 * The questions for one submission, plus everything needed to understand or
 * redo how they were made. This file is the shared record between the
 * question generator and the answer evaluator.
 */
export interface QuestionSet {
  status: 'pending' | 'ready' | 'failed';
  promptVersion: string;
  provider: string;
  model: string;
  startedAt: number;
  finishedAt?: number;
  /** Shown to the instructor when generation failed. */
  error?: string;
  questions: GeneratedQuestion[];
  /** Instruction-like text found in the student's files, for the instructor to see. */
  injectionSignals: InjectionSignal[];
  /** Anything the generator wanted the instructor to know. */
  notesForInstructor: string | null;
  /** Every request and response, kept for research and for training a local model later. */
  log: GenerationAttempt[];
}

export interface GenerationAttempt {
  at: number;
  system: string;
  user: string;
  output: unknown;
  validationErrors: string[];
  usage?: { inputTokens: number; outputTokens: number };
}

export interface InjectionSignal {
  file: string;
  line: number;
  text: string;
}

/** What the student's page receives: no rationale, no evaluator hints. */
export interface StudentQuestion {
  id: string;
  type: QuestionType;
  text: string;
  excerpts: QuestionExcerpt[];
}

export interface AnswerSet {
  submittedAt: number;
  answers: { questionId: string; text: string }[];
}

export interface QuestionContext {
  record: SubmissionRecord;
  assignmentTitle: string;
  assignmentDescription: string[];
  /** Submitted code, by file name. */
  code: { name: string; content: string }[];
}
