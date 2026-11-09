import type { MomentKind } from '@codelapse/core';
import { getAnswers, getEvaluation, getQuestionSet, latestSubmissions } from '../store';
import { getFeedback } from './feedback';
import { participantId } from './pseudonym';
import type { CsvValue } from './csv';

/**
 * Research export: one row per answered question, and one row per submission.
 * Students appear only as participant codes; names, student ids, submission
 * ids and code are never included, and answer text only when asked for.
 */

const MOMENT_KINDS: MomentKind[] = [
  'fix-after-failed-run',
  'repeated-failures',
  'bulk-insert',
  'rewrite',
  'abandoned-approach',
  'function-written'
];

export interface SubmissionRow extends Record<string, CsvValue> {
  participant: string;
  assignment: string;
  minutes_to_answers: number | null;
  answered: boolean;
  questions_status: string;
  evaluation_status: string;
  session_count: number;
  recorded_minutes: number;
  typed_chars: number;
  bulk_inserted_chars: number;
  pre_existing_chars: number;
  runs_passed: number;
  runs_failed: number;
  runs_unknown: number;
  replay_verdict: string;
  replay_files_differing: number;
  moments_total: number;
  moments_fix_after_failed_run: number;
  moments_repeated_failures: number;
  moments_bulk_insert: number;
  moments_rewrite: number;
  moments_abandoned_approach: number;
  moments_function_written: number;
  review_strong: number | null;
  review_partial: number | null;
  review_limited: number | null;
  instructor_follow_up: boolean | null;
}

export interface AnswerRow extends Record<string, CsvValue> {
  participant: string;
  assignment: string;
  question: string;
  question_type: string;
  concept: string;
  cites_moment_kind: string;
  generator_model: string;
  generator_prompt: string;
  minutes_to_answers: number | null;
  answer_chars: number;
  answer_words: number;
  answer_text?: string;
  evaluator_model: string;
  evaluator_prompt: string;
  addresses_question: boolean | null;
  score_specificity: number | null;
  score_consistency: number | null;
  score_reasoning: number | null;
  score_total: number | null;
  evaluator_level: string;
  evaluator_concerns: number | null;
  instructor_agreement: string;
  instructor_level: string;
  instructor_question_useful: boolean | null;
}

export interface ResearchExport {
  assignment: string;
  generatedAt: number;
  submissions: SubmissionRow[];
  answers: AnswerRow[];
}

export interface ResearchExportOptions {
  salt: string;
  /** Include the students' answer text. Off by default. */
  includeText?: boolean;
}

export const SUBMISSION_COLUMNS: (keyof SubmissionRow & string)[] = [
  'participant', 'assignment', 'minutes_to_answers', 'answered', 'questions_status', 'evaluation_status',
  'session_count', 'recorded_minutes', 'typed_chars', 'bulk_inserted_chars', 'pre_existing_chars',
  'runs_passed', 'runs_failed', 'runs_unknown', 'replay_verdict', 'replay_files_differing',
  'moments_total', 'moments_fix_after_failed_run', 'moments_repeated_failures', 'moments_bulk_insert',
  'moments_rewrite', 'moments_abandoned_approach', 'moments_function_written',
  'review_strong', 'review_partial', 'review_limited', 'instructor_follow_up'
];

