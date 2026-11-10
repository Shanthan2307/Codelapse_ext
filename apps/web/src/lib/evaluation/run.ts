import { findAssignment } from '../course';
import { getAnswers, getEvaluation, getQuestionSet, getSubmission, readAllSubmittedCode, saveEvaluation } from '../store';
import { evaluateAnswers } from './evaluate';
import { ClaudeEvaluatorModel, EvaluatorModel, FeatherlessEvaluatorModel, OpenAIEvaluatorModel } from './model';
import { aiProvider } from '../ai/provider';
import { EVALUATOR_PROMPT_VERSION } from './prompt';
import type { EvaluationSet } from './types';

/** The model used to review answers: Featherless, OpenAI or Claude, see aiProvider(). */
export function createEvaluatorModel(): EvaluatorModel {
  const provider = aiProvider();
  if (provider === 'featherless') return new FeatherlessEvaluatorModel();
  return provider === 'openai' ? new OpenAIEvaluatorModel() : new ClaudeEvaluatorModel();
}

function emptySet(status: EvaluationSet['status'], extra: Partial<EvaluationSet> = {}): EvaluationSet {
  return {
    status,
    promptVersion: EVALUATOR_PROMPT_VERSION,
    provider: '',
    model: '',
    startedAt: Date.now(),
    evaluations: [],
    counts: { strong: 0, partial: 0, limited: 0 },
    summary: null,
    notesForInstructor: null,
    injectionSignals: [],
    log: [],
    ...extra
  };
}

export async function markEvaluationPending(id: string): Promise<void> {
  await saveEvaluation(id, emptySet('pending'));
}

/**
 * Reviews and stores a submission's answers. Runs after the answers response
 * is sent; never throws, so a failure is recorded for the instructor.
 */
export async function runEvaluation(id: string): Promise<void> {
  try {
    const [record, questions, answers] = await Promise.all([getSubmission(id), getQuestionSet(id), getAnswers(id)]);
    const assignment = record ? findAssignment(record.assignmentId) : undefined;
    if (!record || !assignment || !questions || questions.status !== 'ready') {
      return;
    }
    if (!answers) {
      await saveEvaluation(id, emptySet('skipped', { finishedAt: Date.now() }));
      return;
    }
    let model: EvaluatorModel;
    try {
      model = createEvaluatorModel();
    } catch (err) {
      await saveEvaluation(id, emptySet('failed', { error: `Could not set up the evaluator: ${String(err)}`, finishedAt: Date.now() }));
      return;
    }
    const set = await evaluateAnswers(
      {
        questions,
        answers,
        moments: record.moments,
        code: await readAllSubmittedCode(record),
        assignmentTitle: assignment.title
      },
      model
    );
    await saveEvaluation(id, set);
  } catch (err) {
    console.error(`Evaluating answers for ${id} failed:`, err);
    const current = await getEvaluation(id).catch(() => null);
    await saveEvaluation(id, emptySet('failed', { error: `Evaluation failed: ${String(err)}`, finishedAt: Date.now(), log: current?.log ?? [] })).catch(
      () => undefined
    );
  }
}
