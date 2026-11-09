import { InsertedBlock, bulkInsertedBlocks, compareCode, compareInsertedBlocks, compareText } from '@codelapse/core';
import { findStudent } from './course';
import { readSessions } from './recording';
import { getAnswers, getQuestionSet, latestSubmissions, readAllSubmittedCode } from './store';
import type { SubmissionRecord } from './types';

/** Pairs with fewer than this many comparisons have no meaningful class baseline. */
export const MIN_PAIRS_FOR_BASELINE = 4;
/** Answer pairs below this similarity are not worth showing. */
export const ANSWER_MATCH_MIN = 0.5;
const MAX_ANSWER_MATCHES = 3;
const BLOCK_PREVIEW_CHARS = 600;

export type SignalName = 'codeStructural' | 'codeExact' | 'pastedBlock' | 'answers';
export const SIGNALS: SignalName[] = ['codeStructural', 'codeExact', 'pastedBlock', 'answers'];

export interface CohortStudent {
  studentId: string;
  name: string;
  submissionId: string;
}

export interface FileComparison {
  name: string;
  exact: number;
  structural: number;
  matchedLinesA: number[];
  matchedLinesB: number[];
}

export interface PastedBlockMatch {
  score: number;
  /** Same structure with some names changed. */
  renamed: boolean;
  a: { text: string; chars: number; at: number; filePath: string };
  b: { text: string; chars: number; at: number; filePath: string };
}

export interface AnswerMatch {
  score: number;
  /** Shared wording as written in a's answer, and as written in b's. */
  sharedPhrases: string[];
  sharedPhrasesB: string[];
  a: { questionId: string; question: string; answer: string };
  b: { questionId: string; question: string; answer: string };
}

export interface PairComparison {
  a: CohortStudent;
  b: CohortStudent;
  code: { files: FileComparison[]; exact: number | null; structural: number | null };
  pasted: { score: number | null; matches: PastedBlockMatch[] };
  answers: { score: number | null; matches: AnswerMatch[]; available: boolean };
  /** Each 0-1, or null when there is nothing to compare (no shared file, no bulk inserts, no answers). */
  signals: Record<SignalName, number | null>;
  /** The largest signal. */
  strongest: number;
  /** Signals clearly above what is typical for this class. */
  aboveTypical: Record<SignalName, boolean>;
  reasons: string[];
}

export interface CohortStats {
  pairCount: number;
  /** False with too few pairs to say what is typical. */
  hasBaseline: boolean;
  median: Record<SignalName, number | null>;
  max: Record<SignalName, number | null>;
}

export interface Cohort {
  students: CohortStudent[];
  pairs: PairComparison[];
  stats: CohortStats;
}

interface Material {
  student: CohortStudent;
  record: SubmissionRecord;
  code: { name: string; content: string }[];
  blocks: InsertedBlock[];
  answers: { questionId: string; question: string; answer: string }[];
}

/**
 * Compares every pair of students' latest submissions for an assignment:
 * their code (exact and with names ignored), blocks inserted in one edit
 * that appear in both recordings, and their written answers. The result
 * describes resemblance; it is never a verdict.
 */
export async function buildCohort(assignmentId: string): Promise<Cohort> {
  const latest = await latestSubmissions(assignmentId);
  const materials = await Promise.all(latest.map(loadMaterial));
  materials.sort((x, y) => x.student.name.localeCompare(y.student.name));

  const raw: Omit<PairComparison, 'aboveTypical' | 'reasons'>[] = [];
  for (let i = 0; i < materials.length; i++) {
    for (let j = i + 1; j < materials.length; j++) {
      raw.push(comparePair(materials[i], materials[j]));
    }
  }

  const stats = computeStats(raw);
  const pairs = raw
    .map((pair) => {
      const aboveTypical = flagAboveTypical(pair.signals, stats);
      return { ...pair, aboveTypical, reasons: describe(pair) };
    })
    .sort((x, y) => agreeingSignals(y) - agreeingSignals(x) || y.strongest - x.strongest || total(y) - total(x));

  return { students: materials.map((m) => m.student), pairs, stats };
}

/** A signal this high counts towards how many independent signals agree. */
const HIGH_SIGNAL = 0.6;

/**
 * How many independent signals are high for a pair: code (exact or structure,
 * counted once), the same block inserted in one edit, and answer wording.
 * Pairs are ranked by this first, so several kinds of evidence agreeing outrank
 * one signal alone; everyone solves the same assignment, so code alone can be
 * high for many pairs.
 */
export function agreeingSignals(pair: { signals: Record<SignalName, number | null> }): number {
  const high = (v: number | null) => v !== null && v >= HIGH_SIGNAL;
  return (
    Number(high(pair.signals.codeStructural) || high(pair.signals.codeExact)) +
    Number(high(pair.signals.pastedBlock)) +
    Number(high(pair.signals.answers))
  );
}

