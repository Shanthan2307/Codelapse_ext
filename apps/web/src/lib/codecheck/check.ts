import { CODECHECK_PROMPT_VERSION, CodeCheckContext, buildCodeCheckPrompt } from './prompt';
import { CodeCheckModel, CodeCheckModelError } from './model';
import type { CodeCheck, CodeCheckAttempt } from './types';
import { validateCodeCheck } from './validate';

const MAX_ATTEMPTS = 2;

export function emptyCodeCheck(status: CodeCheck['status'], extra: Partial<CodeCheck> = {}): CodeCheck {
  return {
    status,
    promptVersion: CODECHECK_PROMPT_VERSION,
    provider: '',
    model: '',
    startedAt: Date.now(),
    works: null,
    issues: [],
    traces: [],
    summaryForInstructor: null,
    notesForInstructor: null,
    log: [],
    ...extra
  };
}

/**
 * Checks whether the submitted code does what the assignment asks and, if
 * not, writes guiding hints. Never throws: a failure comes back with status
 * "failed" and a reason for the instructor.
 */
export async function checkCode(context: CodeCheckContext, model: CodeCheckModel, now: () => number = Date.now): Promise<CodeCheck> {
  const base = emptyCodeCheck('pending', { provider: model.provider, model: model.model, startedAt: now() });
  let problems: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt = buildCodeCheckPrompt(context, problems);
    const entry: CodeCheckAttempt = { at: now(), system: prompt.system, user: prompt.user, output: null, validationErrors: [] };
    base.log.push(entry);
    try {
      const result = await model.check(prompt);
      entry.output = result.output;
      entry.usage = result.usage;
      const checked = validateCodeCheck(result.output, context.code);
      entry.validationErrors = checked.problems;
      if (checked.problems.length === 0) {
        return {
          ...base,
          status: 'ready',
          finishedAt: now(),
          works: result.output.works,
          issues: checked.issues,
          traces: result.output.traced_cases,
          summaryForInstructor: result.output.summary_for_instructor.trim(),
          notesForInstructor: result.output.notes_for_instructor
        };
      }
      problems = checked.problems;
    } catch (err) {
      const message = err instanceof CodeCheckModelError ? err.message : `Unexpected error: ${String(err)}`;
      entry.validationErrors = [message];
      return { ...base, status: 'failed', finishedAt: now(), error: message };
    }
  }
  return {
    ...base,
    status: 'failed',
    finishedAt: now(),
    error: `The code check did not meet the rules after ${MAX_ATTEMPTS} attempts: ${problems.join(' ')}`
  };
}
