import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import type { SubmissionRecord } from '../types';
import { Backend, DocKind, SAFE_ID, StoredDoc } from './types';

/**
 * Submissions as plain files, one folder each, easy to inspect and back up:
 *
 *   <data>/submissions/<id>/submission.json
 *   <data>/submissions/<id>/recording.codelapse
 *   <data>/submissions/<id>/code/<file>
 *   <data>/submissions/<id>/questions.json, answers.json, …
 *
 * The folder is CODELAPSE_DATA_DIR, or apps/web/data by default. It holds
 * student code and recordings, and is ignored by git.
 */
export function dataDir(): string {
  return process.env.CODELAPSE_DATA_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), 'data');
}

/** File name of each record kind, as the folder has always used them. */
export const DOC_FILES: Record<DocKind, string> = {
  questions: 'questions.json',
  answers: 'answers.json',
  evaluation: 'evaluation.json',
  code_check: 'code-check.json',
  hint_progress: 'hint-progress.json',
  feedback: 'instructor-feedback.json',
  ai_detection: 'ai-detection.json'
};

const submissionsDir = () => path.join(dataDir(), 'submissions');

function docFile(id: string, kind: DocKind): string {
  if (!SAFE_ID.test(id)) throw new Error(`Unsafe submission id: ${id}`);
  return path.join(submissionsDir(), id, DOC_FILES[kind]);
}

/** A relative path inside the data folder; refuses anything that would leave it. */
function resolve(relative: string): string {
  const root = path.resolve(/*turbopackIgnore: true*/ dataDir());
  const full = path.resolve(/*turbopackIgnore: true*/ root, relative);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error(`Path outside the data folder: ${relative}`);
  return full;
}

const versionOf = (text: string) => createHash('sha1').update(text).digest('hex');

async function writeAtomic(file: string, text: string): Promise<void> {
  await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
  // Write then rename, so a reader never sees half a file.
  await fs.writeFile(/*turbopackIgnore: true*/ `${file}.tmp`, text);
  await fs.rename(/*turbopackIgnore: true*/ `${file}.tmp`, file);
}

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(/*turbopackIgnore: true*/ file, 'utf-8');
  } catch {
    return null;
  }
}

// Conditional updates are serialised per record within this process, which is all the local site has.
const locks = new Map<string, Promise<unknown>>();
function locked<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (locks.get(key) ?? Promise.resolve()).then(task, task);
  const tail = run.catch(() => undefined);
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}

export class LocalBackend implements Backend {
  readonly name = 'local' as const;

  async saveSubmission(record: SubmissionRecord): Promise<void> {
    // Written after the files, so a folder without it is an unfinished upload and is skipped.
    await writeAtomic(path.join(submissionsDir(), record.id, 'submission.json'), JSON.stringify(record, null, 2));
  }

  async getSubmission(id: string): Promise<SubmissionRecord | null> {
    if (!SAFE_ID.test(id)) return null;
    const text = await readText(path.join(submissionsDir(), id, 'submission.json'));
    return text ? (JSON.parse(text) as SubmissionRecord) : null;
  }

  async listSubmissions(): Promise<SubmissionRecord[]> {
    let ids: string[];
    try {
      ids = await fs.readdir(/*turbopackIgnore: true*/ submissionsDir());
    } catch {
      return [];
    }
    const records = await Promise.all(ids.map((id) => this.getSubmission(id)));
    return records.filter((r): r is SubmissionRecord => r !== null).sort((a, b) => b.submittedAt - a.submittedAt);
  }

  async getDoc<T>(id: string, kind: DocKind): Promise<StoredDoc<T> | null> {
    if (!SAFE_ID.test(id)) return null;
    const text = await readText(docFile(id, kind));
    if (text === null) return null;
    try {
      return { data: JSON.parse(text) as T, version: versionOf(text) };
    } catch {
      return null;
    }
  }

  async putDoc(id: string, kind: DocKind, data: unknown): Promise<void> {
    await writeAtomic(docFile(id, kind), JSON.stringify(data, null, 2));
  }

  async insertDocOnce(id: string, kind: DocKind, data: unknown): Promise<boolean> {
    if (!SAFE_ID.test(id)) return false;
    try {
      await fs.writeFile(/*turbopackIgnore: true*/ docFile(id, kind), JSON.stringify(data, null, 2), { flag: 'wx' });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw err;
    }
  }

  updateDocIfVersion(id: string, kind: DocKind, data: unknown, version: string | null): Promise<boolean> {
    const file = docFile(id, kind);
    return locked(file, async () => {
      const text = await readText(file);
      const current = text === null ? null : versionOf(text);
      if (current !== version) return false;
      await writeAtomic(file, JSON.stringify(data, null, 2));
      return true;
    });
  }

  async getFile(relative: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await fs.readFile(/*turbopackIgnore: true*/ resolve(relative)));
    } catch {
      return null;
    }
  }

  async putFile(relative: string, bytes: Uint8Array): Promise<void> {
    const file = resolve(relative);
    await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
    await fs.writeFile(/*turbopackIgnore: true*/ file, bytes);
  }

  async removeFiles(paths: string[]): Promise<void> {
    await Promise.all(paths.map((p) => fs.rm(/*turbopackIgnore: true*/ resolve(p), { force: true })));
  }

  async signedUpload(): Promise<null> {
    return null;
  }

  async getSetting(key: string): Promise<string | null> {
    const text = await readText(resolve(`${key}.txt`));
    return text?.trim() || null;
  }

  async setSettingOnce(key: string, value: string): Promise<string> {
    const file = resolve(`${key}.txt`);
    await fs.mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
    try {
      await fs.writeFile(/*turbopackIgnore: true*/ file, `${value}\n`, { flag: 'wx', mode: 0o600 });
      return value;
    } catch {
      // Another request created it first: use theirs.
      return (await fs.readFile(/*turbopackIgnore: true*/ file, 'utf-8')).trim();
    }
  }
}
