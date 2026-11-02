import { Session, Snapshot } from './models';

/**
 * Does the recording end at exactly the code the student submitted?
 *
 * This compares the last recorded version of each file with the submitted
 * file. A mismatch says the recording does not account for the submitted code
 * (for example, it was changed outside the recorded folder or after recording
 * stopped). It is a reason to look, never a finding of misconduct.
 */

export interface SubmittedFile {
  /** Path relative to the assignment folder, with "/" separators. */
  path: string;
  content: string;
}

export type FileCheckStatus = 'match' | 'whitespace-only' | 'differs' | 'not-recorded' | 'not-submitted';

/** How a file's recorded text came to be, from the recording's edit data. */
export interface FileAuthorship {
  typedChars: number;
  bulkInsertedChars: number;
  /** Characters already in the file when the recording first saw it. */
  preExistingChars: number;
  /** True when the recording saw the file but never saw it edited. */
  unedited: boolean;
  /**
   * Times the file was different at the start of a later session from how the
   * previous session left it: it changed while nothing was being recorded.
   */
  changedBetweenSessions: number;
}

export interface FileCheck {
  path: string;
  status: FileCheckStatus;
  /** One plain sentence an instructor can read. */
  reason: string;
  /** For 'differs': the first line (1-based) where recorded and submitted text part. */
  firstDifferentLine?: number;
  recordedLines?: number;
  submittedLines?: number;
  /** Absent for files that were never recorded. */
  authorship?: FileAuthorship;
}

export interface ReplayCheckResult {
  /** 'consistent' when every submitted file matches its recording, ignoring whitespace. */
  verdict: 'consistent' | 'inconsistent';
  /** Submitted files first (in the order given), then recorded files that were not submitted. */
  files: FileCheck[];
  counts: Record<FileCheckStatus, number>;
}

export interface ReplayCheckOptions {
  /** Files to leave out entirely, e.g. compiled binaries or a README. */
  ignore?: (path: string) => boolean;
}

interface TimedSnapshot {
  time: number;
  sessionIndex: number;
  snapshot: Snapshot;
}

export function checkReplay(
  sessions: Session[],
  submitted: SubmittedFile[],
  options: ReplayCheckOptions = {}
): ReplayCheckResult {
  const ignore = options.ignore ?? (() => false);
  const history = recordedHistory(sessions, ignore);
  const files: FileCheck[] = [];
  const submittedPaths = new Set<string>();

  for (const file of submitted) {
    if (ignore(file.path)) {
      continue;
    }
    submittedPaths.add(file.path);
    const snapshots = history.get(file.path);
    if (!snapshots) {
      files.push({
        path: file.path,
        status: 'not-recorded',
        reason: 'This file was submitted, but the recording never saw it.'
      });
      continue;
    }
    files.push(compareFile(file, snapshots));
  }

  for (const [path, snapshots] of history) {
    if (!submittedPaths.has(path)) {
      files.push({
        path,
        status: 'not-submitted',
        reason: 'The recording has this file, but it was not submitted.',
        recordedLines: countLines(last(snapshots).snapshot.content),
        authorship: authorshipOf(snapshots)
      });
    }
  }

  const counts: Record<FileCheckStatus, number> = {
    match: 0,
    'whitespace-only': 0,
    differs: 0,
    'not-recorded': 0,
    'not-submitted': 0
  };
  for (const file of files) {
    counts[file.status] += 1;
  }

  const consistent = files.every((f) => f.status !== 'differs' && f.status !== 'not-recorded');
  return { verdict: consistent ? 'consistent' : 'inconsistent', files, counts };
}

