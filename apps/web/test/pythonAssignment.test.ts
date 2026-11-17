import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { COURSE, findAssignment, isAllowedCodeFile, selectedAssignment } from '../src/lib/course';
import { SubmissionError, processSubmission } from '../src/lib/processSubmission';
import { buildPrompt } from '../src/lib/questions/prompt';
import { buildEvaluatorPrompt } from '../src/lib/evaluation/prompt';
import type { QuestionSet } from '../src/lib/questions/types';

const dir = path.resolve(__dirname, '../../../fixtures/recordings/honest-incremental');
const bundle = { name: 'honest-incremental.codelapse', bytes: fs.readFileSync(path.join(dir, 'honest-incremental.codelapse')) };
const python = Buffer.from('def reverse(text: str) -> str:\n    out = ""\n    for ch in text:\n        out = ch + out\n    return out\n');

describe('The C and Python assignments', () => {
  it('are both configured, each with a language, a PDF brief and an expected file', () => {
    const ids = COURSE.assignments.map((a) => a.id);
    assert.deepStrictEqual(ids, ['a3-reverse', 'a3-reverse-py']);
    assert.strictEqual(new Set(ids).size, ids.length, 'ids are unique');
    for (const a of COURSE.assignments) {
      assert.match(a.briefPdf, /^\/assignments\/[a-z0-9-]+\.pdf$/, a.id);
      assert.ok(a.expectedFiles.every((f) => isAllowedCodeFile(a.language, f)), `${a.id} expects files it accepts`);
    }
    assert.strictEqual(findAssignment('a3-reverse')!.language, 'c');
    assert.strictEqual(findAssignment('a3-reverse-py')!.language, 'python');
  });

  it('accepts .py for Python and .c/.h for C, and nothing else', () => {
    assert.ok(isAllowedCodeFile('python', 'reverse.py'));
    assert.ok(!isAllowedCodeFile('python', 'reverse.c'));
    assert.ok(isAllowedCodeFile('c', 'reverse.c') && isAllowedCodeFile('c', 'util.h') && isAllowedCodeFile('c', 'Makefile'));
    assert.ok(!isAllowedCodeFile('c', 'reverse.py'));
  });

  it('takes a Python submission and refuses the wrong language with a clear message', () => {
    const record = processSubmission({
      studentId: 'student-b',
      assignmentId: 'a3-reverse-py',
      bundle,
      codeFiles: [{ name: 'reverse.py', bytes: python }]
    });
    assert.strictEqual(record.assignmentId, 'a3-reverse-py');
    assert.deepStrictEqual(record.files.map((f) => f.name), ['reverse.py']);

    assert.throws(
      () => processSubmission({ studentId: 'student-b', assignmentId: 'a3-reverse-py', bundle, codeFiles: [{ name: 'reverse.c', bytes: python }] }),
      (err: Error) => err instanceof SubmissionError && /not a Python file\. Upload your \.py files\./.test(err.message)
    );
    assert.throws(
      () => processSubmission({ studentId: 'student-b', assignmentId: 'a3-reverse', bundle, codeFiles: [{ name: 'reverse.py', bytes: python }] }),
      /not a C source file/
    );
  });

  it('names the assignment\'s language in both AI prompts', () => {
    const record = processSubmission({ studentId: 'student-b', assignmentId: 'a3-reverse-py', bundle, codeFiles: [{ name: 'reverse.py', bytes: python }] });
    const py = findAssignment('a3-reverse-py')!;
    const context = { record, assignmentTitle: py.title, assignmentDescription: py.description, code: [{ name: 'reverse.py', content: python.toString() }] };
    const pyPrompt = buildPrompt({ ...context, language: 'python' }).system;
    assert.match(pyPrompt, /a Python programming assignment/);
    assert.doesNotMatch(pyPrompt, /\bC programming\b/);
    assert.match(buildPrompt(context).system, /a C programming assignment/, 'C when no language is given');

    const questions: QuestionSet = {
      status: 'ready', promptVersion: 't', provider: 't', model: 't', startedAt: 0, questions: [],
      injectionSignals: [], notesForInstructor: null, log: []
    };
    const review = buildEvaluatorPrompt({
      questions, answers: { submittedAt: 0, answers: [] }, moments: [], code: context.code, assignmentTitle: py.title, language: 'python'
    }).system;
    assert.match(review, /their own Python programming assignment/);
  });

  it('shows the first assignment on the instructor pages unless another is chosen', () => {
    assert.strictEqual(selectedAssignment(undefined).id, 'a3-reverse');
    assert.strictEqual(selectedAssignment('a3-reverse-py').id, 'a3-reverse-py');
    assert.strictEqual(selectedAssignment(['a3-reverse-py']).id, 'a3-reverse-py');
    assert.strictEqual(selectedAssignment('nope').id, 'a3-reverse');
  });
});
