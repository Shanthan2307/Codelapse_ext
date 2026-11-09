import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { processSubmission } from '../src/lib/processSubmission';
import { saveAnswers, saveQuestionSet, saveSubmission } from '../src/lib/store';
import { agreeingSignals, buildCohort, findPair, flagAboveTypical } from '../src/lib/cohort';
import type { QuestionSet } from '../src/lib/questions/types';

const RECORDINGS = path.resolve(__dirname, '../../../fixtures/recordings');

async function submit(studentId: string, fixture: string, at: number): Promise<string> {
  const dir = path.join(RECORDINGS, fixture);
  const bundle = { name: `${fixture}.codelapse`, bytes: fs.readFileSync(path.join(dir, `${fixture}.codelapse`)) };
  const codeFiles = [{ name: 'reverse.c', bytes: fs.readFileSync(path.join(dir, 'submission', 'reverse.c')) }];
  const record = processSubmission({ studentId, assignmentId: 'a3-reverse', bundle, codeFiles, now: at, id: `${studentId}-${at}` });
  await saveSubmission(record, bundle, codeFiles);
  return record.id;
}

function questions(texts: string[]): QuestionSet {
  return {
    status: 'ready',
    promptVersion: 'test',
    provider: 'test',
    model: 'test',
    startedAt: 0,
    questions: texts.map((text, i) => ({
      id: `q${i + 1}`,
      type: 'code',
      momentId: null,
      codeRef: { file: 'reverse.c', startLine: 1, endLine: 2 },
      concept: 'loops',
      text,
      excerpts: [],
      rationale: '',
      strongAnswerPoints: []
    })),
    injectionSignals: [],
    notesForInstructor: null,
    log: []
  };
}

async function answer(id: string, texts: string[], qs: string[]): Promise<void> {
  await saveQuestionSet(id, questions(qs));
  await saveAnswers(id, { submittedAt: 1, answers: texts.map((text, i) => ({ questionId: `q${i + 1}`, text })) });
}

describe('Comparing students', () => {
  let dir: string;
  const ids: Record<string, string> = {};

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-cohort-'));
    process.env.CODELAPSE_DATA_DIR = dir;
    ids.a = await submit('student-a', 'copied-pair-a', 1000);
    ids.b = await submit('student-b', 'copied-pair-b', 2000);
    ids.c = await submit('student-c', 'honest-incremental', 3000);
    ids.d = await submit('student-d', 'weak-but-honest', 4000);
    await answer(
      ids.a,
      [
        'The loop only goes to half the length because each pair would be swapped twice otherwise and the string would end up the same.',
        'I used a temporary char to hold one side while swapping the two ends of the string.'
      ],
      ['Why does your loop stop at len / 2?', 'What is tmp for?']
    );
    await answer(
      ids.b,
      [
        'It loops to half the length because each pair would be swapped twice otherwise, and the string would end up the same as before.',
        'count_vowels takes a const pointer because it only reads the string.'
      ],
      ['What would happen if the loop ran to len?', 'Why is the parameter const?']
    );
    await answer(
      ids.c,
      ['The compiler said a parenthesis was missing on the for line, so I added it.', 'strchr finds the character in the vowel list.'],
      ['What did the build error tell you?', 'How does count_vowels decide a letter is a vowel?']
    );
  });

  after(() => {
    delete process.env.CODELAPSE_DATA_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('ranks the pair with the same pasted solution first', async () => {
    const cohort = await buildCohort('a3-reverse');
    assert.strictEqual(cohort.students.length, 4);
    assert.strictEqual(cohort.pairs.length, 6);
    const top = cohort.pairs[0];
    assert.deepStrictEqual([top.a.studentId, top.b.studentId].sort(), ['student-a', 'student-b']);
    assert.ok(top.signals.codeStructural! >= 0.9, `structural ${top.signals.codeStructural}`);
    assert.ok(top.signals.pastedBlock! >= 0.6, `pasted ${top.signals.pastedBlock}`);
    assert.ok(top.reasons.some((r) => /inserted in one edit/.test(r)), top.reasons.join(' | '));
  });

  it('finds near-identical answers across different questions', async () => {
    const cohort = await buildCohort('a3-reverse');
    const ab = cohort.pairs[0];
    assert.ok(ab.answers.matches.length >= 1);
    assert.ok(ab.answers.matches[0].score >= 0.5);
    assert.ok(ab.answers.matches[0].sharedPhrases.length > 0);
    assert.ok(ab.reasons.some((r) => /wording/.test(r)), ab.reasons.join(' | '));
  });

  it('ranks two typed recordings below the pair whose signals agree', async () => {
    const cohort = await buildCohort('a3-reverse');
    const cd = cohort.pairs.find((p) => [p.a.studentId, p.b.studentId].sort().join() === 'student-c,student-d')!;
    assert.ok(cohort.pairs.indexOf(cd) > 0);
    assert.ok(agreeingSignals(cd) < agreeingSignals(cohort.pairs[0]));
    assert.strictEqual(cd.signals.pastedBlock, null, 'neither typed recording has a bulk insert');
    assert.strictEqual(cd.answers.available, false, 'student D did not answer');
  });

  it('describes resemblance in neutral words', async () => {
    const cohort = await buildCohort('a3-reverse');
    for (const pair of cohort.pairs) {
      for (const reason of pair.reasons) {
        assert.ok(!/cheat|plagiar|copied|dishonest|suspicious/i.test(reason), reason);
      }
    }
  });

  it('opens a pair in the order asked for', async () => {
    const found = await findPair('a3-reverse', ids.b, ids.a);
    assert.ok(found);
    assert.strictEqual(found!.pair.a.submissionId, ids.b);
    assert.strictEqual(found!.pair.b.submissionId, ids.a);
    assert.strictEqual(await findPair('a3-reverse', ids.a, 'nope'), null);
  });

  it('calls the copied pair\'s code above typical, and not the independent pairs', async () => {
    const cohort = await buildCohort('a3-reverse');
    const ab = cohort.pairs[0];
    const cd = cohort.pairs.find((p) => [p.a.studentId, p.b.studentId].sort().join() === 'student-c,student-d')!;
    assert.ok(ab.signals.codeStructural! > cohort.stats.median.codeStructural!, 'the copied pair stands out from the class');
    assert.ok(ab.aboveTypical.codeStructural, 'and is marked above typical');
    assert.ok(!cd.aboveTypical.codeStructural, 'two students who wrote their own code are not');
    assert.strictEqual(cohort.stats.median.pastedBlock, 0, 'pairs without a shared inserted block count as 0');
    assert.ok(ab.aboveTypical.pastedBlock, 'so the pair that shares one stands out');
  });

  it('only calls a signal above typical with enough pairs for a baseline', async () => {
    const cohort = await buildCohort('a3-reverse');
    assert.strictEqual(cohort.stats.hasBaseline, true);
    const signals = { codeStructural: 0.95, codeExact: 0.5, pastedBlock: null, answers: 0.3 };
    const flags = flagAboveTypical(signals, { ...cohort.stats, hasBaseline: false });
    assert.ok(Object.values(flags).every((f) => !f));
  });
});
