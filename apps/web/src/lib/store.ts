import { promises as fs } from 'fs';
import path from 'path';
import { SubmissionRecord } from './types';
import { UploadedFile } from './processSubmission';

/**
 * Submissions are kept as plain files, one folder each, so they are easy to
 * inspect and back up during the demo:
 *
 *   <data>/submissions/<id>/submission.json
 *   <data>/submissions/<id>/recording.codelapse
 *   <data>/submissions/<id>/code/<file>
 *
 * The folder is CODELAPSE_DATA_DIR, or apps/web/data by default. It holds
 * student code and recordings, and is ignored by git.
 */
export function dataDir(): string {
  return process.env.CODELAPSE_DATA_DIR ?? path.join(process.cwd(), 'data');
}

const submissionsDir = () => path.join(dataDir(), 'submissions');
const SAFE_ID = /^[a-z0-9-]+$/;

export async function saveSubmission(
  record: SubmissionRecord,
  bundle: UploadedFile,
  codeFiles: UploadedFile[]
): Promise<void> {
  const dir = path.join(submissionsDir(), record.id);
  await fs.mkdir(path.join(dir, 'code'), { recursive: true });
  await fs.writeFile(path.join(dir, 'recording.codelapse'), bundle.bytes);
  for (const file of codeFiles) {
    await fs.writeFile(path.join(dir, 'code', path.basename(file.name)), file.bytes);
  }
  // Written last, so a folder without it is an unfinished upload and is skipped.
  await fs.writeFile(path.join(dir, 'submission.json'), JSON.stringify(record, null, 2));
}

export async function getSubmission(id: string): Promise<SubmissionRecord | null> {
  if (!SAFE_ID.test(id)) {
    return null;
  }
  try {
    return JSON.parse(await fs.readFile(path.join(submissionsDir(), id, 'submission.json'), 'utf-8'));
  } catch {
    return null;
  }
}

/** Every finished submission, newest first. */
export async function listSubmissions(): Promise<SubmissionRecord[]> {
  let ids: string[];
  try {
    ids = await fs.readdir(submissionsDir());
  } catch {
    return [];
  }
  const records = await Promise.all(ids.map((id) => getSubmission(id)));
  return records.filter((r): r is SubmissionRecord => r !== null).sort((a, b) => b.submittedAt - a.submittedAt);
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
  if (!SAFE_ID.test(id)) {
    return null;
  }
  try {
    return await fs.readFile(path.join(submissionsDir(), id, 'code', path.basename(name)), 'utf-8');
  } catch {
    return null;
  }
}
