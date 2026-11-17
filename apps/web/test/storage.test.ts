import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { useBackend } from '../src/lib/storage';
import { LocalBackend } from '../src/lib/storage/local';
import { MemoryBackend } from '../src/lib/storage/memory';
import { SupabaseBackend } from '../src/lib/storage/supabase';
import type { Backend } from '../src/lib/storage/types';
import { getAnswers, getQuestionSet, markStalled, saveAnswers, saveQuestionSet, updateHintProgress } from '../src/lib/store';
import { SubmissionError, checkUploadPlan } from '../src/lib/processSubmission';
import { researchSalt } from '../src/lib/research/pseudonym';
import type { QuestionSet } from '../src/lib/questions/types';

const record = (id: string, submittedAt: number) =>
  ({ id, assignmentId: 'a3-reverse', studentId: 's', submittedAt, files: [], moments: [] }) as never;

/** The same behaviour is required of every backend. */
function backendContract(name: string, make: () => Backend) {
  describe(`${name} storage`, () => {
    let store: Backend;
    beforeEach(() => {
      store = make();
    });
    after(() => {
      delete process.env.CODELAPSE_DATA_DIR;
    });

    it('lists submissions newest first', async () => {
      await store.saveSubmission(record('a', 1));
      await store.saveSubmission(record('b', 2));
      assert.deepStrictEqual((await store.listSubmissions()).map((r) => r.id), ['b', 'a']);
      assert.strictEqual((await store.getSubmission('a'))?.id, 'a');
      assert.strictEqual(await store.getSubmission('nope'), null);
    });

    it('writes a record once only when asked, and updates only from the current version', async () => {
      await store.saveSubmission(record('a', 1));
      assert.strictEqual(await store.insertDocOnce('a', 'answers', { n: 1 }), true);
      assert.strictEqual(await store.insertDocOnce('a', 'answers', { n: 2 }), false);
      assert.deepStrictEqual((await store.getDoc('a', 'answers'))?.data, { n: 1 });

      assert.strictEqual(await store.updateDocIfVersion('a', 'hint_progress', { v: 1 }, null), true);
      const first = await store.getDoc('a', 'hint_progress');
      assert.strictEqual(await store.updateDocIfVersion('a', 'hint_progress', { v: 2 }, first!.version), true);
      assert.strictEqual(await store.updateDocIfVersion('a', 'hint_progress', { v: 3 }, first!.version), false, 'stale version');
      assert.deepStrictEqual((await store.getDoc('a', 'hint_progress'))?.data, { v: 2 });
    });

    it('stores files and settings', async () => {
      await store.putFile('submissions/a/code/x.c', new Uint8Array([1, 2]));
      assert.deepStrictEqual([...((await store.getFile('submissions/a/code/x.c')) ?? [])], [1, 2]);
      await store.removeFiles(['submissions/a/code/x.c']);
      assert.strictEqual(await store.getFile('submissions/a/code/x.c'), null);
      assert.strictEqual(await store.setSettingOnce('research-salt', 'one'), 'one');
      assert.strictEqual(await store.setSettingOnce('research-salt', 'two'), 'one');
    });
  });
}

backendContract('Memory', () => new MemoryBackend());

let tmp: string;
backendContract('Local', () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-storage-'));
  process.env.CODELAPSE_DATA_DIR = tmp;
  return new LocalBackend();
});

describe('Local storage paths', () => {
  it('never reads or writes outside the data folder', async () => {
    process.env.CODELAPSE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-storage-'));
    const store = new LocalBackend();
    await assert.rejects(store.putFile('../escape.txt', new Uint8Array([1])));
    await assert.rejects(store.putDoc('../x', 'answers', {}));
    delete process.env.CODELAPSE_DATA_DIR;
  });
});

