import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { processSubmission, UploadedFile } from '../src/lib/processSubmission';
import { saveAnswers, saveEvaluation, saveQuestionSet, saveSubmission } from '../src/lib/store';
import type { QuestionSet } from '../src/lib/questions/types';
import type { EvaluationSet } from '../src/lib/evaluation/types';
import { csvField, toCsv } from '../src/lib/research/csv';
import { SUBMISSION_COLUMNS, answerColumns, buildResearchExport } from '../src/lib/research/export';
import { FeedbackError, MAX_NOTE_CHARS, getFeedback, saveFeedback, validateFeedback } from '../src/lib/research/feedback';
import { participantId, researchSalt } from '../src/lib/research/pseudonym';

const RECORDINGS = path.resolve(__dirname, '../../../fixtures/recordings');

function upload(name: string): { bundle: UploadedFile; codeFiles: UploadedFile[] } {
  const dir = path.join(RECORDINGS, name);
  return {
    bundle: { name: `${name}.codelapse`, bytes: fs.readFileSync(path.join(dir, `${name}.codelapse`)) },
    codeFiles: [{ name: 'reverse.c', bytes: fs.readFileSync(path.join(dir, 'submission', 'reverse.c')) }]
  };
}

const ANSWER_TEXT = 'It stops at len / 2, "otherwise" each pair,\nswaps back.';

function questionSet(): QuestionSet {
  const q = (id: string, type: 'process' | 'code') => ({
    id,
    type,
    momentId: null,
    codeRef: type === 'code' ? { file: 'reverse.c', startLine: 4, endLine: 6 } : null,
    concept: 'loop bounds',
    text: `Question ${id}?`,
    excerpts: [],
    rationale: 'why',
    strongAnswerPoints: ['a point']
  });
  return {
    status: 'ready',
    promptVersion: 'generator-v1',
    provider: 'test',
    model: 'test-model',
    startedAt: 0,
    questions: [q('q1', 'process'), q('q2', 'process'), q('q3', 'code'), q('q4', 'code')],
    injectionSignals: [],
    notesForInstructor: null,
    log: []
  };
}

function evaluation(): EvaluationSet {
  const e = (questionId: string, level: 'strong' | 'partial' | 'limited', total: [number, number, number]) => ({
    questionId,
    addressesQuestion: true,
    scores: { specificity: total[0], consistency: total[1], reasoning: total[2] },
    level,
    evidenceQuotes: [],
    explanation: 'x',
    concerns: level === 'limited' ? ['vague'] : []
  });
  return {
    status: 'ready',
    promptVersion: 'evaluator-v1',
    provider: 'test',
    model: 'test-evaluator',
    startedAt: 0,
    evaluations: [e('q1', 'strong', [3, 3, 2]), e('q2', 'limited', [1, 1, 0]), e('q3', 'partial', [2, 2, 1]), e('q4', 'strong', [3, 3, 3])],
    counts: { strong: 2, partial: 1, limited: 1 },
    summary: 'ok',
    notesForInstructor: null,
    injectionSignals: [],
    log: []
  };
}

