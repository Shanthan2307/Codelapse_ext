import type { AnswerSet, QuestionSet } from '../questions/types';
import type { EvaluatorOutput } from './schema';
import type { AnswerEvaluation, UnderstandingLevel } from './types';

const SCALES = ['specificity', 'consistency', 'reasoning'] as const;

/** Total of the three 0-3 scores: 7-9 strong, 4-6 partial, 0-3 limited. */
export function levelFor(addressesQuestion: boolean, total: number): UnderstandingLevel {
  if (!addressesQuestion || total <= 3) return 'limited';
  return total >= 7 ? 'strong' : 'partial';
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Checks what the schema cannot: one review per question, scores in range,
 * and quotes that really appear in the answer. Quotes that don't appear are
 * reported as problems so the model can try again; the caller may drop them
 * on the last attempt.
 */
export function validateEvaluation(
  output: EvaluatorOutput,
  questions: QuestionSet,
  answers: AnswerSet
): { evaluations: AnswerEvaluation[]; problems: string[]; quoteProblems: string[] } {
  const problems: string[] = [];
  const quoteProblems: string[] = [];
  const answerText = new Map(answers.answers.map((a) => [a.questionId, a.text]));
  // Some models repeat a review of the same question; the first one counts, copies are dropped.
  const byId = new Map<string, EvaluatorOutput['evaluations'][number]>();
  for (const e of output.evaluations) {
    if (!byId.has(e.question_id)) byId.set(e.question_id, e);
  }

  const expected = questions.questions.map((q) => q.id);
  const unexpected = output.evaluations.map((e) => e.question_id).filter((id) => !expected.includes(id));
  if (unexpected.length > 0) problems.push(`Unknown question ids: ${unexpected.join(', ')}.`);

  const evaluations: AnswerEvaluation[] = [];
  expected.forEach((id, i) => {
    const e = byId.get(id);
    if (!e) {
      problems.push(`Question ${i + 1} (${id}) has no review.`);
      return;
    }
    for (const scale of SCALES) {
      const value = e[scale];
      if (!Number.isInteger(value) || value < 0 || value > 3) {
        problems.push(`The ${scale} score for ${id} must be a whole number from 0 to 3.`);
      }
    }
    const answer = normalize(answerText.get(id) ?? '');
    const evidenceQuotes = e.evidence_quotes.map((q) => q.trim()).filter(Boolean).slice(0, 3);
    for (const quote of evidenceQuotes) {
      if (!answer.includes(normalize(quote))) {
        quoteProblems.push(`For ${id}, the quote "${quote}" does not appear in the student's answer; quote it exactly.`);
      }
    }
    const scores = {
      specificity: clamp(e.specificity),
      consistency: clamp(e.consistency),
      reasoning: clamp(e.reasoning)
    };
    const total = clamp(e.specificity) + clamp(e.consistency) + clamp(e.reasoning);
    if (e.addresses_question && total >= 7 && evidenceQuotes.length === 0) {
      problems.push(`The review of ${id} rates it strong but quotes nothing from the answer to support that; quote the parts that show understanding, or lower the scores.`);
    }
    evaluations.push({
      questionId: id,
      addressesQuestion: e.addresses_question,
      scores,
      level: levelFor(e.addresses_question, scores.specificity + scores.consistency + scores.reasoning),
      evidenceQuotes,
      explanation: e.explanation.trim(),
      concerns: e.concerns.map((c) => c.trim()).filter(Boolean)
    });
  });
  return { evaluations, problems, quoteProblems };
}

/** Keeps only quotes that appear in the answer. */
export function dropUnmatchedQuotes(evaluations: AnswerEvaluation[], answers: AnswerSet): AnswerEvaluation[] {
  const answerText = new Map(answers.answers.map((a) => [a.questionId, normalize(a.text)]));
  return evaluations.map((e) => ({
    ...e,
    evidenceQuotes: e.evidenceQuotes.filter((q) => (answerText.get(e.questionId) ?? '').includes(normalize(q)))
  }));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(3, Math.round(Number.isFinite(value) ? value : 0)));
}
