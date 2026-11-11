import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { parseSessionLog } from '@codelapse/core';
import { decodeBundle } from '@codelapse/core/node';
import { COURSE } from '../course';
import type { SubmissionRecord } from '../types';
import type { AnswerSet, QuestionSet } from '../questions/types';
import type { EvaluationSet } from '../evaluation/types';
import type { InstructorFeedback } from './feedback';
import { participantId } from './pseudonym';

/**
 * Builds one SQLite file holding everything recorded for the research study:
 * the assignment, each submission's recording, code, replay check and decision
 * moments, the questions, answers, AI reviews, instructor ratings, and every AI
 * request and reply. The live site keeps its per-submission files; this is a
 * snapshot of them for analysis.
 *
 * Command-line only (`npm run research:db`): it uses Node's built-in
 * node:sqlite, which the website never imports.
 */

export const SCHEMA_VERSION = 2;

/** The few node:sqlite calls used here; typed locally because @types/node predates the module. */
interface Statement {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): Record<string, unknown>[];
}
interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}
type DatabaseConstructor = new (file: string) => Database;

export function openDatabase(file: string): Database {
  const load = createRequire(__filename);
  const { DatabaseSync } = load('node:sqlite') as { DatabaseSync: DatabaseConstructor };
  return new DatabaseSync(file);
}

export interface DataSource {
  /** A data folder: apps/web/data or an archive of it. */
  dir: string;
  /** Name of the run it holds, stored with each submission ("current" or the archive folder name). */
  run: string;
}

export interface BuildOptions {
  sources: DataSource[];
  outFile: string;
  salt: string;
  /** Where the salt came from, recorded in meta (never the salt itself). */
  saltSource: string;
  includeNames: boolean;
  appVersion: string;
  now?: number;
}

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE assignments (
  id TEXT PRIMARY KEY, course_id TEXT, title TEXT, language TEXT, description TEXT, points INTEGER, due_at TEXT
);

CREATE TABLE participants (participant_id TEXT PRIMARY KEY, name TEXT);

CREATE TABLE submissions (
  submission_id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(participant_id),
  assignment_id TEXT REFERENCES assignments(id),
  submitted_at TEXT, questions_close_at TEXT, source_run TEXT,
  replay_verdict TEXT, session_count INTEGER, recorded_ms INTEGER,
  typed_chars INTEGER, bulk_inserted_chars INTEGER, pre_existing_chars INTEGER,
  runs_passed INTEGER, runs_failed INTEGER, runs_unknown INTEGER,
  extension_version TEXT, bundle_sha256 TEXT
);

CREATE TABLE recordings (submission_id TEXT PRIMARY KEY REFERENCES submissions(submission_id), bundle BLOB);

CREATE TABLE files (
  submission_id TEXT NOT NULL REFERENCES submissions(submission_id),
  name TEXT NOT NULL, recorded_path TEXT, size INTEGER, sha256 TEXT, content TEXT,
  PRIMARY KEY (submission_id, name)
);

CREATE TABLE replay_checks (
  submission_id TEXT NOT NULL REFERENCES submissions(submission_id),
  path TEXT NOT NULL, status TEXT, reason TEXT,
  typed_chars INTEGER, bulk_inserted_chars INTEGER, pre_existing_chars INTEGER,
  PRIMARY KEY (submission_id, path)
);

CREATE TABLE sessions (
  submission_id TEXT NOT NULL REFERENCES submissions(submission_id),
  session_id TEXT NOT NULL, started_at TEXT, ended_at TEXT, snapshots INTEGER, runs INTEGER,
  PRIMARY KEY (submission_id, session_id)
);

CREATE TABLE runs (
  submission_id TEXT NOT NULL REFERENCES submissions(submission_id),
  session_id TEXT NOT NULL, at_ms INTEGER, command TEXT, success INTEGER, duration_ms INTEGER, output TEXT
);

CREATE TABLE moments (
  submission_id TEXT NOT NULL REFERENCES submissions(submission_id),
  moment_id TEXT NOT NULL, kind TEXT, session_id TEXT, at_ms INTEGER, file TEXT, function_name TEXT,
  summary TEXT, before TEXT, after TEXT, score REAL,
  PRIMARY KEY (submission_id, moment_id)
);

