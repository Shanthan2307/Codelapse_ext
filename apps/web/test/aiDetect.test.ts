import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { useBackend } from '../src/lib/storage';
import { MemoryBackend } from '../src/lib/storage/memory';
import { CodequiryConfig, pollCodequiryCheck, readAiResults, startCodequiryCheck } from '../src/lib/aidetect/codequiry';
import { refreshExternalAiCheck } from '../src/lib/aidetect/run';
import { makeZip } from '../src/lib/aidetect/zip';
import type { ExternalAiCheck } from '../src/lib/aidetect/types';

interface Call {
  url: string;
  body: unknown;
  headers: Record<string, string>;
}

/** A fake Codequiry: answers each path with the given JSON and records the calls. */
function fakeFetch(answers: Record<string, unknown>, calls: Call[]): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    const pathName = url.replace('https://codequiry.com/api/v1', '');
    calls.push({ url: pathName, body: init.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(String(init.body)), headers: init.headers as Record<string, string> });
    if (!(pathName in answers)) return new Response('{"message":"not found"}', { status: 404 });
    return new Response(JSON.stringify(answers[pathName]), { status: 200 });
  }) as unknown as typeof fetch;
}

const RESULTS = {
  success: true,
  submissions: [
    {
      filename: 'submission',
      ai_detection: {
        avg_ai_probability: 82.5,
        max_ai_probability: 91,
        risk_level: 'High',
        files: [{ file_path: 'submission/reverse.c', ai_probability: 91, classification: 'ai', summary: 'Uniform style' }]
      }
    }
  ]
};

describe('Outside AI detector (Codequiry)', () => {
  it('creates, uploads and starts a check, naming it by submission id only', async () => {
    const calls: Call[] = [];
    const config: CodequiryConfig = {
      apiKey: 'k',
      testType: 1,
      fetch: fakeFetch({ '/check/create': { id: 456 }, '/check/upload': { data: [] }, '/check/start': { success: true } }, calls)
    };
    const id = await startCodequiryCheck(config, { submissionId: 'abc-1', language: 'c', files: [{ name: 'reverse.c', content: 'int main(void){}' }] });
    assert.strictEqual(id, 456);
    assert.deepStrictEqual(calls.map((c) => c.url), ['/check/create', '/check/upload', '/check/start']);
    assert.deepStrictEqual(calls[0].body, { name: 'codelapse-abc-1', language: 16 });
    assert.strictEqual(calls[0].headers.apikey, 'k');
    assert.strictEqual((calls[1].body as Record<string, unknown>).check_id, '456');
    assert.deepStrictEqual(calls[2].body, { check_id: 456, test_type: 1 });
  });

  it('reports an error answer with its status', async () => {
    const config: CodequiryConfig = { apiKey: 'k', testType: 1, fetch: fakeFetch({}, []) };
    await assert.rejects(startCodequiryCheck(config, { submissionId: 'x', language: 'python', files: [] }), /404/);
  });

  it('waits while running, then reads the AI results', async () => {
    const running: ExternalAiCheck = { status: 'running', provider: 'codequiry', startedAt: 0, checkId: 456, files: [] };
    const busy = { apiKey: 'k', testType: 1, fetch: fakeFetch({ '/check/get': { check: { status_id: 6 } } }, []) };
    assert.strictEqual(await pollCodequiryCheck(busy, running, 10), null);

    const done = { apiKey: 'k', testType: 1, fetch: fakeFetch({ '/check/get': { check: { status_id: 4 } }, '/ai-results': RESULTS }, []) };
    const result = await pollCodequiryCheck(done, running, 10);
    assert.strictEqual(result?.status, 'ready');
    assert.strictEqual(result?.averageAiProbability, 82.5);
    assert.strictEqual(result?.riskLevel, 'high');
    assert.deepStrictEqual(result?.files.map((f) => [f.path, f.aiProbability]), [['reverse.c', 91]]);
  });

  it('copes with a submission that has no AI section', () => {
    assert.deepStrictEqual(readAiResults({ submissions: [{ ai_detection: null }] }).files, []);
  });

  describe('refreshing from the instructor page', () => {
    afterEach(() => useBackend(null));

    it('polls at most every 30 seconds, and gives up after 45 minutes', async () => {
      const store = new MemoryBackend();
      useBackend(store);
      const calls: Call[] = [];
      const config = { apiKey: 'k', testType: 1, fetch: fakeFetch({ '/check/get': { check: { status_id: 7 } } }, calls) };
      await store.putDoc('s1', 'ai_detection', { status: 'running', provider: 'codequiry', startedAt: 0, checkId: 1, files: [] });

      await refreshExternalAiCheck('s1', 1_000, config);
      await refreshExternalAiCheck('s1', 5_000, config);
      assert.strictEqual(calls.length, 1, 'second refresh within 30 s does not call out');

      const late = await refreshExternalAiCheck('s1', 46 * 60_000, config);
      assert.strictEqual(late?.status, 'failed');
    });
  });
});

describe('ZIP writer', () => {
  it('writes an archive that unzip accepts, with the files intact', function () {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-zip-'));
    try {
      const zipPath = path.join(dir, 'a.zip');
      fs.writeFileSync(zipPath, makeZip([{ name: 'submission/reverse.c', bytes: new TextEncoder().encode('int main(void) { return 0; }\n') }]));
      try {
        execFileSync('unzip', ['-tq', zipPath]);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') this.skip();
        throw err;
      }
      assert.strictEqual(execFileSync('unzip', ['-p', zipPath, 'submission/reverse.c']).toString(), 'int main(void) { return 0; }\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
