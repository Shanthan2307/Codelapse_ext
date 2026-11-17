import type { SubmissionRecord } from '../types';

/** The JSON records kept for each submission, besides the submission itself. */
export type DocKind = 'questions' | 'answers' | 'evaluation' | 'code_check' | 'hint_progress' | 'feedback';

export const DOC_KINDS: readonly DocKind[] = ['questions', 'answers', 'evaluation', 'code_check', 'hint_progress', 'feedback'];

/** A stored record and an opaque version, for updates that must not overwrite someone else's. */
export interface StoredDoc<T> {
  data: T;
  version: string;
}

/**
 * Where submissions live. The local backend keeps today's folder of files
 * (for `npm run demo`, development and tests); the Supabase backend keeps the
 * same records in Postgres and the files in a private Storage bucket, so a
 * hosted site (Vercel) has one place for all the data.
 *
 * File paths are relative, e.g. "submissions/<id>/recording.codelapse".
 */
export interface Backend {
  readonly name: 'local' | 'supabase' | 'memory';

  saveSubmission(record: SubmissionRecord): Promise<void>;
  getSubmission(id: string): Promise<SubmissionRecord | null>;
  /** Every finished submission, newest first. */
  listSubmissions(): Promise<SubmissionRecord[]>;

  getDoc<T>(id: string, kind: DocKind): Promise<StoredDoc<T> | null>;
  /** Writes a record, replacing any earlier one. */
  putDoc(id: string, kind: DocKind, data: unknown): Promise<void>;
  /** Writes a record only if there is none yet; false if one exists. */
  insertDocOnce(id: string, kind: DocKind, data: unknown): Promise<boolean>;
  /**
   * Writes a record only if it is still at `version` (null: only if there is
   * none yet). False when someone else changed it first.
   */
  updateDocIfVersion(id: string, kind: DocKind, data: unknown, version: string | null): Promise<boolean>;

  getFile(path: string): Promise<Uint8Array | null>;
  putFile(path: string, bytes: Uint8Array): Promise<void>;
  removeFiles(paths: string[]): Promise<void>;
  /**
   * A one-off address the browser can PUT a file to directly, for hosts that
   * limit request size (Vercel). Null when uploads go through the site.
   */
  signedUpload(path: string): Promise<{ url: string; headers: Record<string, string> } | null>;

  getSetting(key: string): Promise<string | null>;
  /** Stores a setting unless it exists; returns the value that is stored. */
  setSettingOnce(key: string, value: string): Promise<string>;
}

export const SAFE_ID = /^[a-z0-9-]+$/;
