import type { SubmissionRecord } from '../types';
import { Backend, DocKind, StoredDoc } from './types';

/** Everything in memory: for tests of code that uses the storage interface. */
export class MemoryBackend implements Backend {
  readonly name = 'memory' as const;
  readonly submissions = new Map<string, SubmissionRecord>();
  readonly docs = new Map<string, { data: unknown; version: number }>();
  readonly files = new Map<string, Uint8Array>();
  readonly settings = new Map<string, string>();

  async saveSubmission(record: SubmissionRecord) {
    this.submissions.set(record.id, structuredClone(record));
  }
  async getSubmission(id: string) {
    const r = this.submissions.get(id);
    return r ? structuredClone(r) : null;
  }
  async listSubmissions() {
    return [...this.submissions.values()].map((r) => structuredClone(r)).sort((a, b) => b.submittedAt - a.submittedAt);
  }
  async getDoc<T>(id: string, kind: DocKind): Promise<StoredDoc<T> | null> {
    const d = this.docs.get(`${id}/${kind}`);
    return d ? { data: structuredClone(d.data) as T, version: String(d.version) } : null;
  }
  async putDoc(id: string, kind: DocKind, data: unknown) {
    const key = `${id}/${kind}`;
    this.docs.set(key, { data: structuredClone(data), version: (this.docs.get(key)?.version ?? 0) + 1 });
  }
  async insertDocOnce(id: string, kind: DocKind, data: unknown) {
    if (this.docs.has(`${id}/${kind}`)) return false;
    await this.putDoc(id, kind, data);
    return true;
  }
  async updateDocIfVersion(id: string, kind: DocKind, data: unknown, version: string | null) {
    const current = this.docs.get(`${id}/${kind}`);
    if ((current ? String(current.version) : null) !== version) return false;
    await this.putDoc(id, kind, data);
    return true;
  }
  async getFile(path: string) {
    return this.files.get(path) ?? null;
  }
  async putFile(path: string, bytes: Uint8Array) {
    this.files.set(path, bytes);
  }
  async removeFiles(paths: string[]) {
    paths.forEach((p) => this.files.delete(p));
  }
  async signedUpload() {
    return null;
  }
  async getSetting(key: string) {
    return this.settings.get(key) ?? null;
  }
  async setSettingOnce(key: string, value: string) {
    if (!this.settings.has(key)) this.settings.set(key, value);
    return this.settings.get(key)!;
  }
}
