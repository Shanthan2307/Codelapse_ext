import type { SubmissionRecord } from '../types';
import { Backend, DocKind, SAFE_ID, StoredDoc } from './types';

/** A Supabase request that failed in a way the caller cannot handle. */
export class SupabaseError extends Error {}

export interface SupabaseConfig {
  /** Project address, e.g. https://abcd.supabase.co */
  url: string;
  /** The secret (service role) key. Server-only: it bypasses row-level security. */
  key: string;
  bucket: string;
  fetch?: typeof fetch;
}

export function supabaseConfigFromEnv(): SupabaseConfig {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, '');
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !key) {
    throw new SupabaseError('CODELAPSE_STORAGE is "supabase" but SUPABASE_URL or SUPABASE_SECRET_KEY is not set.');
  }
  return { url, key, bucket: process.env.SUPABASE_BUCKET?.trim() || 'codelapse' };
}

const encodePath = (p: string) => p.split('/').map(encodeURIComponent).join('/');

/**
 * Supabase as the one place for all data: Postgres holds the submission and
 * its records (tables from apps/web/supabase/schema.sql), and a private
 * Storage bucket holds the recording and code files. Talks to Supabase's REST
 * APIs (PostgREST and Storage) directly, so no extra package is needed.
 */
export class SupabaseBackend implements Backend {
  readonly name = 'supabase' as const;
  private readonly fetch: typeof fetch;

  constructor(private readonly config: SupabaseConfig) {
    this.fetch = config.fetch ?? fetch;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const { key } = this.config;
    // New-style secret keys (sb_secret_…) go in apikey only; legacy service_role JWTs also as a bearer token.
    return key.startsWith('sb_') ? { apikey: key, ...extra } : { apikey: key, Authorization: `Bearer ${key}`, ...extra };
  }

  private async rest(path: string, init: Omit<RequestInit, 'headers'> & { headers?: Record<string, string> } = {}): Promise<Response> {
    return this.fetch(`${this.config.url}/rest/v1/${path}`, {
      ...init,
      cache: 'no-store',
      headers: this.headers({ 'Content-Type': 'application/json', ...(init.headers ?? {}) })
    });
  }

  private async fail(response: Response, what: string): Promise<never> {
    const body = await response.text().catch(() => '');
    throw new SupabaseError(`Supabase could not ${what} (HTTP ${response.status}): ${body.slice(0, 300)}`);
  }

  private async rows<T>(path: string, what: string): Promise<T[]> {
    const response = await this.rest(path);
    if (!response.ok) await this.fail(response, what);
    return (await response.json()) as T[];
  }

  // ---- Submissions ----

  async saveSubmission(record: SubmissionRecord): Promise<void> {
    const response = await this.rest('submissions?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        id: record.id,
        assignment_id: record.assignmentId,
        student_id: record.studentId,
        student_name: record.studentName ?? null,
        submitted_at: new Date(record.submittedAt).toISOString(),
        record
      })
    });
    if (!response.ok) await this.fail(response, 'save the submission');
  }

  async getSubmission(id: string): Promise<SubmissionRecord | null> {
    if (!SAFE_ID.test(id)) return null;
    const rows = await this.rows<{ record: SubmissionRecord }>(`submissions?id=eq.${id}&select=record`, 'read the submission');
    return rows[0]?.record ?? null;
  }

  async listSubmissions(): Promise<SubmissionRecord[]> {
    const rows = await this.rows<{ record: SubmissionRecord }>('submissions?select=record&order=submitted_at.desc', 'list submissions');
    return rows.map((r) => r.record);
  }

  // ---- Records ----

  private docFilter(id: string, kind: DocKind): string {
    if (!SAFE_ID.test(id)) throw new SupabaseError(`Unsafe submission id: ${id}`);
    return `submission_id=eq.${id}&kind=eq.${kind}`;
  }

  async getDoc<T>(id: string, kind: DocKind): Promise<StoredDoc<T> | null> {
    if (!SAFE_ID.test(id)) return null;
    const rows = await this.rows<{ data: T; version: number }>(`submission_docs?${this.docFilter(id, kind)}&select=data,version`, `read ${kind}`);
    return rows[0] ? { data: rows[0].data, version: String(rows[0].version) } : null;
  }

  async putDoc(id: string, kind: DocKind, data: unknown): Promise<void> {
    this.docFilter(id, kind);
    const response = await this.rest('submission_docs?on_conflict=submission_id,kind', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ submission_id: id, kind, data })
    });
    if (!response.ok) await this.fail(response, `save ${kind}`);
  }

  async insertDocOnce(id: string, kind: DocKind, data: unknown): Promise<boolean> {
    this.docFilter(id, kind);
    const response = await this.rest('submission_docs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ submission_id: id, kind, data })
    });
    if (response.status === 409) return false;
    if (!response.ok) await this.fail(response, `save ${kind}`);
    return true;
  }

  async updateDocIfVersion(id: string, kind: DocKind, data: unknown, version: string | null): Promise<boolean> {
    if (version === null) return this.insertDocOnce(id, kind, data);
    if (!/^\d+$/.test(version)) return false;
    // The version filter makes this a compare-and-set; a trigger bumps version on every update.
    const response = await this.rest(`submission_docs?${this.docFilter(id, kind)}&version=eq.${version}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ data })
    });
    if (!response.ok) await this.fail(response, `update ${kind}`);
    return ((await response.json()) as unknown[]).length > 0;
  }

  // ---- Files ----

  private objectUrl(path: string): string {
    return `${this.config.url}/storage/v1/object/${encodeURIComponent(this.config.bucket)}/${encodePath(path)}`;
  }

  async getFile(path: string): Promise<Uint8Array | null> {
    const response = await this.fetch(this.objectUrl(path), { headers: this.headers(), cache: 'no-store' });
    // Storage answers a missing object with 400 or 404.
    if (response.status === 400 || response.status === 404) return null;
    if (!response.ok) await this.fail(response, `read ${path}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async putFile(path: string, bytes: Uint8Array): Promise<void> {
    const response = await this.fetch(this.objectUrl(path), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' }),
      body: bytes as unknown as BodyInit
    });
    if (!response.ok) await this.fail(response, `store ${path}`);
  }

  async removeFiles(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const response = await this.fetch(`${this.config.url}/storage/v1/object/${encodeURIComponent(this.config.bucket)}`, {
      method: 'DELETE',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prefixes: paths })
    });
    if (!response.ok) await this.fail(response, 'remove files');
  }

  async signedUpload(path: string): Promise<{ url: string; headers: Record<string, string> }> {
    const response = await this.fetch(
      `${this.config.url}/storage/v1/object/upload/sign/${encodeURIComponent(this.config.bucket)}/${encodePath(path)}`,
      { method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }), body: '{}' }
    );
    if (!response.ok) await this.fail(response, 'prepare an upload');
    const { url } = (await response.json()) as { url: string };
    return {
      url: `${this.config.url}/storage/v1${url.startsWith('/') ? url : `/${url}`}`,
      headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'false' }
    };
  }

  // ---- Settings ----

  async getSetting(key: string): Promise<string | null> {
    const rows = await this.rows<{ value: string }>(`settings?key=eq.${encodeURIComponent(key)}&select=value`, 'read a setting');
    return rows[0]?.value ?? null;
  }

  async setSettingOnce(key: string, value: string): Promise<string> {
    const response = await this.rest('settings', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ key, value })
    });
    if (response.status === 409) return (await this.getSetting(key)) ?? value;
    if (!response.ok) await this.fail(response, 'save a setting');
    return value;
  }
}
