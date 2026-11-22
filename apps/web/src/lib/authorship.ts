import { analyzeAuthorship, type AuthorshipReport } from '@codelapse/core';
import { findAssignment } from './course';
import { readSessions } from './recording';
import { readAllSubmittedCode } from './store';
import type { SubmissionRecord } from './types';

/**
 * The submission's signs of AI use: stored at upload, or worked out from the
 * stored recording for submissions made before this analysis existed.
 */
export async function getAuthorship(record: SubmissionRecord): Promise<AuthorshipReport | null> {
  if (record.authorship) return record.authorship;
  const assignment = findAssignment(record.assignmentId);
  const sessions = await readSessions(record.id);
  if (!assignment || !sessions) return null;
  const code = await readAllSubmittedCode(record);
  const submitted = code.map((c, i) => ({ path: record.files[i].recordedPath, content: c.content }));
  return analyzeAuthorship({ sessions, submitted, language: assignment.language });
}