describe('Store on a shared backend', () => {
  let memory: MemoryBackend;
  beforeEach(() => {
    memory = new MemoryBackend();
    useBackend(memory);
  });
  afterEach(() => useBackend(null));

  it('saves answers once and keeps the first', async () => {
    assert.strictEqual(await saveAnswers('s1', { submittedAt: 1, answers: [] }), true);
    assert.strictEqual(await saveAnswers('s1', { submittedAt: 2, answers: [] }), false);
    assert.strictEqual((await getAnswers('s1'))?.submittedAt, 1);
  });

  it('applies two hint updates made at the same time without losing either', async () => {
    const reveal = (n: number) =>
      updateHintProgress('s1', (current) => ({
        issues: { ...(current?.issues ?? {}), [`i${n}`]: { hintsShown: 2, revealedAt: [n] } }
      }));
    await Promise.all([reveal(1), reveal(2)]);
    const doc = await memory.getDoc<{ issues: Record<string, unknown> }>('s1', 'hint_progress');
    assert.deepStrictEqual(Object.keys(doc!.data.issues).sort(), ['i1', 'i2']);
  });

  it('shows a step pending for over ten minutes as failed, so it can be retried', async () => {
    const pending = { status: 'pending', startedAt: 0, questions: [] } as unknown as QuestionSet;
    await saveQuestionSet('s1', pending);
    assert.strictEqual((await getQuestionSet('s1'))?.status, 'failed');
    assert.strictEqual(markStalled({ status: 'pending', startedAt: 1000 }, 2000)?.status, 'pending');
  });

  it('keeps the research salt in storage', async () => {
    const salt = await researchSalt();
    assert.strictEqual(await researchSalt(), salt);
    assert.strictEqual(memory.settings.get('research-salt'), salt);
  });
});

describe('Supabase storage requests', () => {
  type Call = { url: string; method: string; headers: Record<string, string>; body?: unknown };
  function fake(responses: Array<{ status: number; body?: unknown }>) {
    const calls: Call[] = [];
    const fetchFn = (async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body });
      const next = responses.shift() ?? { status: 200, body: [] };
      return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status });
    }) as unknown as typeof fetch;
    return { calls, store: new SupabaseBackend({ url: 'https://p.supabase.co', key: 'sb_secret_x', bucket: 'codelapse', fetch: fetchFn }) };
  }

  it('reports an existing answer as already saved, and a stale hint update as a conflict', async () => {
    const { calls, store } = fake([{ status: 409, body: { code: '23505' } }, { status: 200, body: [] }, { status: 200, body: [{}] }]);
    assert.strictEqual(await store.insertDocOnce('s1', 'answers', {}), false);
    assert.strictEqual(await store.updateDocIfVersion('s1', 'hint_progress', {}, '3'), false);
    assert.strictEqual(await store.updateDocIfVersion('s1', 'hint_progress', {}, '4'), true);
    assert.match(calls[1].url, /submission_docs\?submission_id=eq\.s1&kind=eq\.hint_progress&version=eq\.3$/);
    assert.strictEqual(calls[1].method, 'PATCH');
    assert.strictEqual(calls[0].headers.apikey, 'sb_secret_x');
    assert.strictEqual(calls[0].headers.Authorization, undefined, 'new-style secret keys are not sent as a bearer token');
  });

  it('reads documents with their version, treats a missing file as absent, and signs uploads', async () => {
    const { calls, store } = fake([
      { status: 200, body: [{ data: { a: 1 }, version: 7 }] },
      { status: 400, body: { error: 'not_found' } },
      { status: 200, body: { url: '/object/upload/sign/codelapse/uploads/x/recording.codelapse?token=t' } }
    ]);
    assert.deepStrictEqual(await store.getDoc('s1', 'questions'), { data: { a: 1 }, version: '7' });
    assert.strictEqual(await store.getFile('submissions/s1/recording.codelapse'), null);
    const signed = await store.signedUpload('uploads/x/recording.codelapse');
    assert.strictEqual(signed.url, 'https://p.supabase.co/storage/v1/object/upload/sign/codelapse/uploads/x/recording.codelapse?token=t');
    assert.strictEqual(calls[1].url, 'https://p.supabase.co/storage/v1/object/codelapse/submissions/s1/recording.codelapse');
  });

  it('refuses unsafe ids before sending anything', async () => {
    const { calls, store } = fake([]);
    assert.strictEqual(await store.getDoc('x&kind=eq.answers', 'questions'), null);
    await assert.rejects(store.putDoc('../x', 'questions', {}));
    assert.strictEqual(calls.length, 0);
  });
});

