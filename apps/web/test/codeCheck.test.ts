import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { changedSpans, diffExcerpts } from '../src/lib/diff';
import { codeExcerpt } from '../src/lib/questions/validate';
import { validateCodeCheck } from '../src/lib/codecheck/validate';
import { checkCode } from '../src/lib/codecheck/check';
import { CodeCheckModel, CodeCheckModelError } from '../src/lib/codecheck/model';
import { buildCodeCheckPrompt } from '../src/lib/codecheck/prompt';
import { HintError, applyHintAction, studentCodeCheck } from '../src/lib/codecheck/progress';
import type { CodeCheckOutput } from '../src/lib/codecheck/schema';
import type { CodeCheck } from '../src/lib/codecheck/types';
import { findAssignment } from '../src/lib/course';
import { buildResearchDatabase, openDatabase } from '../src/lib/research/database';
import { processSubmission } from '../src/lib/processSubmission';
import { saveCodeCheck, saveHintProgress, saveSubmission } from '../src/lib/store';

const CODE = [
  '#include <string.h>',
  'void reverse(char *s) {',
  '    int n = strlen(s);',
  '    for (int i = 0; i < n; i++) {',
  '        char t = s[i];',
  '        s[i] = s[n - 1 - i];',
  '        s[n - 1 - i] = t;',
  '    }',
  '}'
].join('\n');
const files = [{ name: 'reverse.c', content: CODE }];

const brokenOutput = (extra: Partial<CodeCheckOutput['issues'][number]> = {}): CodeCheckOutput => ({
  traced_cases: [
    { input: '"ab"', expected: '"ba"', actual: '"ab"', passes: false },
    { input: '""', expected: '""', actual: '""', passes: true }
  ],
  works: false,
  issues: [
    {
      severity: 'error',
      concept: 'loop bounds',
      title: 'The string comes back unchanged',
      code_ref: { file: 'reverse.c', start_line: 4, end_line: 4 },
      what_happens: 'When `reverse` is given "ab", the string stays "ab".',
      hints: [
        'What does the string look like after the first pass of the loop when it is "ab"?',
        'What happens to the two characters on the second pass, when `i` is 1?',
        'How many swaps does it take to reverse a string of length `n`?'
      ],
      explanation_for_instructor: 'The loop runs to n instead of n / 2, so every pair is swapped twice.',
      ...extra
    }
  ],
  summary_for_instructor: 'Swaps each pair twice.',
  notes_for_instructor: null
});

function checkContext() {
  const assignment = findAssignment('a3-reverse')!;
  return {
    assignmentTitle: assignment.title,
    assignmentDescription: assignment.description,
    language: assignment.language,
    code: files,
    recording: { folderName: 'x', extensionVersion: '0', bundleCreatedAt: 0, sessionCount: 1, recordedMs: 0, typedChars: 0, bulkInsertedChars: 0, preExistingChars: 0, runs: { passed: 1, failed: 2, unknown: 0 } }
  };
}

describe('Excerpt diff', () => {
  it('marks removed and added lines, and only the changed characters of a modified line', () => {
    const diff = diffExcerpts('int a;\nfor (i = 0; i < n; i++)\nreturn;', 'int a;\nfor (i = 0; i < n / 2; i++)\nreturn;');
    assert.deepStrictEqual(diff.before.map((l) => l.kind), ['same', 'removed', 'same']);
    assert.deepStrictEqual(diff.after.map((l) => l.kind), ['same', 'added', 'same']);
    const changed = diff.after[1].spans.filter((s) => s.changed).map((s) => s.text).join('');
    assert.strictEqual(changed, ' / 2');
    assert.strictEqual(diff.identical, false);
  });

  it('marks a whole line when the two versions share little', () => {
    const { a, b } = changedSpans('return x;', 'while (1) { y++; }');
    assert.strictEqual(a.length, 1);
    assert.strictEqual(b.length, 1);
    assert.ok(a[0].changed && b[0].changed);
  });

  it('handles pure insertions and identical excerpts', () => {
    const diff = diffExcerpts('a\nc', 'a\nb\nc');
    assert.deepStrictEqual(diff.after.map((l) => l.kind), ['same', 'added', 'same']);
    assert.strictEqual(diffExcerpts('x\n', 'x').identical, true);
  });
});

describe('Code excerpts', () => {
  it('shows the cited lines with context and marks them as the focus', () => {
    const excerpt = codeExcerpt('reverse.c', CODE.split('\n'), 4, 4);
    assert.strictEqual(excerpt.label, 'reverse.c, line 4');
    assert.strictEqual(excerpt.startLine, 2);
    assert.deepStrictEqual(excerpt.focus, { start: 4, end: 4 });
    assert.strictEqual(excerpt.code.split('\n').length, 5);
  });
});

