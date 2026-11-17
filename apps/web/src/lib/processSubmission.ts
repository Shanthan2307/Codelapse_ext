import { checkReplay, computeSessionAnalytics, extractMoments, parseSessionLog, Session } from '@codelapse/core';
import { decodeBundle, sha256 } from '@codelapse/core/node';
import { COURSE, CODE_FILE_HELP, Language, cleanName, findAssignment, findStudent, isAllowedCodeFile, testerId } from './course';
import { RecordingSummary, SubmissionRecord, SubmittedFileInfo } from './types';

export const QUESTION_WINDOW_MS = 60 * 60 * 1000;
export const MAX_BUNDLE_BYTES = 25 * 1024 * 1024;
export const MAX_CODE_FILE_BYTES = 512 * 1024;
export const MAX_CODE_FILES = 20;

export interface UploadedFile {
  name: string;
  bytes: Uint8Array;
}

export interface SubmissionInput {
  /** A roster student's id. Ignored when studentName is given. */
  studentId?: string;
  /** The name a tester typed on the form. */
  studentName?: string;
  assignmentId: string;
  bundle: UploadedFile;
  codeFiles: UploadedFile[];
  /** Defaults to now; set by tests. */
  now?: number;
  /** Defaults to a random id; set by tests. */
  id?: string;
}

/** A problem with what was uploaded, worded for the student who uploaded it. */
export class SubmissionError extends Error {}

/**
 * Checks an upload and turns it into a stored submission: reads the bundle,
 * compares the recording with the submitted code and finds the moments the
 * questions will ask about. Throws SubmissionError for anything the student
 * needs to fix.
 */
export function processSubmission(input: SubmissionInput): SubmissionRecord {
  const assignment = findAssignment(input.assignmentId);
  if (!assignment) {
    throw new SubmissionError('This assignment does not exist.');
  }
  const studentName = cleanName(input.studentName ?? '');
  const studentId = studentName ? testerId(studentName) : (input.studentId ?? '');
  if (!studentId || (!studentName && !findStudent(studentId))) {
    throw new SubmissionError('Enter your name before submitting.');
  }
  if (input.bundle.bytes.length === 0) {
    throw new SubmissionError('Attach your .codelapse recording.');
  }
  if (input.bundle.bytes.length > MAX_BUNDLE_BYTES) {
    throw new SubmissionError('The .codelapse file is larger than 25 MB.');
  }
  const codeFiles = checkCodeFiles(input.codeFiles, (f) => f.bytes.length, assignment.language);

  let sessions: Session[];
  let bundle: ReturnType<typeof decodeBundle>;
  try {
    bundle = decodeBundle(input.bundle.bytes);
    sessions = bundle.sessions.map((s) => parseSessionLog(s.log));
  } catch (err) {
    throw new SubmissionError(
      `The recording could not be read: ${err instanceof Error ? err.message : 'unknown problem'} ` +
        'Export it again with "CodeLapse: Export Assignment Bundle".'
    );
  }
  if (sessions.length === 0) {
    throw new SubmissionError('The recording has no sessions in it.');
  }

  const recordedPaths = finalRecordedPaths(sessions);
  const files: SubmittedFileInfo[] = codeFiles.map((file) => ({
    name: file.name,
    recordedPath: matchRecordedPath(file.name, recordedPaths),
    size: file.bytes.length,
    sha256: sha256(file.bytes)
  }));
  const submitted = codeFiles.map((file, i) => ({
    path: files[i].recordedPath,
    content: new TextDecoder().decode(file.bytes)
  }));

  // Only compare what was asked for: other recorded files (notes, tests) are listed but not required.
  const submittedPaths = new Set(submitted.map((s) => s.path));
  const replay = checkReplay(sessions, submitted, {
    ignore: (path) => !submittedPaths.has(path) && !isCodePath(path, assignment.language)
  });

  const now = input.now ?? Date.now();
  return {
    id: input.id ?? newSubmissionId(now),
    courseId: COURSE.id,
    assignmentId: assignment.id,
    studentId,
    ...(studentName ? { studentName } : {}),
    submittedAt: now,
    questionsCloseAt: now + QUESTION_WINDOW_MS,
    files,
    recording: summarize(sessions, bundle),
    replay,
    moments: extractMoments(sessions)
  };
}

