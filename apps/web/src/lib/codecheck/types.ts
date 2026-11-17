import type { CodeRef, QuestionExcerpt } from '../questions/types';

export type IssueSeverity = 'error' | 'warning';

/** One problem the reviewer found in the submitted code, with hints that lead the student to it. */
export interface CodeIssue {
  id: string;
  /** error: the code does not do what the assignment asks. warning: it works but something is risky or against the brief. */
  severity: IssueSeverity;
  /** The programming idea involved, e.g. "pointers" or "loop bounds". */
  concept: string;
  /** Short student-facing title that names the symptom, not the fix. */
  title: string;
  codeRef: CodeRef;
  /** The cited lines with context, highlighted. */
  excerpt: QuestionExcerpt;
  /** Student-facing: what goes wrong, concretely, without saying how to fix it. */
  whatHappens: string;
  /** Guiding questions, from broad to specific. Shown one at a time; none gives the answer away. */
  hints: string[];
  /** Instructor-only: the actual bug and its fix. */
  explanationForInstructor: string;
}

/** An input the reviewer traced through the code by hand. Instructor-only. */
export interface TracedCase {
  input: string;
  expected: string;
  actual: string;
  passes: boolean;
}

/**
 * The reviewer's check of whether the submitted code is correct, made at
 * submission time. The student sees the issues and hints; the rest is for
 * the instructor. It is formative feedback and never a grade.
 */
export interface CodeCheck {
  status: 'pending' | 'ready' | 'failed';
  promptVersion: string;
  provider: string;
  model: string;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  /** The reviewer's view: does the code do what the assignment asks? */
  works: boolean | null;
  issues: CodeIssue[];
  traces: TracedCase[];
  summaryForInstructor: string | null;
  notesForInstructor: string | null;
  log: CodeCheckAttempt[];
}

export interface CodeCheckAttempt {
  at: number;
  system: string;
  user: string;
  output: unknown;
  validationErrors: string[];
  usage?: { inputTokens: number; outputTokens: number };
}

/** What the student did with each issue's hints, for the instructor and the research data. */
export interface HintProgress {
  issues: Record<string, IssueProgress>;
}

export interface IssueProgress {
  /** How many hints are visible; the first is always shown. */
  hintsShown: number;
  /** When each extra hint was opened. */
  revealedAt: number[];
  /** The student's answer to "what do you think should change?". */
  reflection?: string;
  reflectionAt?: number;
}

/** An issue as the student's page receives it: only the hints already opened. */
export interface StudentIssue {
  id: string;
  severity: IssueSeverity;
  concept: string;
  title: string;
  excerpt: QuestionExcerpt;
  whatHappens: string;
  hints: string[];
  totalHints: number;
  reflection: string;
}

export interface StudentCodeCheck {
  status: CodeCheck['status'];
  works: boolean | null;
  issues: StudentIssue[];
}
