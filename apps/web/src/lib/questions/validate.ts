import type { Moment } from '@codelapse/core';
import { planQuestions } from './prompt';
import type { GeneratorOutput } from './schema';
import type { GeneratedQuestion, QuestionContext, QuestionExcerpt } from './types';

const MAX_QUESTION_CHARS = 600;
const MAX_EXCERPT_LINES = 20;

/**
 * Checks the rules the JSON schema cannot: the right mix of question types,
 * citations of moments and lines that really exist, no repeats. Returns the
 * questions ready to store, or the problems to send back to the model.
 */
export function validateQuestions(
  output: GeneratorOutput,
  context: QuestionContext
): { questions: GeneratedQuestion[]; problems: string[] } {
  const problems: string[] = [];
  const plan = planQuestions(context.record.moments.length);
  const moments = new Map(context.record.moments.map((m) => [m.id, m]));
  const files = new Map(context.code.map((f) => [f.name, f.content.split(/\r?\n/)]));

  const counts = { process: 0, code: 0 };
  output.questions.forEach((q) => counts[q.type]++);
  if (output.questions.length !== 4 || counts.process !== plan.process || counts.code !== plan.code) {
    problems.push(
      `Expected exactly ${plan.process} process and ${plan.code} code questions, got ${counts.process} and ${counts.code}.`
    );
  }

  const usedMoments = new Set<string>();
  const usedRanges: string[] = [];
  const texts = new Set<string>();
  const questions = output.questions.map((q, i): GeneratedQuestion => {
    const label = `Question ${i + 1}`;
    const text = q.question.trim();
    if (!text) problems.push(`${label} is empty.`);
    if (text.length > MAX_QUESTION_CHARS) problems.push(`${label} is too long; keep it under 60 words.`);
    if (texts.has(text.toLowerCase())) problems.push(`${label} repeats another question.`);
    texts.add(text.toLowerCase());
    if (/\bmoment\b|\bm-\w+-s\d|-t\d{3,}/i.test(text)) {
      problems.push(`${label} mentions a moment id or "moment"; refer to what happened instead.`);
    }

    let excerpts: QuestionExcerpt[] = [];
    if (q.type === 'process') {
      const moment = q.moment_id ? moments.get(q.moment_id) : undefined;
      if (!moment) {
        problems.push(`${label} is a process question but moment_id "${q.moment_id}" is not one of the given moments.`);
      } else {
        if (usedMoments.has(moment.id)) problems.push(`${label} asks about the same moment as another question.`);
        usedMoments.add(moment.id);
        excerpts = momentExcerpts(moment);
      }
    } else {
      const ref = q.code_ref;
      const lines = ref ? files.get(ref.file) : undefined;
      if (!ref || !lines) {
        problems.push(`${label} is a code question but code_ref does not name a submitted file.`);
      } else if (ref.start_line < 1 || ref.end_line < ref.start_line || ref.end_line > lines.length) {
        problems.push(`${label} cites lines ${ref.start_line}-${ref.end_line}, which are not in ${ref.file}.`);
      } else {
        const key = `${ref.file}:${ref.start_line}-${ref.end_line}`;
        if (usedRanges.includes(key)) problems.push(`${label} asks about the same lines as another question.`);
        usedRanges.push(key);
        const end = Math.min(ref.end_line, ref.start_line + MAX_EXCERPT_LINES - 1);
        excerpts = [
          {
            label: `${ref.file}, lines ${ref.start_line}-${ref.end_line}`,
            code: lines.slice(ref.start_line - 1, end).join('\n')
          }
        ];
      }
    }

    return {
      id: `q${i + 1}`,
      type: q.type,
      momentId: q.type === 'process' ? q.moment_id : null,
      codeRef:
        q.type === 'code' && q.code_ref
          ? { file: q.code_ref.file, startLine: q.code_ref.start_line, endLine: q.code_ref.end_line }
          : null,
      concept: q.concept.trim(),
      text,
      excerpts,
      rationale: q.rationale.trim(),
      strongAnswerPoints: q.strong_answer_points.map((p) => p.trim()).filter(Boolean)
    };
  });

  return { questions, problems };
}

function momentExcerpts(moment: Moment): QuestionExcerpt[] {
  const excerpts: QuestionExcerpt[] = [];
  const where = moment.filePath ? ` (${moment.filePath})` : '';
  if (moment.before) excerpts.push({ label: `Before${where}`, code: moment.before });
  if (moment.after) excerpts.push({ label: `After${where}`, code: moment.after });
  return excerpts;
}
