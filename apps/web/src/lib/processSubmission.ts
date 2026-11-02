import { checkReplay, computeSessionAnalytics, extractMoments, parseSessionLog, Session } from '@codelapse/core';
import { decodeBundle, sha256 } from '@codelapse/core/node';
import { COURSE, findAssignment, findStudent } from './course';
import { RecordingSummary, SubmissionRecord, SubmittedFileInfo } from './types';

export const QUESTION_WINDOW_MS = 60 * 60 * 1000;
export const MAX_BUNDLE_BYTES = 25 * 1024 * 1024;
export const MAX_CODE_FILE_BYTES = 512 * 1024;
export const MAX_CODE_FILES = 20;
const ALLOWED_CODE_FILE = /^(?:[\w.-]+\.(?:c|h)|Makefile|makefile)$/;

export interface UploadedFile {
  name: string;
  bytes: Uint8Array;
}

export interface SubmissionInput {
  studentId: string;
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
  if (!findStudent(input.studentId)) {
    throw new SubmissionError('Choose who you are before submitting.');
  }
  if (input.bundle.bytes.length === 0) {
    throw new SubmissionError('Attach your .codelapse recording.');
  }
  if (input.bundle.bytes.length > MAX_BUNDLE_BYTES) {
    throw new SubmissionError('The .codelapse file is larger than 25 MB.');
  }
  const codeFiles = checkCodeFiles(input.codeFiles);

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
    ignore: (path) => !submittedPaths.has(path) && !isCodePath(path)
  });

  const now = input.now ?? Date.now();
  return {
    id: input.id ?? newSubmissionId(now),
    courseId: COURSE.id,
    assignmentId: assignment.id,
    studentId: input.studentId,
    submittedAt: now,
    questionsCloseAt: now + QUESTION_WINDOW_MS,
    files,
    recording: summarize(sessions, bundle),
    replay,
    moments: extractMoments(sessions)
  };
}

function checkCodeFiles(files: UploadedFile[]): UploadedFile[] {
  const named = files.filter((f) => f.name && f.bytes.length > 0);
  if (named.length === 0) {
    throw new SubmissionError('Attach your code (.c or .h files).');
  }
  if (named.length > MAX_CODE_FILES) {
    throw new SubmissionError(`Upload at most ${MAX_CODE_FILES} code files.`);
  }
  const seen = new Set<string>();
  return named.map((file) => {
    // Browsers send a bare name; never trust a path in it.
    const name = file.name.split(/[\\/]/).pop() ?? '';
    if (!ALLOWED_CODE_FILE.test(name)) {
      throw new SubmissionError(`"${name}" is not a C source file. Upload .c and .h files (or a Makefile).`);
    }
    if (file.bytes.length > MAX_CODE_FILE_BYTES) {
      throw new SubmissionError(`"${name}" is larger than 512 KB.`);
    }
    if (seen.has(name)) {
      throw new SubmissionError(`"${name}" was attached twice.`);
    }
    seen.add(name);
    return { name, bytes: file.bytes };
  });
}

function isCodePath(path: string): boolean {
  return ALLOWED_CODE_FILE.test(path.split('/').pop() ?? '');
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
