import { detectInjectionSignals } from '../questions/injection';
import type { EvaluatorModel } from './model';
import { EvaluatorModelError } from './model';
import { EVALUATOR_PROMPT_VERSION, EvaluationContext, buildEvaluatorPrompt } from './prompt';
import type { AnswerEvaluation, EvaluationAttempt, EvaluationSet, UnderstandingLevel } from './types';
import { dropUnmatchedQuotes, validateEvaluation } from './validate';

const MAX_ATTEMPTS = 2;

export function countLevels(evaluations: AnswerEvaluation[]): Record<UnderstandingLevel, number> {
  const counts = { strong: 0, partial: 0, limited: 0 };
  evaluations.forEach((e) => counts[e.level]++);
  return counts;
}

/**
 * Reviews a submission's answers. Never throws: failures come back as an
 * EvaluationSet with status "failed" and a reason for the instructor.
 */
export async function evaluateAnswers(
  context: EvaluationContext,
  model: EvaluatorModel,
  now: () => number = Date.now
): Promise<EvaluationSet> {
  const base: EvaluationSet = {
    status: 'pending',
    promptVersion: EVALUATOR_PROMPT_VERSION,
    provider: model.provider,
    model: model.model,
    startedAt: now(),
    evaluations: [],
    counts: { strong: 0, partial: 0, limited: 0 },
    summary: null,
    notesForInstructor: null,
    injectionSignals: detectInjectionSignals(
      context.answers.answers.map((a, i) => ({ name: `answer ${i + 1}`, content: a.text }))
    ),
    log: []
  };

  let problems: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt = buildEvaluatorPrompt(context, problems);
    const entry: EvaluationAttempt = { at: now(), system: prompt.system, user: prompt.user, output: null, validationErrors: [] };
    base.log.push(entry);
    try {
      const result = await model.evaluate(prompt);
      entry.output = result.output;
      entry.usage = result.usage;
      const checked = validateEvaluation(result.output, context.questions, context.answers);
      entry.validationErrors = [...checked.problems, ...checked.quoteProblems];
      const lastAttempt = attempt === MAX_ATTEMPTS;
      // Misquoted phrases are dropped on the last attempt rather than failing the whole review.
      if (checked.problems.length === 0 && (checked.quoteProblems.length === 0 || lastAttempt)) {
        const evaluations = dropUnmatchedQuotes(checked.evaluations, context.answers);
        return {
          ...base,
          status: 'ready',
          finishedAt: now(),
          evaluations,
          counts: countLevels(evaluations),
          summary: result.output.overall_summary.trim(),
          notesForInstructor: result.output.notes_for_instructor
        };
      }
      problems = [...checked.problems, ...checked.quoteProblems];
    } catch (err) {
      const message = err instanceof EvaluatorModelError ? err.message : `Unexpected error: ${String(err)}`;
      entry.validationErrors = [message];
      return { ...base, status: 'failed', finishedAt: now(), error: message };
    }
  }
  return {
    ...base,
    status: 'failed',
    finishedAt: now(),
    error: `The review did not meet the rules after ${MAX_ATTEMPTS} attempts: ${problems.join(' ')}`
  };
}
