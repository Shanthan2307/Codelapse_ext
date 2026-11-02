import type { FileCheck, Moment, ReplayCheckResult } from '@codelapse/core';

/** What a submission's recording shows, totalled over all its sessions. */
export interface RecordingSummary {
  folderName: string;
  extensionVersion: string;
  bundleCreatedAt: number;
  sessionCount: number;
  /** Time between each session's start and end, added up. */
  recordedMs: number;
  typedChars: number;
  bulkInsertedChars: number;
  preExistingChars: number;
  runs: { passed: number; failed: number; unknown: number };
}

export interface SubmittedFileInfo {
  /** Name as uploaded. */
  name: string;
  /** Path in the recording it was compared with. */
  recordedPath: string;
  size: number;
  sha256: string;
}

export interface SubmissionRecord {
  id: string;
  courseId: string;
  assignmentId: string;
  studentId: string;
  submittedAt: number;
  /** The feedback questions close this long after submission (Phase 4). */
  questionsCloseAt: number;
  files: SubmittedFileInfo[];
  recording: RecordingSummary;
  replay: ReplayCheckResult;
  moments: Moment[];
}

export type { FileCheck, Moment, ReplayCheckResult };
