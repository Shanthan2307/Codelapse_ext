import { codeExcerpt } from '../questions/validate';
import { MAX_HINTS, MAX_ISSUES, MIN_HINTS } from './prompt';
import type { CodeCheckOutput } from './schema';
import type { CodeIssue } from './types';

const MAX_HINT_CHARS = 300;
const MAX_TITLE_CHARS = 100;
const MAX_WHAT_HAPPENS_CHARS = 500;
const MAX_ISSUE_LINES = 12;

/**
 * Checks what the schema cannot: issues cite real lines, the verdict agrees
 * with the issues and traces, and every hint is a question that quotes only
 * the student's own code, so no hint hands over a fix.
 */
export function validateCodeCheck(
  output: CodeCheckOutput,
  code: { name: string; content: string }[]
): { issues: CodeIssue[]; problems: string[] } {
  const problems: string[] = [];
  const files = new Map(code.map((f) => [f.name, f.content.split(/\r?\n/)]));
  const allCode = code.map((f) => f.content).join('\n');
  const errors = output.issues.filter((i) => i.severity === 'error').length;

  if (output.traced_cases.length < 2) {
    problems.push('Trace at least two inputs through the code before deciding whether it works.');
  }
  if (output.works && errors > 0) {
    problems.push('works is true but an issue is marked "error"; either the code works (only warnings) or works is false.');
  }
  if (!output.works && errors === 0) {
    problems.push('works is false but no issue is marked "error"; name what makes the code wrong.');
  }
  if (output.works && output.traced_cases.some((c) => !c.passes)) {
    problems.push('works is true but a traced input does not pass; check the trace again.');
  }
  if (output.issues.length > MAX_ISSUES) {
    problems.push(`Report at most ${MAX_ISSUES} issues, the most important first.`);
  }

  const issues = output.issues.slice(0, MAX_ISSUES).map((issue, i): CodeIssue | null => {
    const label = `Issue ${i + 1}`;
    const ref = issue.code_ref;
    const lines = files.get(ref.file);
    const title = issue.title.trim();
    const whatHappens = issue.what_happens.trim();
    const hints = issue.hints.map((h) => h.trim()).filter(Boolean);
    if (!title) problems.push(`${label} has no title.`);
    if (title.length > MAX_TITLE_CHARS) problems.push(`${label}'s title is too long; keep it to a few words.`);
    if (!whatHappens) problems.push(`${label} does not say what happens.`);
    if (whatHappens.length > MAX_WHAT_HAPPENS_CHARS) problems.push(`${label}'s what_happens is too long; one or two sentences.`);
    if (hints.length < MIN_HINTS || hints.length > MAX_HINTS) {
      problems.push(`${label} has ${hints.length} hints; give ${MIN_HINTS} or ${MAX_HINTS}.`);
    }
    hints.forEach((hint, k) => {
      const where = `${label}, hint ${k + 1}`;
      if (!hint.endsWith('?')) problems.push(`${where} is not a question; every hint must be a question ending with "?".`);
      if (hint.length > MAX_HINT_CHARS) problems.push(`${where} is too long; keep each hint to one question.`);
      if (/```|\n/.test(hint)) problems.push(`${where} contains a code block; hints must not contain code.`);
      for (const match of hint.matchAll(/`([^`]+)`/g)) {
        if (!allCode.includes(match[1].trim())) {
          problems.push(`${where} quotes \`${match[1]}\`, which is not in the student's code; quote only their own code so the hint does not give the fix away.`);
        }
      }
    });
    if (!lines) {
      problems.push(`${label} cites file "${ref.file}", which was not submitted.`);
      return null;
    }
    if (ref.start_line < 1 || ref.end_line < ref.start_line || ref.end_line > lines.length) {
      problems.push(`${label} cites lines ${ref.start_line}-${ref.end_line}, which are not in ${ref.file}.`);
      return null;
    }
    if (ref.end_line - ref.start_line + 1 > MAX_ISSUE_LINES) {
      problems.push(`${label} cites ${ref.end_line - ref.start_line + 1} lines; narrow it to the lines where the mistake is.`);
    }
    return {
      id: `i${i + 1}`,
      severity: issue.severity,
      concept: issue.concept.trim(),
      title,
      codeRef: { file: ref.file, startLine: ref.start_line, endLine: ref.end_line },
      excerpt: codeExcerpt(ref.file, lines, ref.start_line, ref.end_line),
      whatHappens,
      hints,
      explanationForInstructor: issue.explanation_for_instructor.trim()
    };
  });

  return { issues: issues.filter((i): i is CodeIssue => i !== null), problems };
}
