import { findAssignment, LANGUAGE_LABELS } from '../course';
import { markEvaluationPending } from '../evaluation/run';
import type { QuestionSet } from '../questions/types';
import { backend } from '../storage';
import { SAFE_ID } from '../storage/types';
import { getAnswers, getQuestionSet, getSubmission, readAllSubmittedCode, saveAnswers } from '../store';
import type { SubmissionRecord } from '../types';
import { buildTutorPrompt, TUTOR_PROMPT_VERSION } from './prompt';
import {
  addStudentTurn,
  answersFromSession,
  applyTutorReply,
  closeSession,
  currentQuestion,
  LIMITS,
  startSession,
  turnsFor,
  VoiceError
} from './session';
import { FeatherlessTutorModel, tutorModelName, type TutorModel } from './tutor';
import type { TranscriptionRecord, TutorAttempt, VoiceSession } from './types';
import { checkTutorReply, fallbackReply } from './validate';

const MAX_ATTEMPTS = 2;
/** Sessions are written with a version check, so two quick requests cannot both apply. */
const BUSY = 'The tutor is still answering your last turn. Wait a moment and try again.';

export async function getVoiceSession(id: string): Promise<{ session: VoiceSession; version: string } | null> {
  if (!SAFE_ID.test(id)) return null;
  const doc = await backend().getDoc<VoiceSession>(id, 'voice');
  return doc ? { session: doc.data, version: doc.version } : null;
}

interface Loaded {
  record: SubmissionRecord;
  set: QuestionSet;
}

/** The submission and its questions, if a voice check may run now. */
async function load(id: string, now: number): Promise<Loaded> {
  const record = await getSubmission(id);
  if (!record) throw new VoiceError('Submission not found.', 404);
  const set = await getQuestionSet(id);
  if (!set || set.status !== 'ready') throw new VoiceError('The questions are not ready yet.', 409);
  if (await getAnswers(id)) throw new VoiceError('Your answers were already submitted.', 409);
  if (now > record.questionsCloseAt) {
    throw new VoiceError('The time to answer has ended: answers closed one hour after you submitted.', 410);
  }
  return { record, set };
}

async function save(id: string, session: VoiceSession, version: string | null): Promise<void> {
  if (!(await backend().updateDocIfVersion(id, 'voice', session, version))) {
    throw new VoiceError(BUSY, 409);
  }
}

/**
 * Saves a finished conversation as the student's answers, like the written
 * form. The caller then starts the review (runEvaluation) after replying.
 */
async function submitAnswers(id: string, set: QuestionSet, session: VoiceSession, now: number): Promise<void> {
  if (!(await saveAnswers(id, answersFromSession(set, session, now)))) {
    throw new VoiceError('Your answers were already submitted.', 409);
  }
  await markEvaluationPending(id);
}

/** Starts the conversation, or returns the one already running (after a page refresh). */
export async function startVoice(id: string, now = Date.now()): Promise<VoiceSession> {
  const { set } = await load(id, now);
  const existing = await getVoiceSession(id);
  if (existing) return existing.session;
  const session = startSession(set, tutorModelName(), TUTOR_PROMPT_VERSION, now);
  await save(id, session, null);
  return session;
}

/**
 * Handles one thing the student said: adds it, asks the tutor for a reply,
 * checks the reply, and moves the conversation on. When the last question is
 * done, the answers are saved; the caller then starts their review.
 */
export async function studentTurn(
  id: string,
  text: string,
  input: 'voice' | 'typed',
  transcription: Omit<TranscriptionRecord, 'questionId'> | null,
  model: TutorModel = new FeatherlessTutorModel(),
  now = Date.now()
): Promise<VoiceSession> {
  const { record, set } = await load(id, now);
  const stored = await getVoiceSession(id);
  if (!stored || stored.session.status !== 'active') throw new VoiceError('Start the voice check first.', 409);

  let session = addStudentTurn(set, stored.session, text, input, now);
  const question = currentQuestion(set, session);
  if (transcription) {
    session = { ...session, transcriptions: [...session.transcriptions, { ...transcription, questionId: question.id }] };
  }

  const assignment = findAssignment(record.assignmentId);
  const code = await readAllSubmittedCode(record);
  const log: TutorAttempt[] = [];
  let reply: { say: string; move: 'follow_up' | 'clarify' | 'hint' | 'next' } | null = null;
  let problems: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !reply; attempt++) {
    const prompt = buildTutorPrompt(
      {
        assignmentTitle: assignment?.title ?? record.assignmentId,
        language: assignment?.language,
        code,
        moments: record.moments,
        question,
        questionNumber: session.questionIndex + 1,
        questionCount: set.questions.length,
        turns: turnsFor(session, question.id),
        progress: session.progress[question.id]
      },
      problems
    );
    const entry: TutorAttempt = { at: Date.now(), questionId: question.id, system: prompt.system, user: prompt.user, output: null, validationErrors: [], ms: 0 };
    log.push(entry);
    const started = Date.now();
    try {
      const result = await model.reply(prompt);
      entry.ms = Date.now() - started;
      entry.output = result.output;
      entry.usage = result.usage;
      const checked = checkTutorReply(result.output, question);
      entry.validationErrors = checked.problems;
      if (checked.problems.length === 0) reply = { say: checked.say, move: checked.move };
      problems = checked.problems;
    } catch (err) {
      entry.ms = Date.now() - started;
      entry.validationErrors = [`Request failed: ${err instanceof Error ? err.message : String(err)}`];
      problems = [];
    }
  }
  if (!reply) {
    reply = fallbackReply(session.progress[question.id].followUps < LIMITS.followUps);
    log[log.length - 1].fallback = true;
  }

  session = applyTutorReply(set, { ...session, log: [...session.log, ...log] }, reply, Date.now());
  await save(id, session, stored.version);
  if (session.status === 'finished') {
    await submitAnswers(id, set, session, Date.now());
  }
  return session;
}

/** The student ends the conversation early; what they said so far is saved as their answers. */
export async function finishVoice(id: string, now = Date.now()): Promise<VoiceSession> {
  const { set } = await load(id, now);
  const stored = await getVoiceSession(id);
  if (!stored) throw new VoiceError('Start the voice check first.', 409);
  if (stored.session.status === 'finished') return stored.session;
  const session = closeSession(set, stored.session, 'student', now);
  await save(id, session, stored.version);
  await submitAnswers(id, set, session, now);
  return session;
}

/** The code the recogniser should know, and the language name, for a submission. */
export async function speechContext(id: string): Promise<{ code: { content: string }[]; language: string }> {
  const record = await getSubmission(id);
  if (!record) throw new VoiceError('Submission not found.', 404);
  const assignment = findAssignment(record.assignmentId);
  return { code: await readAllSubmittedCode(record), language: LANGUAGE_LABELS[assignment?.language ?? 'c'] };
}

export { TUTOR_PROMPT_VERSION };