CREATE TABLE questions (
  submission_id TEXT NOT NULL REFERENCES submissions(submission_id),
  question_id TEXT NOT NULL, position INTEGER, type TEXT, concept TEXT, text TEXT,
  moment_id TEXT, code_file TEXT, code_start INTEGER, code_end INTEGER,
  rationale TEXT, strong_answer_points TEXT,
  generator_provider TEXT, generator_model TEXT, prompt_version TEXT,
  PRIMARY KEY (submission_id, question_id)
);

CREATE TABLE question_sets (
  submission_id TEXT PRIMARY KEY REFERENCES submissions(submission_id),
  status TEXT, error TEXT, provider TEXT, model TEXT, prompt_version TEXT,
  started_at TEXT, finished_at TEXT, notes_for_instructor TEXT
);

CREATE TABLE answers (
  submission_id TEXT NOT NULL REFERENCES submissions(submission_id),
  question_id TEXT NOT NULL, text TEXT, chars INTEGER, words INTEGER, submitted_at TEXT,
  PRIMARY KEY (submission_id, question_id)
);

CREATE TABLE reviews (
  submission_id TEXT NOT NULL REFERENCES submissions(submission_id),
  question_id TEXT NOT NULL, addresses_question INTEGER,
  specificity INTEGER, consistency INTEGER, reasoning INTEGER, total INTEGER, level TEXT,
  evidence_quotes TEXT, explanation TEXT, concerns TEXT,
  reviewer_provider TEXT, reviewer_model TEXT, prompt_version TEXT,
  PRIMARY KEY (submission_id, question_id)
);

CREATE TABLE review_summaries (
  submission_id TEXT PRIMARY KEY REFERENCES submissions(submission_id),
  status TEXT, summary TEXT, notes TEXT, error TEXT,
  strong INTEGER, partial INTEGER, limited INTEGER
);

CREATE TABLE instructor_ratings (
  submission_id TEXT NOT NULL REFERENCES submissions(submission_id),
  question_id TEXT NOT NULL, agreement TEXT, own_level TEXT, answer_note TEXT,
  question_useful INTEGER, question_note TEXT,
  PRIMARY KEY (submission_id, question_id)
);

CREATE TABLE instructor_overall (
  submission_id TEXT PRIMARY KEY REFERENCES submissions(submission_id),
  note TEXT, follow_up INTEGER, updated_at TEXT
);

CREATE TABLE ai_calls (
  submission_id TEXT NOT NULL REFERENCES submissions(submission_id),
  role TEXT NOT NULL, attempt INTEGER NOT NULL, at TEXT, provider TEXT, model TEXT,
  system_prompt TEXT, user_prompt TEXT, output TEXT, validation_errors TEXT,
  input_tokens INTEGER, output_tokens INTEGER,
  PRIMARY KEY (submission_id, role, attempt)
);

CREATE TABLE injection_signals (
  submission_id TEXT NOT NULL REFERENCES submissions(submission_id),
  source TEXT, file TEXT, line INTEGER, text TEXT
);

CREATE INDEX idx_submissions_participant ON submissions(participant_id);
CREATE INDEX idx_runs_submission ON runs(submission_id);
CREATE INDEX idx_injection_submission ON injection_signals(submission_id);

CREATE VIEW v_answer_reviews AS
SELECT s.participant_id, q.submission_id, q.question_id, q.position, q.type AS question_type, q.concept,
       q.text AS question, a.text AS answer, a.words AS answer_words,
       r.specificity, r.consistency, r.reasoning, r.total, r.level AS review_level,
       r.explanation AS review_explanation, r.concerns AS review_concerns,
       ir.agreement AS instructor_agreement, ir.own_level AS instructor_level, ir.question_useful
FROM questions q
JOIN submissions s ON s.submission_id = q.submission_id
LEFT JOIN answers a ON a.submission_id = q.submission_id AND a.question_id = q.question_id
LEFT JOIN reviews r ON r.submission_id = q.submission_id AND r.question_id = q.question_id
LEFT JOIN instructor_ratings ir ON ir.submission_id = q.submission_id AND ir.question_id = q.question_id;

CREATE VIEW v_process_vs_code AS
SELECT q.type AS question_type,
       COUNT(r.question_id) AS reviewed_answers,
       ROUND(AVG(r.total), 2) AS avg_total,
       SUM(r.level = 'strong') AS strong, SUM(r.level = 'partial') AS partial, SUM(r.level = 'limited') AS limited,
       SUM(ir.question_useful = 1) AS rated_useful
