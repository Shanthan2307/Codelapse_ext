import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  QUESTION_WINDOW_MS,
  SubmissionError,
  UploadedFile,
  matchRecordedPath,
  processSubmission
} from '../src/lib/processSubmission';
import { getSubmission, latestSubmissions, readSubmittedCode, saveSubmission } from '../src/lib/store';

const RECORDINGS = path.resolve(__dirname, '../../../fixtures/recordings');

function upload(name: string): { bundle: UploadedFile; codeFiles: UploadedFile[] } {
  const dir = path.join(RECORDINGS, name);
  return {
    bundle: { name: `${name}.codelapse`, bytes: fs.readFileSync(path.join(dir, `${name}.codelapse`)) },
    codeFiles: [{ name: 'reverse.c', bytes: fs.readFileSync(path.join(dir, 'submission', 'reverse.c')) }]
  };
}

const base = { studentId: 'student-a', assignmentId: 'a3-reverse' };

describe('Processing a submission', () => {
  it('accepts a recording that ends at the submitted code', () => {
    const record = processSubmission({ ...base, ...upload('honest-incremental'), now: 1000, id: 'test-1' });
    assert.strictEqual(record.replay.verdict, 'consistent');
    assert.strictEqual(record.questionsCloseAt, 1000 + QUESTION_WINDOW_MS, 'questions close one hour after upload');
    assert.strictEqual(record.recording.sessionCount, 1);
    assert.ok(record.recording.typedChars > 0);
    assert.deepStrictEqual(record.recording.runs, { passed: 2, failed: 1, unknown: 0 });
    assert.ok(record.moments.some((m) => m.kind === 'fix-after-failed-run'));
  });

  it('reports code changed after recording, without rejecting the submission', () => {
    const record = processSubmission({ ...base, ...upload('edited-after-recording') });
    assert.strictEqual(record.replay.verdict, 'inconsistent');
    assert.strictEqual(record.replay.files.find((f) => f.path === 'reverse.c')?.status, 'differs');
  });

  it('describes a pasted solution as bulk inserted', () => {
    const record = processSubmission({ ...base, ...upload('pasted-solution') });
    assert.strictEqual(record.recording.typedChars, 0);
    assert.ok(record.recording.bulkInsertedChars > 500);
  });

  it('turns bad uploads into messages a student can act on', () => {
    const good = upload('honest-incremental');
    const attempt = (changes: Partial<Parameters<typeof processSubmission>[0]>) => () =>
      processSubmission({ ...base, ...good, ...changes });

    assert.throws(attempt({ studentId: 'nobody' }), SubmissionError);
    assert.throws(attempt({ assignmentId: 'missing' }), SubmissionError);
    assert.throws(attempt({ bundle: { name: 'x.codelapse', bytes: new Uint8Array() } }), /Attach your .codelapse/);
    assert.throws(attempt({ bundle: { name: 'x.codelapse', bytes: Buffer.from('not a bundle') } }), /could not be read/);
    assert.throws(attempt({ codeFiles: [] }), /Attach your code/);
    assert.throws(attempt({ codeFiles: [{ name: 'notes.pdf', bytes: Buffer.from('x') }] }), /not a C source file/);
    assert.throws(
      attempt({ codeFiles: [good.codeFiles[0], good.codeFiles[0]] }),
      /attached twice/
    );
  });

  it('never keeps a path from an uploaded file name', () => {
    const good = upload('honest-incremental');
    const record = processSubmission({
      ...base,
      bundle: good.bundle,
      codeFiles: [{ name: '../../etc/reverse.c', bytes: good.codeFiles[0].bytes }]
    });
    assert.strictEqual(record.files[0].name, 'reverse.c');
  });

  it('matches a bare file name to its path in the recording', () => {
    assert.strictEqual(matchRecordedPath('reverse.c', ['src/reverse.c', 'README.md']), 'src/reverse.c');
    assert.strictEqual(matchRecordedPath('reverse.c', ['reverse.c', 'old/reverse.c']), 'reverse.c');
    assert.strictEqual(matchRecordedPath('reverse.c', ['a/reverse.c', 'b/reverse.c']), 'reverse.c', 'ambiguous: keep the name');
  });
});

describe('Storing submissions', () => {
  let dir: string;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-web-'));
    process.env.CODELAPSE_DATA_DIR = dir;
  });
  after(() => {
    delete process.env.CODELAPSE_DATA_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps each student's latest submission, with its code", async () => {
    const files = upload('honest-incremental');
    const first = processSubmission({ ...base, ...files, now: 1000, id: 'first' });
    const second = processSubmission({ ...base, ...files, now: 2000, id: 'second' });
    const other = processSubmission({ ...base, studentId: 'student-b', ...upload('pasted-solution'), now: 1500, id: 'other' });
    for (const record of [first, second, other]) {
      await saveSubmission(record, files.bundle, files.codeFiles);
    }

    const latest = await latestSubmissions('a3-reverse');
    assert.deepStrictEqual(latest.map((r) => r.id).sort(), ['other', 'second']);
    assert.strictEqual((await getSubmission('second'))?.studentId, 'student-a');
    assert.ok((await readSubmittedCode('second', 'reverse.c'))?.includes('void reverse'));
  });

  it('refuses ids that could reach outside the data folder', async () => {
    assert.strictEqual(await getSubmission('../secrets'), null);
    assert.strictEqual(await readSubmittedCode('../x', 'reverse.c'), null);
  });
});