describe('Upload plan', () => {
  const plan = (code: { name: string; size: number }[], recordingSize = 1000) =>
    checkUploadPlan({ assignmentId: 'a3-reverse', studentName: 'Ada', recording: { name: 'r.codelapse', size: recordingSize }, code });

  it('accepts valid names and sizes before anything is uploaded', () => {
    assert.deepStrictEqual(plan([{ name: 'reverse.c', size: 10 }]).codeNames, ['reverse.c']);
  });

  it('refuses what the full check would refuse anyway', () => {
    assert.throws(() => plan([{ name: 'reverse.py', size: 10 }]), SubmissionError);
    assert.throws(() => plan([{ name: 'reverse.c', size: 10 }], 26 * 1024 * 1024), /larger than 25 MB/);
    assert.throws(() => plan([{ name: 'reverse.c', size: 600 * 1024 }]), /larger than 512 KB/);
  });
});

describe('Moving data to and from the hosted store', () => {
  it('copies a submission with its files and records, and back again intact', async () => {
    const { copySubmission } = await import('../scripts/supabase-data');
    const { processSubmission } = await import('../src/lib/processSubmission');
    const { saveSubmission, saveQuestionSet: saveQs, saveAnswers: saveAs } = await import('../src/lib/store');
    const { buildResearchDatabase, openDatabase } = await import('../src/lib/research/database');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-migrate-'));
    try {
      const fixture = path.resolve(__dirname, '../../../fixtures/recordings/honest-incremental');
      const bundle = { name: 'r.codelapse', bytes: fs.readFileSync(path.join(fixture, 'honest-incremental.codelapse')) };
      const codeFiles = [{ name: 'reverse.c', bytes: fs.readFileSync(path.join(fixture, 'submission', 'reverse.c')) }];
      const rec = processSubmission({ studentId: 'student-a', assignmentId: 'a3-reverse', bundle, codeFiles, now: 1000, id: 'mig-1' });

      process.env.CODELAPSE_DATA_DIR = path.join(root, 'before');
      await saveSubmission(rec, bundle, codeFiles);
      await saveQs(rec.id, { status: 'ready', questions: [] } as unknown as QuestionSet);
      await saveAs(rec.id, { submittedAt: 5, answers: [] });

      const cloud = new MemoryBackend();
      await copySubmission(new LocalBackend(), cloud, rec);
      assert.strictEqual(cloud.files.get('submissions/mig-1/code/reverse.c')?.length, codeFiles[0].bytes.length);

      process.env.CODELAPSE_DATA_DIR = path.join(root, 'after');
      await copySubmission(cloud, new LocalBackend(), rec);
      const counts = await buildResearchDatabase({
        sources: [{ dir: path.join(root, 'after'), run: 'current' }],
        outFile: path.join(root, 'db.sqlite'), salt: 's', saltSource: 'test', includeNames: false, appVersion: '0', now: 1
      });
      assert.strictEqual(counts.submissions, 1);
      const db = openDatabase(path.join(root, 'db.sqlite'));
      const [row] = db.prepare('SELECT length(bundle) AS n FROM recordings').all();
      db.close();
      assert.strictEqual(Number(row.n), bundle.bytes.length, 'the recording survives the round trip byte for byte');
    } finally {
      delete process.env.CODELAPSE_DATA_DIR;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