FROM questions q
LEFT JOIN reviews r ON r.submission_id = q.submission_id AND r.question_id = q.question_id
LEFT JOIN instructor_ratings ir ON ir.submission_id = q.submission_id AND ir.question_id = q.question_id
GROUP BY q.type;

CREATE VIEW v_reviewer_agreement AS
SELECT r.level AS review_level, ir.own_level AS instructor_level, ir.agreement, COUNT(*) AS answers
FROM reviews r
JOIN instructor_ratings ir ON ir.submission_id = r.submission_id AND ir.question_id = r.question_id
WHERE ir.own_level IS NOT NULL OR ir.agreement IS NOT NULL
GROUP BY r.level, ir.own_level, ir.agreement;
`;

const iso = (ms: number | undefined | null): string | null =>
  typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
const json = (value: unknown): string | null => (value === undefined || value === null ? null : JSON.stringify(value));
const bool = (value: boolean | null | undefined): number | null => (value === true ? 1 : value === false ? 0 : null);
const words = (text: string): number => (text.trim() ? text.trim().split(/\s+/).length : 0);

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

async function readBytes(file: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(file);
  } catch {
    return null;
  }
}

/** Builds (overwriting) the research database and returns the row count of every table. */
export async function buildResearchDatabase(options: BuildOptions): Promise<Record<string, number>> {
  await fs.mkdir(path.dirname(options.outFile), { recursive: true });
  await fs.rm(options.outFile, { force: true });
  const db = openDatabase(options.outFile);
  try {
    db.exec(SCHEMA);
    db.exec('BEGIN');
    writeMeta(db, options);
    writeAssignments(db);
    const seenParticipants = new Set<string>();
    const seenSubmissions = new Set<string>();
    for (const source of options.sources) {
      let ids: string[];
      try {
        ids = (await fs.readdir(path.join(source.dir, 'submissions'))).sort();
      } catch {
        continue;
      }
      for (const id of ids) {
        if (seenSubmissions.has(id)) continue;
        const written = await writeSubmission(db, path.join(source.dir, 'submissions', id), source.run, options, seenParticipants);
        if (written) seenSubmissions.add(id);
      }
    }
    db.exec('COMMIT');
    return tableCounts(db);
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Nothing to roll back.
    }
    throw err;
  } finally {
    db.close();
  }
}

export function tableCounts(db: Database): Record<string, number> {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row.name));
  return Object.fromEntries(
    tables.map((table) => [table, Number(db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).all()[0].n)])
  );
}

function writeMeta(db: Database, options: BuildOptions): void {
  const insert = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
  const rows: [string, string][] = [
    ['schema_version', String(SCHEMA_VERSION)],
    ['created_at', new Date(options.now ?? Date.now()).toISOString()],
    ['source_runs', options.sources.map((s) => s.run).join(', ')],
    ['salt_source', options.saltSource],
    ['includes_names', options.includeNames ? 'yes' : 'no'],
    ['app_version', options.appVersion],
    ['participant_ids', 'P + first 8 hex digits of sha256(salt + student id)']
  ];
  for (const [key, value] of rows) insert.run(key, value);
}

function writeAssignments(db: Database): void {
  const insert = db.prepare(
    'INSERT INTO assignments (id, course_id, title, language, description, points, due_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  for (const a of COURSE.assignments) {
    insert.run(a.id, COURSE.id, a.title, a.language, a.description.join('\n\n'), a.points, a.dueAt);
  }
}

async function writeSubmission(
  db: Database,
  dir: string,
  run: string,
  options: BuildOptions,
  seenParticipants: Set<string>
): Promise<boolean> {
  const record = await readJson<SubmissionRecord>(path.join(dir, 'submission.json'));
  if (!record?.id || !record.studentId) {
    return false; // An unfinished upload: submission.json is written last.
  }
  const participant = participantId(options.salt, record.studentId);
  if (!seenParticipants.has(participant)) {
    const name = options.includeNames ? (COURSE.students.find((s) => s.id === record.studentId)?.name ?? record.studentId) : null;
    db.prepare('INSERT INTO participants (participant_id, name) VALUES (?, ?)').run(participant, name);
    seenParticipants.add(participant);
  }

  const bundle = await readBytes(path.join(dir, 'recording.codelapse'));
  const rec = record.recording ?? ({} as SubmissionRecord['recording']);
  db.prepare(
    `INSERT INTO submissions (submission_id, participant_id, assignment_id, submitted_at, questions_close_at, source_run,
       replay_verdict, session_count, recorded_ms, typed_chars, bulk_inserted_chars, pre_existing_chars,
       runs_passed, runs_failed, runs_unknown, extension_version, bundle_sha256)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    participant,
    record.assignmentId ?? null,
    iso(record.submittedAt),
    iso(record.questionsCloseAt),
    run,
    record.replay?.verdict ?? null,
    rec.sessionCount ?? null,
    rec.recordedMs ?? null,
    rec.typedChars ?? null,
    rec.bulkInsertedChars ?? null,
    rec.preExistingChars ?? null,
    rec.runs?.passed ?? null,
    rec.runs?.failed ?? null,
    rec.runs?.unknown ?? null,
    rec.extensionVersion ?? null,
    bundle ? createHash('sha256').update(bundle).digest('hex') : null
  );

  // The recording itself, kept whole, and its sessions and runs.
  if (bundle) {
    db.prepare('INSERT INTO recordings (submission_id, bundle) VALUES (?, ?)').run(record.id, bundle);
    try {
      const sessionInsert = db.prepare(
        'INSERT OR IGNORE INTO sessions (submission_id, session_id, started_at, ended_at, snapshots, runs) VALUES (?, ?, ?, ?, ?, ?)'
      );
      const runInsert = db.prepare(
        'INSERT INTO runs (submission_id, session_id, at_ms, command, success, duration_ms, output) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      for (const entry of decodeBundle(bundle).sessions) {
        const session = parseSessionLog(entry.log);
        sessionInsert.run(record.id, session.id, iso(session.startTime), iso(session.endTime), session.snapshots.length, session.runs.length);
        for (const r of session.runs) {
          runInsert.run(record.id, session.id, r.timestamp, r.command ?? null, bool(r.success), r.durationMs ?? null, r.output ?? null);
        }
      }
    } catch {
      // A damaged bundle is still stored whole; its sessions are simply not broken out.
    }
  }

  const fileInsert = db.prepare(
    'INSERT OR IGNORE INTO files (submission_id, name, recorded_path, size, sha256, content) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const file of record.files ?? []) {
    let content: string | null = null;
    try {
      content = await fs.readFile(path.join(dir, 'code', path.basename(file.name)), 'utf-8');
    } catch {
      content = null;
    }
    fileInsert.run(record.id, file.name, file.recordedPath ?? null, file.size ?? null, file.sha256 ?? null, content);
  }

  const checkInsert = db.prepare(
    `INSERT OR IGNORE INTO replay_checks (submission_id, path, status, reason, typed_chars, bulk_inserted_chars, pre_existing_chars)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const check of record.replay?.files ?? []) {
    checkInsert.run(
      record.id,
      check.path,
      check.status,
      check.reason ?? null,
      check.authorship?.typedChars ?? null,
      check.authorship?.bulkInsertedChars ?? null,
      check.authorship?.preExistingChars ?? null
    );
  }

  const momentInsert = db.prepare(
    `INSERT OR IGNORE INTO moments (submission_id, moment_id, kind, session_id, at_ms, file, function_name, summary, before, after, score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const m of record.moments ?? []) {
    momentInsert.run(
      record.id, m.id, m.kind, m.sessionId ?? null, m.at ?? null, m.filePath ?? null, m.functionName ?? null,
      m.summary ?? null, m.before ?? null, m.after ?? null, m.score ?? null
    );
  }

  const questions = await readJson<QuestionSet>(path.join(dir, 'questions.json'));
  if (questions) writeQuestions(db, record.id, questions);
  const answers = await readJson<AnswerSet>(path.join(dir, 'answers.json'));
  if (answers) writeAnswers(db, record.id, answers);
  const evaluation = await readJson<EvaluationSet>(path.join(dir, 'evaluation.json'));
  if (evaluation) writeEvaluation(db, record.id, evaluation);
  const feedback = await readJson<InstructorFeedback>(path.join(dir, 'instructor-feedback.json'));
  if (feedback) writeFeedback(db, record.id, feedback);
  return true;
}