/** Every snapshot of every file, in the order they were recorded across sessions. */
function recordedHistory(sessions: Session[], ignore: (path: string) => boolean): Map<string, TimedSnapshot[]> {
  const ordered = sessions
    .map((session, index) => ({ session, index }))
    .sort((a, b) => a.session.startTime - b.session.startTime);

  const all: TimedSnapshot[] = [];
  ordered.forEach(({ session }, sessionIndex) => {
    for (const snapshot of session.snapshots) {
      if (!ignore(snapshot.filePath)) {
        all.push({ time: session.startTime + snapshot.timestamp, sessionIndex, snapshot });
      }
    }
  });
  // Stable sort keeps recording order for snapshots taken at the same moment.
  all.sort((a, b) => a.time - b.time);

  const byFile = new Map<string, TimedSnapshot[]>();
  for (const entry of all) {
    const list = byFile.get(entry.snapshot.filePath) ?? [];
    list.push(entry);
    byFile.set(entry.snapshot.filePath, list);
  }
  return byFile;
}

function compareFile(file: SubmittedFile, snapshots: TimedSnapshot[]): FileCheck {
  const recorded = last(snapshots).snapshot.content;
  const authorship = authorshipOf(snapshots);
  const recordedLines = countLines(recorded);
  const submittedLines = countLines(file.content);

  if (recorded === file.content) {
    return {
      path: file.path,
      status: 'match',
      reason: 'The recording ends with exactly this file.',
      recordedLines,
      submittedLines,
      authorship
    };
  }
  if (normalizeWhitespace(recorded) === normalizeWhitespace(file.content)) {
    return {
      path: file.path,
      status: 'whitespace-only',
      reason: 'The recording ends with this file; only line endings or trailing spaces differ.',
      recordedLines,
      submittedLines,
      authorship
    };
  }

  const firstDifferentLine = firstDifference(recorded, file.content);
  return {
    path: file.path,
    status: 'differs',
    reason:
      `The submitted file differs from the last recorded version from line ${firstDifferentLine} ` +
      `(recorded ${recordedLines} lines, submitted ${submittedLines}).`,
    firstDifferentLine,
    recordedLines,
    submittedLines,
    authorship
  };
}

function authorshipOf(snapshots: TimedSnapshot[]): FileAuthorship {
  let typedChars = 0;
  let bulkInsertedChars = 0;
  let changedBetweenSessions = 0;

  for (let i = 0; i < snapshots.length; i++) {
    const { snapshot, sessionIndex } = snapshots[i];
    if (snapshot.edit) {
      typedChars += snapshot.edit.typedChars;
      bulkInsertedChars += snapshot.edit.bulkInsertedChars;
    }
    // First sight of the file in a later session, before any edit in it: it
    // should still read as the previous session left it.
    const previous = snapshots[i - 1];
    if (previous && previous.sessionIndex !== sessionIndex && !snapshot.edit) {
      if (previous.snapshot.content !== snapshot.content) {
        changedBetweenSessions += 1;
      }
    }
  }

  // Only the very first sighting counts as pre-existing: later sessions start
  // from what earlier sessions recorded.
  const first = snapshots[0].snapshot;
  const firstInserted = (first.edit?.typedChars ?? 0) + (first.edit?.bulkInsertedChars ?? 0);
  const preExistingChars = Math.max(0, first.content.length - firstInserted + (first.edit?.deletedChars ?? 0));

  return {
    typedChars,
    bulkInsertedChars,
    preExistingChars,
    unedited: snapshots.every((s) => !s.snapshot.edit),
    changedBetweenSessions
  };
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}

function firstDifference(a: string, b: string): number {
  const aLines = a.replace(/\r\n?/g, '\n').split('\n');
  const bLines = b.replace(/\r\n?/g, '\n').split('\n');
  const length = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < length; i++) {
    if ((aLines[i] ?? '').replace(/[ \t]+$/, '') !== (bLines[i] ?? '').replace(/[ \t]+$/, '')) {
      return i + 1;
    }
  }
  return length;
}

/** Lines as an editor shows them: a final newline does not start another line. */
function countLines(text: string): number {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  return normalized === '' ? 0 : normalized.split('\n').length;
}

function last<T>(items: T[]): T {
  return items[items.length - 1];
}
