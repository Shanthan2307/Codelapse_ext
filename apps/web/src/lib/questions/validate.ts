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
  // Everything the questions may refer to: the code and the recorded excerpts.
  const knownText = [
    ...context.code.map((f) => f.content),
    ...context.record.moments.flatMap((m) => [m.before ?? '', m.after ?? '', m.summary, m.functionName ?? ''])
  ].join('\n');
  const questions = output.questions.map((q, i): GeneratedQuestion => {
    const label = `Question ${i + 1}`;
    const text = q.question.trim();
    if (!text) problems.push(`${label} is empty.`);
    if (text.length > MAX_QUESTION_CHARS) problems.push(`${label} is too long; keep it under 60 words.`);
    if (texts.has(text.toLowerCase())) problems.push(`${label} repeats another question.`);
    problems.push(...groundingProblems(label, text, knownText, context.record.recording.recordedMs));
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

/**
 * Catches questions that refer to things the student never wrote or times that
 * never happened: code names that appear nowhere in the code or the recording,
 * and a time later than the whole recording.
 */
export function groundingProblems(label: string, text: string, knownText: string, recordedMs: number): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  // Names written like code: with an underscore, called as in `name(` (no space), or in backticks.
  // Prose such as "indices (i and j)" is not a name.
  for (const match of text.matchAll(/`([^`]+)`|\b([A-Za-z]\w*_\w*)\b|\b([A-Za-z_]\w*)\(/g)) {
    const name = (match[1] ?? match[2] ?? match[3]).trim().replace(/\(\)$/, '');
    if (/^[A-Za-z_]\w*$/.test(name)) names.add(name);
  }
  for (const name of names) {
    if (!new RegExp(`\\b${name}\\b`).test(knownText)) {
      problems.push(`${label} mentions "${name}", which is not in the student's code or recording; ask only about what is there.`);
    }
  }
  const recordedMinutes = Math.ceil(recordedMs / 60000);
  for (const match of text.matchAll(/(\d+)\s*(?:minutes?|mins?)\b/gi)) {
    if (Number(match[1]) > recordedMinutes) {
      problems.push(`${label} mentions ${match[1]} minutes, but the whole recording is about ${recordedMinutes} minute(s); check the times given.`);
    }
  }
  return problems;
}
