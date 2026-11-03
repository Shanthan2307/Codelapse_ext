import { findAssignment } from '../course';
import { getQuestionSet, getSubmission, readAllSubmittedCode, saveQuestionSet } from '../store';
import { generateQuestions } from './generate';
import { ClaudeQuestionModel, QuestionModel } from './model';
import { PROMPT_VERSION } from './prompt';
import type { QuestionSet } from './types';

/** The model used for new questions. Replace this to use another provider. */
export function createQuestionModel(): QuestionModel {
  return new ClaudeQuestionModel();
}

/** Marks a submission's questions as being prepared, so its page can say so straight away. */
export async function markQuestionsPending(id: string): Promise<void> {
  const pending: QuestionSet = {
    status: 'pending',
    promptVersion: PROMPT_VERSION,
    provider: '',
    model: '',
    startedAt: Date.now(),
    questions: [],
    injectionSignals: [],
    notesForInstructor: null,
    log: []
  };
  await saveQuestionSet(id, pending);
}

/**
 * Generates and stores the questions for a submission. Runs after the upload
 * response has been sent; never throws, so a failure is recorded on the
 * submission for the instructor instead of being lost.
 */
export async function runQuestionGeneration(id: string): Promise<void> {
  try {
    const record = await getSubmission(id);
    const assignment = record ? findAssignment(record.assignmentId) : undefined;
    if (!record || !assignment) {
      return;
    }
    let model: QuestionModel;
    try {
      model = createQuestionModel();
    } catch (err) {
      await saveFailure(id, `Could not set up the question model: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const set = await generateQuestions(
      {
        record,
        assignmentTitle: assignment.title,
        assignmentDescription: assignment.description,
        code: await readAllSubmittedCode(record)
      },
      model
    );
    await saveQuestionSet(id, set);
  } catch (err) {
    console.error(`Question generation for ${id} failed:`, err);
    await saveFailure(id, `Question generation failed: ${err instanceof Error ? err.message : String(err)}`).catch(() => undefined);
  }
}

async function saveFailure(id: string, error: string): Promise<void> {
  const current = await getQuestionSet(id);
  await saveQuestionSet(id, {
    status: 'failed',
    promptVersion: PROMPT_VERSION,
    provider: current?.provider ?? '',
    model: current?.model ?? '',
    startedAt: current?.startedAt ?? Date.now(),
    finishedAt: Date.now(),
    error,
    questions: [],
    injectionSignals: [],
    notesForInstructor: null,
    log: current?.log ?? []
  });
}
