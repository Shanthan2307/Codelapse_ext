import type { InjectionSignal } from '../questions/types';

/** How much an answer shows the student understands their own work. Never a verdict about honesty. */
export type UnderstandingLevel = 'strong' | 'partial' | 'limited';

export interface AnswerScores {
  /** 0-3: refers to concrete details of this code or recording rather than generalities. */
  specificity: number;
  /** 0-3: fits what the code and recording show. */
  consistency: number;
  /** 0-3: explains why, correctly. */
  reasoning: number;
}

export interface AnswerEvaluation {
  questionId: string;
  addressesQuestion: boolean;
  scores: AnswerScores;
  level: UnderstandingLevel;
  /** Short phrases from the answer, checked to appear in it word for word. */
  evidenceQuotes: string[];
  explanation: string;
  /** Specific gaps or mismatches, for the instructor to look at. */
  concerns: string[];
}

/** The evaluator's review of one submission's answers. Shown to instructors only. */
export interface EvaluationSet {
  status: 'pending' | 'ready' | 'failed' | 'skipped';
  promptVersion: string;
  provider: string;
  model: string;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  evaluations: AnswerEvaluation[];
  /** Answers rated strong / partial / limited. */
  counts: Record<UnderstandingLevel, number>;
  summary: string | null;
  notesForInstructor: string | null;
  /** Instruction-like text found in the answers. */
  injectionSignals: InjectionSignal[];
  log: EvaluationAttempt[];
}

export interface EvaluationAttempt {
  at: number;
  system: string;
  user: string;
  output: unknown;
  validationErrors: string[];
  usage?: { inputTokens: number; outputTokens: number };
}
