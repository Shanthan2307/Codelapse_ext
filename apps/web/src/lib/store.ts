import { SubmissionRecord } from './types';
import { UploadedFile } from './processSubmission';
import type { AnswerSet, QuestionSet } from './questions/types';
import type { EvaluationSet } from './evaluation/types';
import type { CodeCheck, HintProgress } from './codecheck/types';
import { backend } from './storage';
import { SAFE_ID } from './storage/types';
import { STALLED_AFTER_MS } from './ai/timeouts';

/**
 * Everything the site stores, by submission. Where it lives is decided by
 * lib/storage: the local data folder (npm run demo) or Supabase (the hosted
 * site). The layout is the same either way:
 *
 *   submission                   the SubmissionRecord
 *   submissions/<id>/recording.codelapse, submissions/<id>/code/<file>
 *   records: questions, answers, evaluation, code_check, hint_progress, feedback
 */
export { dataDir } from './storage/local';

const filePath = (id: string, name: string) => `submissions/${id}/${name}`;
/** Browsers send a bare name; never trust a path in it. */
const baseName = (name: string) => name.split(/[\\/]/).pop() ?? '';

export async function saveSubmission(record: SubmissionRecord, bundle: UploadedFile, codeFiles: UploadedFile[]): Promise<void> {
  if (!SAFE_ID.test(record.id)) throw new Error(`Unsafe submission id: ${record.id}`);
  await backend().putFile(filePath(record.id, 'recording.codelapse'), bundle.bytes);
  for (const file of codeFiles) {
    await backend().putFile(filePath(record.id, `code/${baseName(file.name)}`), file.bytes);
  }
  // Saved last, so a submission without it is an unfinished upload and is skipped.
  await backend().saveSubmission(record);
}

export function getSubmission(id: string): Promise<SubmissionRecord | null> {
  return SAFE_ID.test(id) ? backend().getSubmission(id) : Promise.resolve(null);
}

/** Every finished submission, newest first. */
export function listSubmissions(): Promise<SubmissionRecord[]> {
  return backend().listSubmissions();
}

/** Each student's latest submission for an assignment. */
export async function latestSubmissions(assignmentId: string): Promise<SubmissionRecord[]> {
  const latest = new Map<string, SubmissionRecord>();
  for (const record of await listSubmissions()) {
    if (record.assignmentId === assignmentId && !latest.has(record.studentId)) {
      latest.set(record.studentId, record);
    }
  }
  return [...latest.values()];
}

/** The submitted code, for the instructor's view. */
export async function readSubmittedCode(id: string, name: string): Promise<string | null> {
  if (!SAFE_ID.test(id) || !baseName(name)) return null;
  const bytes = await backend().getFile(filePath(id, `code/${baseName(name)}`));
  return bytes ? new TextDecoder().decode(bytes) : null;
}

/** The stored .codelapse recording, for the replay. */
export function readRecording(id: string): Promise<Uint8Array | null> {
  return SAFE_ID.test(id) ? backend().getFile(filePath(id, 'recording.codelapse')) : Promise.resolve(null);
}

/** The submitted code files, for the question generator. */
export async function readAllSubmittedCode(record: SubmissionRecord): Promise<{ name: string; content: string }[]> {
  return Promise.all(
    record.files.map(async (f) => ({ name: f.name, content: (await readSubmittedCode(record.id, f.name)) ?? '' }))
  );
}

async function readDoc<T>(id: string, kind: Parameters<ReturnType<typeof backend>['getDoc']>[1]): Promise<T | null> {
  if (!SAFE_ID.test(id)) return null;
  return (await backend().getDoc<T>(id, kind))?.data ?? null;
}

/**
 * An AI step still "pending" long after it started was cut off before it
 * could save its result (on a hosted site, by the function time limit). It is
 * shown as failed, so the instructor gets the usual "Try again" button.
 */
export function markStalled<T extends { status: string; startedAt: number; error?: string }>(doc: T | null, now = Date.now()): T | null {
  if (doc?.status !== 'pending' || now - doc.startedAt < STALLED_AFTER_MS) return doc;
  return { ...doc, status: 'failed', error: 'This stopped before finishing, probably because the server hit its time limit. Try again.' };
}

// ---- Questions and answers ----

export function saveQuestionSet(id: string, set: QuestionSet): Promise<void> {
  return backend().putDoc(id, 'questions', set);
}

export async function getQuestionSet(id: string): Promise<QuestionSet | null> {
  return markStalled(await readDoc<QuestionSet>(id, 'questions'));
}

/** Saves answers once; returns false if answers already exist. */
export function saveAnswers(id: string, answers: AnswerSet): Promise<boolean> {
  return SAFE_ID.test(id) ? backend().insertDocOnce(id, 'answers', answers) : Promise.resolve(false);
}

export function getAnswers(id: string): Promise<AnswerSet | null> {
  return readDoc<AnswerSet>(id, 'answers');
}

// ---- Answer evaluation: for instructors only ----

export function saveEvaluation(id: string, set: EvaluationSet): Promise<void> {
  return backend().putDoc(id, 'evaluation', set);
}

export async function getEvaluation(id: string): Promise<EvaluationSet | null> {
  return markStalled(await readDoc<EvaluationSet>(id, 'evaluation'));
}

// ---- Code check (made at submission) and the student's use of its hints ----

export function saveCodeCheck(id: string, check: CodeCheck): Promise<void> {
  return backend().putDoc(id, 'code_check', check);
}

export async function getCodeCheck(id: string): Promise<CodeCheck | null> {
  return markStalled(await readDoc<CodeCheck>(id, 'code_check'));
}

export function saveHintProgress(id: string, progress: HintProgress): Promise<void> {
  return backend().putDoc(id, 'hint_progress', progress);
}

export function getHintProgress(id: string): Promise<HintProgress | null> {
  return readDoc<HintProgress>(id, 'hint_progress');
}

/**
 * Changes the hint progress safely when two requests (or two server
 * instances) arrive at once: reads it, applies `change`, and writes only if
 * nobody else wrote in between, trying again a few times.
 */
export async function updateHintProgress(
  id: string,
  change: (current: HintProgress | null) => HintProgress
): Promise<HintProgress> {
  if (!SAFE_ID.test(id)) throw new Error(`Unsafe submission id: ${id}`);
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await backend().getDoc<HintProgress>(id, 'hint_progress');
    const next = change(current?.data ?? null);
    if (await backend().updateDocIfVersion(id, 'hint_progress', next, current?.version ?? null)) return next;
  }
  throw new Error('The hint progress kept changing; try again.');
}