describe('Research pilot data', () => {
  let dir: string;
  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-research-'));
    process.env.CODELAPSE_DATA_DIR = dir;
    delete process.env.CODELAPSE_RESEARCH_SALT;

    const a = upload('honest-incremental');
    const answered = processSubmission({ studentId: 'student-a', assignmentId: 'a3-reverse', ...a, now: 1_000_000, id: 'sub-a' });
    await saveSubmission(answered, a.bundle, a.codeFiles);
    await saveQuestionSet('sub-a', questionSet());
    await saveAnswers('sub-a', {
      submittedAt: 1_000_000 + 12 * 60_000,
      answers: ['q1', 'q2', 'q3', 'q4'].map((questionId) => ({ questionId, text: ANSWER_TEXT }))
    });
    await saveEvaluation('sub-a', evaluation());
    await saveFeedback('sub-a', validateFeedback({ answers: { q2: { agreement: 'too-low', ownLevel: 'partial', note: '' } }, overall: { note: '', followUp: true } }));

    const b = upload('pasted-solution');
    const unanswered = processSubmission({ studentId: 'student-b', assignmentId: 'a3-reverse', ...b, now: 2_000_000, id: 'sub-b' });
    await saveSubmission(unanswered, b.bundle, b.codeFiles);
  });
  after(() => {
    delete process.env.CODELAPSE_DATA_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('participant codes', () => {
    it('are stable for one salt, differ across salts, and hide the student id', () => {
      const one = participantId('salt-1', 'student-a');
      assert.match(one, /^P[0-9a-f]{8}$/);
      assert.strictEqual(participantId('salt-1', 'student-a'), one);
      assert.notStrictEqual(participantId('salt-2', 'student-a'), one);
      assert.notStrictEqual(participantId('salt-1', 'student-b'), one);
    });

    it('use a salt kept in the data folder when none is configured', async () => {
      const first = await researchSalt();
      assert.ok(first.length >= 16);
      assert.strictEqual(await researchSalt(), first, 'the same salt on every export');
      assert.ok(fs.existsSync(path.join(dir, 'research-salt.txt')));
      process.env.CODELAPSE_RESEARCH_SALT = 'from-env';
      assert.strictEqual(await researchSalt(), 'from-env');
      delete process.env.CODELAPSE_RESEARCH_SALT;
    });
  });

  describe('the export', () => {
    it('has one row per answered question and one per submission, with no names or ids', async () => {
      const data = await buildResearchExport('a3-reverse', { salt: 'pilot' });
      assert.strictEqual(data.submissions.length, 2);
      assert.strictEqual(data.answers.length, 4, 'only the answered submission has answer rows');

      const text = JSON.stringify(data);
      for (const secret of ['student-a', 'student-b', 'Student A', 'Student B', 'sub-a', 'sub-b']) {
        assert.ok(!text.includes(secret), `export must not contain "${secret}"`);
      }
      assert.ok(!text.includes('swaps back'), 'answer text is left out by default');
    });

    it('carries the recording, the review scores and the instructor rating', async () => {
      const data = await buildResearchExport('a3-reverse', { salt: 'pilot' });
      const a = participantId('pilot', 'student-a');
      const sub = data.submissions.find((s) => s.participant === a)!;
      assert.strictEqual(sub.minutes_to_answers, 12);
      assert.strictEqual(sub.answered, true);
      assert.strictEqual(sub.replay_verdict, 'consistent');
      assert.deepStrictEqual([sub.runs_passed, sub.runs_failed], [2, 1]);
      assert.ok(sub.moments_fix_after_failed_run >= 1);
      assert.deepStrictEqual([sub.review_strong, sub.review_partial, sub.review_limited], [2, 1, 1]);
      assert.strictEqual(sub.instructor_follow_up, true);

      const q2 = data.answers.find((r) => r.participant === a && r.question === 'q2')!;
      assert.strictEqual(q2.question_type, 'process');
      assert.strictEqual(q2.score_total, 2);
      assert.strictEqual(q2.evaluator_level, 'limited');
      assert.strictEqual(q2.evaluator_concerns, 1);
      assert.strictEqual(q2.instructor_agreement, 'too-low');
      assert.strictEqual(q2.instructor_level, 'partial');
      assert.strictEqual(q2.answer_words, 11);

      const b = data.submissions.find((s) => s.participant === participantId('pilot', 'student-b'))!;
      assert.strictEqual(b.answered, false);
      assert.strictEqual(b.review_strong, null);
      assert.strictEqual(b.instructor_follow_up, null);
    });

    it('includes answer text only when asked, and writes valid CSV', async () => {
      const data = await buildResearchExport('a3-reverse', { salt: 'pilot', includeText: true });
      assert.strictEqual(data.answers[0].answer_text, ANSWER_TEXT);

      const csv = toCsv(answerColumns(true), data.answers);
      const header = csv.split('\r\n')[0].split(',');
      assert.deepStrictEqual(header, answerColumns(true));
      assert.ok(csv.includes('"It stops at len / 2, ""otherwise"" each pair,\nswaps back."'));
      assert.ok(!toCsv(answerColumns(false), data.answers).includes('swaps back'));
      assert.strictEqual(toCsv(SUBMISSION_COLUMNS, data.submissions).trim().split('\r\n').length, 3);
    });
  });

  describe('CSV fields', () => {
    it('quote commas, quotes and line breaks, and leave plain values alone', () => {
      assert.strictEqual(csvField('plain'), 'plain');
      assert.strictEqual(csvField(3), '3');
      assert.strictEqual(csvField(null), '');
      assert.strictEqual(csvField(false), 'false');
      assert.strictEqual(csvField('a,b'), '"a,b"');
      assert.strictEqual(csvField('say "hi"'), '"say ""hi"""');
      assert.strictEqual(csvField('two\nlines'), '"two\nlines"');
    });
  });

  describe('instructor feedback', () => {
    it('accepts a valid rating and stores it', async () => {
      const feedback = validateFeedback(
        { answers: { q1: { agreement: 'agree', ownLevel: null, note: 'fine' } }, questions: { q1: { useful: true, note: '' } } },
        ['q1', 'q2', 'q3', 'q4'],
        5
      );
      assert.strictEqual(feedback.updatedAt, 5);
      assert.deepStrictEqual(feedback.overall, { note: '', followUp: false });
      await saveFeedback('sub-b', feedback);
      assert.deepStrictEqual(await getFeedback('sub-b'), feedback);
    });

    it('refuses bad shapes, unknown values, unknown questions and long notes', () => {
      const bad: unknown[] = [
        null,
        [],
        { extra: 1 },
        { answers: [] },
        { answers: { q1: { agreement: 'maybe' } } },
        { answers: { q1: { ownLevel: 'excellent' } } },
        { answers: { q1: { agreement: 'agree', score: 9 } } },
        { questions: { q1: { useful: 'yes' } } },
        { overall: { followUp: 'yes' } },
        { answers: { '../x': { agreement: 'agree' } } },
        { answers: { q9: { agreement: 'agree' } } },
        { overall: { note: 'x'.repeat(MAX_NOTE_CHARS + 1) } }
      ];
      for (const input of bad) {
        assert.throws(() => validateFeedback(input, ['q1', 'q2']), FeedbackError, JSON.stringify(input).slice(0, 80));
      }
    });

    it('never reads or writes outside the data folder', async () => {
      assert.strictEqual(await getFeedback('../secrets'), null);
      await assert.rejects(saveFeedback('../x', validateFeedback({})));
    });
  });
});