export function answerColumns(includeText: boolean): (keyof AnswerRow & string)[] {
  return [
    'participant', 'assignment', 'question', 'question_type', 'concept', 'cites_moment_kind',
    'generator_model', 'generator_prompt', 'minutes_to_answers', 'answer_chars', 'answer_words',
    ...(includeText ? (['answer_text'] as const) : []),
    'evaluator_model', 'evaluator_prompt', 'addresses_question', 'score_specificity', 'score_consistency',
    'score_reasoning', 'score_total', 'evaluator_level', 'evaluator_concerns', 'instructor_agreement',
    'instructor_level', 'instructor_question_useful'
  ];
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const words = (text: string) => (text.trim() ? text.trim().split(/\s+/).length : 0);

export async function buildResearchExport(assignmentId: string, options: ResearchExportOptions): Promise<ResearchExport> {
  const submissions: SubmissionRow[] = [];
  const answers: AnswerRow[] = [];
  const records = (await latestSubmissions(assignmentId)).sort((a, b) => a.submittedAt - b.submittedAt);

  for (const record of records) {
    const [questionSet, answerSet, evaluation, feedback] = await Promise.all([
      getQuestionSet(record.id),
      getAnswers(record.id),
      getEvaluation(record.id),
      getFeedback(record.id)
    ]);
    const participant = participantId(options.salt, record.studentId);
    const minutesToAnswers = answerSet ? round1((answerSet.submittedAt - record.submittedAt) / 60000) : null;
    const momentCounts = Object.fromEntries(MOMENT_KINDS.map((k) => [k, 0])) as Record<MomentKind, number>;
    for (const m of record.moments) momentCounts[m.kind] = (momentCounts[m.kind] ?? 0) + 1;
    const reviewed = evaluation?.status === 'ready';

    submissions.push({
      participant,
      assignment: assignmentId,
      minutes_to_answers: minutesToAnswers,
      answered: answerSet !== null,
      questions_status: questionSet?.status ?? 'none',
      evaluation_status: evaluation?.status ?? 'none',
      session_count: record.recording.sessionCount,
      recorded_minutes: round1(record.recording.recordedMs / 60000),
      typed_chars: record.recording.typedChars,
      bulk_inserted_chars: record.recording.bulkInsertedChars,
      pre_existing_chars: record.recording.preExistingChars,
      runs_passed: record.recording.runs.passed,
      runs_failed: record.recording.runs.failed,
      runs_unknown: record.recording.runs.unknown,
      replay_verdict: record.replay.verdict,
      replay_files_differing: record.replay.counts.differs + record.replay.counts['not-recorded'],
      moments_total: record.moments.length,
      moments_fix_after_failed_run: momentCounts['fix-after-failed-run'],
      moments_repeated_failures: momentCounts['repeated-failures'],
      moments_bulk_insert: momentCounts['bulk-insert'],
      moments_rewrite: momentCounts.rewrite,
      moments_abandoned_approach: momentCounts['abandoned-approach'],
      moments_function_written: momentCounts['function-written'],
      review_strong: reviewed ? evaluation.counts.strong : null,
      review_partial: reviewed ? evaluation.counts.partial : null,
      review_limited: reviewed ? evaluation.counts.limited : null,
      instructor_follow_up: feedback ? feedback.overall.followUp : null
    });

    if (!questionSet || questionSet.status !== 'ready' || !answerSet) continue;
    const momentKind = new Map(record.moments.map((m) => [m.id, m.kind]));
    for (const question of questionSet.questions) {
      const answer = answerSet.answers.find((a) => a.questionId === question.id);
      if (!answer) continue;
      const review = reviewed ? evaluation.evaluations.find((e) => e.questionId === question.id) : undefined;
      const rating = feedback?.answers[question.id];
      const total = review ? review.scores.specificity + review.scores.consistency + review.scores.reasoning : null;
      answers.push({
        participant,
        assignment: assignmentId,
        question: question.id,
        question_type: question.type,
        concept: question.concept,
        cites_moment_kind: question.momentId ? (momentKind.get(question.momentId) ?? '') : '',
        generator_model: questionSet.model,
        generator_prompt: questionSet.promptVersion,
        minutes_to_answers: minutesToAnswers,
        answer_chars: answer.text.length,
        answer_words: words(answer.text),
        ...(options.includeText ? { answer_text: answer.text } : {}),
        evaluator_model: reviewed ? evaluation.model : '',
        evaluator_prompt: reviewed ? evaluation.promptVersion : '',
        addresses_question: review ? review.addressesQuestion : null,
        score_specificity: review ? review.scores.specificity : null,
        score_consistency: review ? review.scores.consistency : null,
        score_reasoning: review ? review.scores.reasoning : null,
        score_total: total,
        evaluator_level: review?.level ?? '',
        evaluator_concerns: review ? review.concerns.length : null,
        instructor_agreement: rating?.agreement ?? '',
        instructor_level: rating?.ownLevel ?? '',
        instructor_question_useful: feedback?.questions[question.id]?.useful ?? null
      });
    }
  }

  // Extension point: comparison data between students (Phase 6, lib/cohort.ts)
  // can be added as another table here, keyed by participant codes only.

  return { assignment: assignmentId, generatedAt: Date.now(), submissions, answers };
}