/**
 * The checks that can be made before any bytes arrive, from names and sizes
 * only: used to hand out direct-upload links. processSubmission still checks
 * the files themselves afterwards.
 */
export function checkUploadPlan(input: {
  assignmentId: string;
  studentName: string;
  recording: { name: string; size: number };
  code: { name: string; size: number }[];
}): { assignmentId: string; codeNames: string[] } {
  const assignment = findAssignment(input.assignmentId);
  if (!assignment) throw new SubmissionError('This assignment does not exist.');
  if (!testerId(cleanName(input.studentName))) throw new SubmissionError('Enter your name before submitting.');
  if (!(input.recording.size > 0)) throw new SubmissionError('Attach your .codelapse recording.');
  if (input.recording.size > MAX_BUNDLE_BYTES) throw new SubmissionError('The .codelapse file is larger than 25 MB.');
  const code = checkCodeFiles(input.code, (f) => (Number.isFinite(f.size) ? f.size : 0), assignment.language);
  return { assignmentId: assignment.id, codeNames: code.map((f) => f.name) };
}

function checkCodeFiles<T extends { name: string }>(files: T[], sizeOf: (file: T) => number, language: Language): T[] {
  const help = CODE_FILE_HELP[language];
  const named = files.filter((f) => f.name && sizeOf(f) > 0);
  if (named.length === 0) {
    throw new SubmissionError(language === 'c' ? 'Attach your code (.c or .h files).' : 'Attach your code (.py files).');
  }
  if (named.length > MAX_CODE_FILES) {
    throw new SubmissionError(`Upload at most ${MAX_CODE_FILES} code files.`);
  }
  const seen = new Set<string>();
  return named.map((file) => {
    // Browsers send a bare name; never trust a path in it.
    const name = file.name.split(/[\\/]/).pop() ?? '';
    if (!isAllowedCodeFile(language, name)) {
      throw new SubmissionError(`"${name}" is not ${help.kind}. ${help.upload}`);
    }
    if (sizeOf(file) > MAX_CODE_FILE_BYTES) {
      throw new SubmissionError(`"${name}" is larger than 512 KB.`);
    }
    if (seen.has(name)) {
      throw new SubmissionError(`"${name}" was attached twice.`);
    }
    seen.add(name);
    return { ...file, name };
  });
}

function isCodePath(path: string, language: Language): boolean {
  return isAllowedCodeFile(language, path.split('/').pop() ?? '');
}

function finalRecordedPaths(sessions: Session[]): string[] {
  return [...new Set(sessions.flatMap((s) => s.snapshots.map((snap) => snap.filePath)))];
}

/**
 * Uploads are bare file names, while the recording keeps paths relative to the
 * assignment folder (e.g. "src/reverse.c"). Use the recorded path when exactly
 * one recorded file has that name.
 */
export function matchRecordedPath(name: string, recordedPaths: string[]): string {
  if (recordedPaths.includes(name)) {
    return name;
  }
  const sameName = recordedPaths.filter((p) => p.split('/').pop() === name);
  return sameName.length === 1 ? sameName[0] : name;
}

function summarize(sessions: Session[], bundle: ReturnType<typeof decodeBundle>): RecordingSummary {
  const summary: RecordingSummary = {
    folderName: bundle.folderName,
    extensionVersion: bundle.extensionVersion,
    bundleCreatedAt: bundle.createdAt,
    sessionCount: sessions.length,
    recordedMs: 0,
    typedChars: 0,
    bulkInsertedChars: 0,
    preExistingChars: 0,
    runs: { passed: 0, failed: 0, unknown: 0 }
  };
  for (const session of sessions) {
    const a = computeSessionAnalytics(session);
    summary.recordedMs += a.durationMs;
    summary.typedChars += a.typedChars;
    summary.bulkInsertedChars += a.bulkInsertedChars;
    summary.preExistingChars += a.preExistingChars;
    summary.runs.passed += a.successfulRuns;
    summary.runs.failed += a.failedRuns;
    summary.runs.unknown += a.unknownRuns;
  }
  return summary;
}

function newSubmissionId(now: number): string {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
