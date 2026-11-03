import { detectInjectionSignals } from './injection';
import { PROMPT_VERSION, buildPrompt } from './prompt';
import type { QuestionModel } from './model';
import { QuestionModelError } from './model';
import type { GenerationAttempt, QuestionContext, QuestionSet } from './types';
import { validateQuestions } from './validate';

/** One retry, with the problems spelled out, is enough for the rare invalid set. */
const MAX_ATTEMPTS = 2;

/**
 * Writes the four questions for a submission. Never throws: a failure comes
 * back as a QuestionSet with status "failed" and a reason for the instructor.
 */
export async function generateQuestions(
  context: QuestionContext,
  model: QuestionModel,
  now: () => number = Date.now
): Promise<QuestionSet> {
  const set: QuestionSet = {
    status: 'pending',
    promptVersion: PROMPT_VERSION,
    provider: model.provider,
    model: model.model,
    startedAt: now(),
    questions: [],
    injectionSignals: detectInjectionSignals(context.code),
    notesForInstructor: null,
    log: []
  };

  let problems: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt = buildPrompt(context, problems);
    const entry: GenerationAttempt = { at: now(), system: prompt.system, user: prompt.user, output: null, validationErrors: [] };
    set.log.push(entry);
    try {
      const result = await model.generate(prompt);
      entry.output = result.output;
      entry.usage = result.usage;
      const checked = validateQuestions(result.output, context);
      entry.validationErrors = checked.problems;
      if (checked.problems.length === 0) {
        return {
          ...set,
          status: 'ready',
          finishedAt: now(),
          questions: checked.questions,
          notesForInstructor: result.output.notes_for_instructor
        };
      }
      problems = checked.problems;
    } catch (err) {
      const message = err instanceof QuestionModelError ? err.message : `Unexpected error: ${String(err)}`;
      entry.validationErrors = [message];
      return { ...set, status: 'failed', finishedAt: now(), error: message };
    }
  }
  return {
    ...set,
    status: 'failed',
    finishedAt: now(),
    error: `The questions did not meet the rules after ${MAX_ATTEMPTS} attempts: ${problems.join(' ')}`
  };
}
