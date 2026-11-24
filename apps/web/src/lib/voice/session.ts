import type { AnswerSet, GeneratedQuestion, QuestionSet } from '../questions/types';
import type { AnswerConversation, QuestionProgress, TutorMove, VoicePublic, VoiceSession, VoiceTurn } from './types';

/** Per question: how often the tutor may do each thing before the conversation moves on. */
export const LIMITS = {
  followUps: 2,
  hints: 2,
  clarifications: 2,
  /** After this many student turns on one question, the next question is asked whatever the tutor chose. */
  studentTurns: 6
} as const;

/** Longest student turn kept, in characters (about two minutes of speech). */
export const MAX_STUDENT_TURN_CHARS = 1500;

/** Stored as the answer when the student said nothing about a question. */
export const NO_ANSWER = '(No answer given.)';

const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];

/** Error with the HTTP status that fits it, for the voice routes. */
export class VoiceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * A question as it is read aloud: backticks and other markdown removed, since
 * the code itself is on the student's screen. Underscores stay: they are part
 * of names such as count_vowels.
 */
export function spokenText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[`*#>]/g, '')
    .replace(/[   ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function emptyProgress(): QuestionProgress {
  return { followUps: 0, hints: 0, clarifications: 0, studentTurns: 0 };
}

function askLine(set: QuestionSet, index: number): string {
  const total = set.questions.length;
  const label = index === total - 1 && total > 1 ? 'Last question' : `Question ${index + 1} of ${total}`;
  return `${label}. ${spokenText(set.questions[index].text)}`;
}

/** Starts a conversation: a short welcome and the first question. */
export function startSession(set: QuestionSet, model: string, promptVersion: string, now: number): VoiceSession {
  if (set.status !== 'ready' || set.questions.length === 0) {
    throw new VoiceError('The questions are not ready yet.', 409);
  }
  const first = set.questions[0];
  const welcome =
    `Hi. I'll ask you ${set.questions.length} short questions about the code you submitted, one at a time. ` +
    "The code for each question is on your screen. Take your time, and you can ask me to repeat or explain a question. " +
    "I won't give you answers, but I can give you a hint if you're stuck.";
  return {
    status: 'active',
    promptVersion,
    provider: 'featherless',
    model,
    startedAt: now,
    questionIndex: 0,
    turns: [{ role: 'tutor', questionId: first.id, text: `${welcome} ${askLine(set, 0)}`, at: now, kind: 'ask' }],
    progress: Object.fromEntries(set.questions.map((q) => [q.id, emptyProgress()])),
    log: [],
    transcriptions: []
  };
}

export function currentQuestion(set: QuestionSet, session: VoiceSession): GeneratedQuestion {
  return set.questions[Math.min(session.questionIndex, set.questions.length - 1)];
}

/** The turns about one question, in order. */
export function turnsFor(session: VoiceSession, questionId: string): VoiceTurn[] {
  return session.turns.filter((t) => t.questionId === questionId);
}

/** Adds what the student said. Returns a new session; the input is not changed. */
export function addStudentTurn(
  set: QuestionSet,
  session: VoiceSession,
  text: string,
  input: 'voice' | 'typed',
  now: number
): VoiceSession {
  if (session.status !== 'active') {
    throw new VoiceError('This voice check has already ended.', 409);
  }
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, MAX_STUDENT_TURN_CHARS);
  if (!clean) {
    throw new VoiceError('Nothing was said.', 400);
  }
  const question = currentQuestion(set, session);
  const progress = { ...session.progress[question.id] ?? emptyProgress() };
  progress.studentTurns += 1;
  return {
    ...session,
    turns: [...session.turns, { role: 'student', questionId: question.id, text: clean, at: now, input }],
    progress: { ...session.progress, [question.id]: progress }
  };
}

/**
 * Applies the tutor's reply after a student turn. The server, not the model,
 * decides how the conversation moves: a move past its limit becomes "next",
 * and "next" reads out the following question word for word (or ends the
 * conversation after the last one).
 */
export function applyTutorReply(
  set: QuestionSet,
  session: VoiceSession,
  reply: { say: string; move: TutorMove },
  now: number
): VoiceSession {
  const question = currentQuestion(set, session);
  const progress = { ...session.progress[question.id] ?? emptyProgress() };
  let move = reply.move;
  let say = reply.say;

  const overLimit =
    (move === 'follow_up' && progress.followUps >= LIMITS.followUps) ||
    (move === 'hint' && progress.hints >= LIMITS.hints) ||
    (move === 'clarify' && progress.clarifications >= LIMITS.clarifications) ||
    progress.studentTurns >= LIMITS.studentTurns;
  if (move !== 'next' && overLimit) {
    // The model's line was written to continue this question; replace it with a neutral one.
    move = 'next';
    say = "Thanks, that's fine. Let's move on.";
  }

  if (move === 'follow_up') progress.followUps += 1;
  if (move === 'hint') progress.hints += 1;
  if (move === 'clarify') progress.clarifications += 1;

  const turns: VoiceTurn[] = [...session.turns, { role: 'tutor', questionId: question.id, text: say, at: now, kind: move }];
  let next: VoiceSession = { ...session, turns, progress: { ...session.progress, [question.id]: progress } };

  if (move === 'next') {
    const index = session.questionIndex + 1;
    if (index >= set.questions.length) {
      next = closeSession(set, next, 'completed', now);
    } else {
      next = {
        ...next,
        questionIndex: index,
        turns: [...next.turns, { role: 'tutor', questionId: set.questions[index].id, text: askLine(set, index), at: now, kind: 'ask' }]
      };
    }
  }
  return next;
}

/** Ends the conversation with a closing line. */
export function closeSession(set: QuestionSet, session: VoiceSession, endedBy: 'completed' | 'student', now: number): VoiceSession {
  const question = currentQuestion(set, session);
  const text =
    endedBy === 'completed'
      ? `That was the ${ORDINAL[set.questions.length - 1] ?? 'last'} and last question. Thank you, your answers are saved.`
      : 'Okay, we can stop here. Thank you, your answers are saved.';
  return {
    ...session,
    status: 'finished',
    endedBy,
    finishedAt: now,
    turns: [...session.turns, { role: 'tutor', questionId: question.id, text, at: now, kind: 'close' }]
  };
}

/** The answers a finished conversation gives: each question's student turns, and the full conversation. */
export function answersFromSession(set: QuestionSet, session: VoiceSession, now: number): AnswerSet {
  const conversations: AnswerConversation[] = set.questions.map((q) => {
    const progress = session.progress[q.id] ?? emptyProgress();
    return {
      questionId: q.id,
      turns: turnsFor(session, q.id).map((t) => ({ role: t.role, text: t.text, ...(t.kind ? { kind: t.kind } : {}) })),
      hints: progress.hints,
      followUps: progress.followUps,
      clarifications: progress.clarifications
    };
  });
  return {
    submittedAt: now,
    mode: 'voice',
    answers: set.questions.map((q) => {
      const said = turnsFor(session, q.id)
        .filter((t) => t.role === 'student')
        .map((t) => t.text);
      return { questionId: q.id, text: said.length > 0 ? said.join('\n') : NO_ANSWER };
    }),
    conversations
  };
}

/** What the student's page may see. */
export function publicView(session: VoiceSession): VoicePublic {
  return {
    status: session.status,
    questionIndex: session.questionIndex,
    turns: session.turns.map((t) => ({
      role: t.role,
      questionId: t.questionId,
      text: t.text,
      ...(t.kind ? { kind: t.kind } : {}),
      ...(t.input ? { input: t.input } : {})
    }))
  };
}