/** The kinds of evidence that are high for a pair, in plain words, e.g. ["code", "same inserted block"]. */
export function agreeingSignalNames(pair: { signals: Record<SignalName, number | null> }): string[] {
  const high = (v: number | null) => v !== null && v >= HIGH_SIGNAL;
  const names: string[] = [];
  if (high(pair.signals.codeStructural) || high(pair.signals.codeExact)) names.push('code');
  if (high(pair.signals.pastedBlock)) names.push('same inserted block');
  if (high(pair.signals.answers)) names.push('answer wording');
  return names;
}

function total(pair: { signals: Record<SignalName, number | null> }): number {
  return SIGNALS.reduce((t, s) => t + (pair.signals[s] ?? 0), 0);
}

/** The comparison of two submissions, by submission id, if both are in the cohort. */
export async function findPair(assignmentId: string, idA: string, idB: string): Promise<{ cohort: Cohort; pair: PairComparison } | null> {
  const cohort = await buildCohort(assignmentId);
  const pair = cohort.pairs.find(
    (p) =>
      (p.a.submissionId === idA && p.b.submissionId === idB) || (p.a.submissionId === idB && p.b.submissionId === idA)
  );
  if (!pair) {
    return null;
  }
  // Keep the order the instructor asked for.
  return { cohort, pair: pair.a.submissionId === idA ? pair : swap(pair) };
}

async function loadMaterial(record: SubmissionRecord): Promise<Material> {
  const [code, sessions, questions, answers] = await Promise.all([
    readAllSubmittedCode(record),
    readSessions(record.id),
    getQuestionSet(record.id),
    getAnswers(record.id)
  ]);
  const questionText = new Map((questions?.questions ?? []).map((q) => [q.id, q.text]));
  return {
    student: { studentId: record.studentId, name: findStudent(record.studentId)?.name ?? record.studentId, submissionId: record.id },
    record,
    code,
    blocks: sessions ? bulkInsertedBlocks(sessions) : [],
    answers: (answers?.answers ?? [])
      .filter((a) => a.text.trim())
      .map((a) => ({ questionId: a.questionId, question: questionText.get(a.questionId) ?? '', answer: a.text }))
  };
}

function comparePair(x: Material, y: Material): Omit<PairComparison, 'aboveTypical' | 'reasons'> {
  // Code: files present in both, matched by name.
  const files: FileComparison[] = [];
  for (const fileA of x.code) {
    const fileB = y.code.find((f) => f.name === fileA.name);
    if (fileB && fileA.content.trim() && fileB.content.trim()) {
      files.push({ name: fileA.name, ...compareCode(fileA.content, fileB.content) });
    }
  }
  const exact = files.length ? Math.max(...files.map((f) => f.exact)) : null;
  const structural = files.length ? Math.max(...files.map((f) => f.structural)) : null;

  // Blocks inserted in one edit (pastes, autocomplete, formatting) found in both recordings.
  let pastedScore: number | null = null;
  const blockMatches: PastedBlockMatch[] = [];
  if (x.blocks.length && y.blocks.length) {
    const result = compareInsertedBlocks(x.blocks, y.blocks);
    pastedScore = result.score;
    for (const m of [...result.matches].sort((p, q) => q.score - p.score).slice(0, 3)) {
      const ba = x.blocks[m.a];
      const bb = y.blocks[m.b];
      if (!ba || !bb) continue;
      blockMatches.push({ score: m.score, renamed: m.renamed, a: preview(ba), b: preview(bb) });
    }
  }

  // Answers: every answer pair across the two students. Questions differ per student,
  // so near-identical wording across them stands out.
  const answerMatches: AnswerMatch[] = [];
  for (const ansA of x.answers) {
    for (const ansB of y.answers) {
      const { score, sharedPhrases } = compareText(ansA.answer, ansB.answer);
      if (score >= ANSWER_MATCH_MIN) {
        const sharedPhrasesB = compareText(ansB.answer, ansA.answer).sharedPhrases;
        answerMatches.push({ score, sharedPhrases, sharedPhrasesB, a: ansA, b: ansB });
      }
    }
  }
  answerMatches.sort((p, q) => q.score - p.score);
  const answersAvailable = x.answers.length > 0 && y.answers.length > 0;
  let answerScore: number | null = null;
  if (answersAvailable) {
    answerScore = 0;
    for (const ansA of x.answers) {
      for (const ansB of y.answers) {
        answerScore = Math.max(answerScore, compareText(ansA.answer, ansB.answer).score);
      }
    }
  }

  const signals: Record<SignalName, number | null> = {
    codeStructural: structural,
    codeExact: exact,
    pastedBlock: pastedScore,
    answers: answerScore
  };
  const values = SIGNALS.map((s) => signals[s]).filter((v): v is number => v !== null);
  return {
    a: x.student,
    b: y.student,
    code: { files, exact, structural },
    pasted: { score: pastedScore, matches: blockMatches },
    answers: { score: answerScore, matches: answerMatches.slice(0, MAX_ANSWER_MATCHES), available: answersAvailable },
    signals,
    strongest: values.length ? Math.max(...values) : 0
  };
}