function writeQuestions(db: Database, id: string, set: QuestionSet): void {
  db.prepare(
    `INSERT INTO question_sets (submission_id, status, error, provider, model, prompt_version, started_at, finished_at, notes_for_instructor)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, set.status ?? null, set.error ?? null, set.provider || null, set.model || null, set.promptVersion ?? null,
    iso(set.startedAt), iso(set.finishedAt), set.notesForInstructor ?? null
  );
  const insert = db.prepare(
    `INSERT OR IGNORE INTO questions (submission_id, question_id, position, type, concept, text, moment_id, code_file, code_start, code_end,
       rationale, strong_answer_points, generator_provider, generator_model, prompt_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  (set.questions ?? []).forEach((q, i) => {
    insert.run(
      id, q.id, i + 1, q.type, q.concept ?? null, q.text, q.momentId ?? null,
      q.codeRef?.file ?? null, q.codeRef?.startLine ?? null, q.codeRef?.endLine ?? null,
      q.rationale ?? null, json(q.strongAnswerPoints), set.provider || null, set.model || null, set.promptVersion ?? null
    );
  });
  writeCalls(db, id, 'questions', set.provider, set.model, set.log ?? []);
  writeSignals(db, id, 'code', set.injectionSignals ?? []);
}

function writeAnswers(db: Database, id: string, set: AnswerSet): void {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO answers (submission_id, question_id, text, chars, words, submitted_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const a of set.answers ?? []) {
    insert.run(id, a.questionId, a.text, a.text.length, words(a.text), iso(set.submittedAt));
  }
}

function writeEvaluation(db: Database, id: string, set: EvaluationSet): void {
  db.prepare(
    'INSERT INTO review_summaries (submission_id, status, summary, notes, error, strong, partial, limited) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    id, set.status ?? null, set.summary ?? null, set.notesForInstructor ?? null, set.error ?? null,
    set.counts?.strong ?? null, set.counts?.partial ?? null, set.counts?.limited ?? null
  );
  const insert = db.prepare(
    `INSERT OR IGNORE INTO reviews (submission_id, question_id, addresses_question, specificity, consistency, reasoning, total, level,
       evidence_quotes, explanation, concerns, reviewer_provider, reviewer_model, prompt_version)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const e of set.evaluations ?? []) {
    const s = e.scores ?? { specificity: null, consistency: null, reasoning: null };
    const total = [s.specificity, s.consistency, s.reasoning].every((v) => typeof v === 'number')
      ? (s.specificity as number) + (s.consistency as number) + (s.reasoning as number)
      : null;
    insert.run(
      id, e.questionId, bool(e.addressesQuestion), s.specificity, s.consistency, s.reasoning, total, e.level ?? null,
      json(e.evidenceQuotes), e.explanation ?? null, json(e.concerns), set.provider || null, set.model || null, set.promptVersion ?? null
    );
  }
  writeCalls(db, id, 'review', set.provider, set.model, set.log ?? []);
  writeSignals(db, id, 'answers', set.injectionSignals ?? []);
}

function writeFeedback(db: Database, id: string, feedback: InstructorFeedback): void {
  const ids = new Set([...Object.keys(feedback.answers ?? {}), ...Object.keys(feedback.questions ?? {})]);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO instructor_ratings (submission_id, question_id, agreement, own_level, answer_note, question_useful, question_note)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const questionId of ids) {
    const a = feedback.answers?.[questionId];
    const q = feedback.questions?.[questionId];
    insert.run(id, questionId, a?.agreement ?? null, a?.ownLevel ?? null, a?.note || null, bool(q?.useful), q?.note || null);
  }
  db.prepare('INSERT INTO instructor_overall (submission_id, note, follow_up, updated_at) VALUES (?, ?, ?, ?)').run(
    id, feedback.overall?.note || null, bool(feedback.overall?.followUp), iso(feedback.updatedAt)
  );
}

function writeCalls(
  db: Database,
  id: string,
  role: 'questions' | 'review',
  provider: string,
  model: string,
  log: { at: number; system: string; user: string; output: unknown; validationErrors: string[]; usage?: { inputTokens: number; outputTokens: number } }[]
): void {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO ai_calls (submission_id, role, attempt, at, provider, model, system_prompt, user_prompt, output, validation_errors,
       input_tokens, output_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  log.forEach((call, i) => {
    insert.run(
      id, role, i + 1, iso(call.at), provider || null, model || null, call.system ?? null, call.user ?? null,
      json(call.output), json(call.validationErrors), call.usage?.inputTokens ?? null, call.usage?.outputTokens ?? null
    );
  });
}

function writeSignals(db: Database, id: string, source: 'code' | 'answers', signals: { file: string; line: number; text: string }[]): void {
  const insert = db.prepare('INSERT INTO injection_signals (submission_id, source, file, line, text) VALUES (?, ?, ?, ?, ?)');
  for (const s of signals) insert.run(id, source, s.file, s.line, s.text);
}
