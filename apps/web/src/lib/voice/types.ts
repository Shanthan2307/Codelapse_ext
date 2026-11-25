/**
 * The voice check: instead of typing four answers, the student talks with an
 * AI tutor that asks the same four questions one at a time, can rephrase a
 * question, ask the student to say more, or give a small hint, and never gives
 * the answer. The conversation is stored as text; audio is never kept.
 */

/** What the tutor chose to do with its reply. */
export type TutorMove = 'follow_up' | 'clarify' | 'hint' | 'next';

/** Why a tutor turn exists: a tutor move, the system asking a question, or the closing line. */
export type TurnKind = TutorMove | 'ask' | 'close';

export interface VoiceTurn {
  role: 'tutor' | 'student';
  /** The question this turn belongs to. */
  questionId: string;
  text: string;
  at: number;
  /** Tutor turns only. */
  kind?: TurnKind;
  /** Student turns only: spoken (and transcribed) or typed. */
  input?: 'voice' | 'typed';
}

export interface QuestionProgress {
  followUps: number;
  hints: number;
  clarifications: number;
  studentTurns: number;
}

/** One request to the tutor model, kept for research like every other AI call on the site. */
export interface TutorAttempt {
  at: number;
  questionId: string;
  system: string;
  user: string;
  output: unknown;
  validationErrors: string[];
  /** How long the model took, in milliseconds. */
  ms: number;
  usage?: { inputTokens: number; outputTokens: number };
  /** True when every attempt failed and a fixed reply was used instead. */
  fallback?: boolean;
}

/** One speech-to-text request: what was heard is in the student turn; this records how. */
export interface TranscriptionRecord {
  at: number;
  questionId: string;
  model: string;
  ms: number;
  audioBytes: number;
  /** Empty when nothing was recognised and the student was asked to repeat. */
  chars: number;
}

export interface VoiceSession {
  status: 'active' | 'finished';
  promptVersion: string;
  provider: 'featherless';
  model: string;
  startedAt: number;
  finishedAt?: number;
  /** How the conversation ended. */
  endedBy?: 'completed' | 'student';
  /** Index into the question set of the question being discussed. */
  questionIndex: number;
  turns: VoiceTurn[];
  progress: Record<string, QuestionProgress>;
  log: TutorAttempt[];
  transcriptions: TranscriptionRecord[];
}

/** What the student's browser receives: no prompts, no model log. */
export interface VoicePublic {
  status: VoiceSession['status'];
  questionIndex: number;
  turns: { role: VoiceTurn['role']; questionId: string; text: string; kind?: TurnKind; input?: VoiceTurn['input'] }[];
}

/** The conversation about one question, kept with the answers for the reviewer and the instructor. */
export interface AnswerConversation {
  questionId: string;
  turns: { role: VoiceTurn['role']; text: string; kind?: TurnKind }[];
  hints: number;
  followUps: number;
  clarifications: number;
}