function preview(block: InsertedBlock) {
  const text = block.text.length > BLOCK_PREVIEW_CHARS ? `${block.text.slice(0, BLOCK_PREVIEW_CHARS)}…` : block.text;
  return { text, chars: block.chars, at: block.at, filePath: block.filePath };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((p, q) => p - q);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeStats(pairs: { signals: Record<SignalName, number | null> }[]): CohortStats {
  const medianOf = {} as Record<SignalName, number | null>;
  const maxOf = {} as Record<SignalName, number | null>;
  for (const s of SIGNALS) {
    // No inserted block in one of the recordings means nothing shared: that is 0, not unknown.
    // Missing answers really are unknown, so those pairs are left out of the baseline.
    const values = pairs
      .map((p) => (s === 'pastedBlock' ? (p.signals[s] ?? 0) : p.signals[s]))
      .filter((v): v is number => v !== null);
    medianOf[s] = median(values);
    maxOf[s] = values.length ? Math.max(...values) : null;
  }
  return { pairCount: pairs.length, hasBaseline: pairs.length >= MIN_PAIRS_FOR_BASELINE, median: medianOf, max: maxOf };
}

/** A signal is above typical when it is high in itself and well above this class's median. */
export function flagAboveTypical(signals: Record<SignalName, number | null>, stats: CohortStats): Record<SignalName, boolean> {
  const flags = {} as Record<SignalName, boolean>;
  for (const s of SIGNALS) {
    const value = signals[s];
    const typical = stats.median[s];
    flags[s] = stats.hasBaseline && value !== null && typical !== null && value >= 0.6 && value >= typical + 0.25;
  }
  return flags;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

function describe(pair: Omit<PairComparison, 'aboveTypical' | 'reasons'>): string[] {
  const reasons: string[] = [];
  const { exact, structural } = pair.code;
  if (structural !== null && exact !== null) {
    const namesDiffer = structural - exact >= 0.15;
    reasons.push(
      `Code structure ${pct(structural)} similar (exact ${pct(exact)}${namesDiffer ? ': names differ' : ''})`
    );
  } else {
    reasons.push('No code file with the same name to compare');
  }
  const block = pair.pasted.matches[0];
  if (block && block.score >= 0.9 && block.renamed) {
    reasons.push(
      `Both recordings contain a ${Math.min(block.a.chars, block.b.chars)}-character block inserted in one edit with the same structure, some names differing`
    );
  } else if (block && block.score >= 0.9) {
    reasons.push(`Both recordings contain the same ${Math.min(block.a.chars, block.b.chars)}-character block inserted in one edit`);
  } else if (block && block.score >= 0.5) {
    reasons.push(`Both recordings contain a similar block inserted in one edit (${pct(block.score)} alike)`);
  }
  const strongAnswers = pair.answers.matches.filter((m) => m.score >= ANSWER_MATCH_MIN);
  if (strongAnswers.length > 0) {
    const phrase = strongAnswers[0].sharedPhrases[0];
    const count = strongAnswers.length === 1 ? 'One answer shares' : `${strongAnswers.length} answer pairs share`;
    reasons.push(phrase ? `${count} wording: "${phrase}"` : `${count} much of its wording (${pct(strongAnswers[0].score)})`);
  } else if (!pair.answers.available) {
    reasons.push('Answers not available for both students');
  }
  return reasons;
}

function swap(pair: PairComparison): PairComparison {
  return {
    ...pair,
    a: pair.b,
    b: pair.a,
    code: {
      ...pair.code,
      files: pair.code.files.map((f) => ({ ...f, matchedLinesA: f.matchedLinesB, matchedLinesB: f.matchedLinesA }))
    },
    pasted: { ...pair.pasted, matches: pair.pasted.matches.map((m) => ({ ...m, a: m.b, b: m.a })) },
    answers: {
      ...pair.answers,
      matches: pair.answers.matches.map((m) => ({ ...m, a: m.b, b: m.a, sharedPhrases: m.sharedPhrasesB, sharedPhrasesB: m.sharedPhrases }))
    }
  };
}