describe('Code check', () => {
  it('accepts a consistent check and builds highlighted excerpts', () => {
    const { issues, problems } = validateCodeCheck(brokenOutput(), files);
    assert.deepStrictEqual(problems, []);
    assert.strictEqual(issues[0].id, 'i1');
    assert.deepStrictEqual(issues[0].excerpt.focus, { start: 4, end: 4 });
  });

  it('rejects hints that are not questions, quote code the student never wrote, or disagree with the verdict', () => {
    const { problems } = validateCodeCheck(
      brokenOutput({ hints: ['Change the loop to `i < n / 2`.', 'Why?'], code_ref: { file: 'reverse.c', start_line: 4, end_line: 40 } }),
      files
    );
    assert.ok(problems.some((p) => p.includes('not a question')));
    assert.ok(problems.some((p) => p.includes('`i < n / 2`')));
    assert.ok(problems.some((p) => p.includes('not in reverse.c')));
    const works = validateCodeCheck({ ...brokenOutput(), works: true }, files).problems;
    assert.ok(works.some((p) => p.includes('works is true')));
  });

  it('retries with the problems, then stores the check', async () => {
    const prompts: string[] = [];
    let call = 0;
    const model: CodeCheckModel = {
      provider: 'test',
      model: 'reviewer',
      async check(prompt) {
        prompts.push(prompt.user);
        call++;
        return { output: call === 1 ? brokenOutput({ hints: ['Just fix it.', 'Why?'] }) : brokenOutput() };
      }
    };
    const context = checkContext();
    const check = await checkCode(context, model, () => 5);
    assert.strictEqual(check.status, 'ready');
    assert.strictEqual(check.works, false);
    assert.strictEqual(check.log.length, 2);
    assert.ok(prompts[1].includes('not a question'));
    assert.ok(buildCodeCheckPrompt(context).user.includes('   4      for (int i = 0; i < n; i++) {'));
  });

  it('records a model failure instead of throwing', async () => {
    const model: CodeCheckModel = {
      provider: 'test',
      model: 'reviewer',
      check: async () => {
        throw new CodeCheckModelError('No credit.');
      }
    };
    const check = await checkCode(checkContext(), model);
    assert.strictEqual(check.status, 'failed');
    assert.strictEqual(check.error, 'No credit.');
  });
});

describe('Hint progress', () => {
  const ready = (): CodeCheck => {
    const { issues } = validateCodeCheck(brokenOutput(), files);
    return {
      status: 'ready', promptVersion: 'v', provider: 'p', model: 'm', startedAt: 0, works: false, issues,
      traces: [], summaryForInstructor: 'secret', notesForInstructor: null, log: []
    };
  };

  it('shows the student one hint at first and nothing meant for the instructor', () => {
    const view = studentCodeCheck(ready(), null);
    assert.strictEqual(view.issues[0].hints.length, 1);
    assert.strictEqual(view.issues[0].totalHints, 3);
    assert.ok(!JSON.stringify(view).includes('twice'), 'the instructor explanation stays hidden');
    assert.ok(!JSON.stringify(view).includes('secret'));
  });

  it('opens hints one at a time, saves the reflection and stops at the last hint', () => {
    const check = ready();
    let progress = applyHintAction(check, null, { issueId: 'i1', reveal: true }, 100);
    progress = applyHintAction(check, progress, { issueId: 'i1', reflection: '  It swaps twice.  ' }, 200);
    progress = applyHintAction(check, progress, { issueId: 'i1', reveal: true }, 300);
    assert.deepStrictEqual(progress.issues.i1, { hintsShown: 3, revealedAt: [100, 300], reflection: 'It swaps twice.', reflectionAt: 200 });
    assert.strictEqual(studentCodeCheck(check, progress).issues[0].hints.length, 3);
    assert.throws(() => applyHintAction(check, progress, { issueId: 'i1', reveal: true }, 400), HintError);
    assert.throws(() => applyHintAction(check, progress, { issueId: 'nope', reveal: true }, 400), HintError);
  });

  it('ends up in the research database', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-codecheck-'));
    process.env.CODELAPSE_DATA_DIR = path.join(dir, 'data');
    try {
      const fixture = path.resolve(__dirname, '../../../fixtures/recordings/honest-incremental');
      const bundle = { name: 'r.codelapse', bytes: fs.readFileSync(path.join(fixture, 'honest-incremental.codelapse')) };
      const codeFiles = [{ name: 'reverse.c', bytes: fs.readFileSync(path.join(fixture, 'submission', 'reverse.c')) }];
      const record = processSubmission({ studentId: 'student-a', assignmentId: 'a3-reverse', bundle, codeFiles, now: 1000, id: 'cc-1' });
      await saveSubmission(record, bundle, codeFiles);
      const check = ready();
      await saveCodeCheck(record.id, check);
      await saveHintProgress(record.id, applyHintAction(check, null, { issueId: 'i1', reflection: 'Loop runs too far' }, 500));
      const outFile = path.join(dir, 'out.sqlite');
      await buildResearchDatabase({ sources: [{ dir: path.join(dir, 'data'), run: 'current' }], outFile, salt: 's', saltSource: 'test', includeNames: false, appVersion: '0', now: 1 });
      const db = openDatabase(outFile);
      const [row] = db.prepare('SELECT works, error_count FROM code_checks').all();
      const [issue] = db.prepare('SELECT hints_opened, reflection, reflection_words FROM code_issues').all();
      db.close();
      assert.deepStrictEqual({ ...row }, { works: 0, error_count: 1 });
      assert.deepStrictEqual({ ...issue }, { hints_opened: 1, reflection: 'Loop runs too far', reflection_words: 4 });
    } finally {
      delete process.env.CODELAPSE_DATA_DIR;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
