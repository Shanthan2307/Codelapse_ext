import { RunEvent, Session, Snapshot } from './models';
import { findCFunctions, functionAtLine, FunctionSpan, isCSource } from './cFunctions';

/**
 * Decision moments: the points in a student's recording worth asking about,
 * found by plain rules (no AI). The question generator must cite one of these
 * by id, so every question is tied to something that really happened.
 */

export type MomentKind =
  | 'fix-after-failed-run'
  | 'repeated-failures'
  | 'bulk-insert'
  | 'rewrite'
  | 'abandoned-approach'
  | 'function-written';

export interface Moment {
  /** Stable for the same recording: kind, session index and time, e.g. "rewrite-s0-t95000". */
  id: string;
  kind: MomentKind;
  sessionId: string;
  /** Position of the session among the student's sessions, oldest first. */
  sessionIndex: number;
  /** Milliseconds since that session started. */
  at: number;
  /** Epoch milliseconds. */
  absoluteTime: number;
  /** File the moment is about; absent when no file was involved. */
  filePath?: string;
  /** C function the change touched, when the locator could tell. */
  functionName?: string;
  /** One plain sentence for an instructor. */
  summary: string;
  /** Code before the change (short excerpt). */
  before?: string;
  /** Code after the change (short excerpt). */
  after?: string;
  /** Kind-specific facts the summary was built from. */
  evidence: Record<string, string | number | boolean | string[]>;
  /** Ranking used to choose which moments to keep; higher is more worth asking about. */
  score: number;
}

export interface MomentOptions {
  /** Most moments returned. */
  maxMoments?: number;
  /** One edit adding at least this many characters is a bulk insert. */
  bulkInsertMinChars?: number;
  /** A rewrite or abandoned approach involves at least this many non-blank lines. */
  minBlockLines?: number;
  /** Changes within this window after a deletion are read as one rewrite. */
  rewriteWindowMs?: number;
  /** Deleted code must have existed at least this long to count as an abandoned approach. */
  abandonedMinLifetimeMs?: number;
  /** Consecutive failed runs needed for a repeated-failures moment. */
  repeatedFailureMin?: number;
}

export const DEFAULT_MOMENT_OPTIONS: Required<MomentOptions> = {
  maxMoments: 40,
  bulkInsertMinChars: 80,
  minBlockLines: 4,
  rewriteWindowMs: 10 * 60 * 1000,
  abandonedMinLifetimeMs: 2 * 60 * 1000,
  repeatedFailureMin: 3
};

/** Base score per kind: process evidence a student can explain ranks above plain authorship. */
const KIND_SCORE: Record<MomentKind, number> = {
  'fix-after-failed-run': 5,
  rewrite: 4,
  'abandoned-approach': 4,
  'bulk-insert': 3,
  'repeated-failures': 3,
  'function-written': 2
};

const EXCERPT_MAX_LINES = 20;
const EXCERPT_MAX_CHARS = 1200;
const OUTPUT_MAX_LINES = 12;
const OUTPUT_MAX_CHARS = 600;
/** Above this many cells the line diff falls back to one replaced block. */
const MAX_DIFF_CELLS = 4_000_000;

// ---------------------------------------------------------------- line diff

export interface LineHunk {
  /** 0-based index of the first old line. */
  oldStart: number;
  oldLines: string[];
  /** 0-based index of the first new line. */
  newStart: number;
  newLines: string[];
}

/** Line diff: the blocks of `a` that were replaced by blocks of `b` (LCS based). */
export function diffLines(a: string[], b: string[]): LineHunk[] {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }
  const midA = a.slice(prefix, a.length - suffix);
  const midB = b.slice(prefix, b.length - suffix);
  if (midA.length === 0 && midB.length === 0) {
    return [];
  }
  if (midA.length === 0 || midB.length === 0 || (midA.length + 1) * (midB.length + 1) > MAX_DIFF_CELLS) {
    return [{ oldStart: prefix, oldLines: midA, newStart: prefix, newLines: midB }];
  }

  const n = midA.length;
  const m = midB.length;
  const width = m + 1;
  const lcs = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] =
        midA[i] === midB[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  const hunks: LineHunk[] = [];
  let current: LineHunk | null = null;
  const flush = () => {
    if (current) {
      hunks.push(current);
      current = null;
    }
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && midA[i] === midB[j]) {
      flush();
      i++;
      j++;
      continue;
    }
    if (!current) {
      current = { oldStart: prefix + i, oldLines: [], newStart: prefix + j, newLines: [] };
    }
    if (j < m && (i === n || lcs[i * width + j + 1] >= lcs[(i + 1) * width + j])) {
      current.newLines.push(midB[j++]);
    } else {
      current.oldLines.push(midA[i++]);
    }
  }
  flush();
  return hunks;
}

// ---------------------------------------------------------------- helpers

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

function nonBlank(lines: string[]): number {
  return lines.filter((line) => line.trim() !== '').length;
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') {
    start++;
  }
  while (end > start && lines[end - 1].trim() === '') {
    end--;
  }
  return lines.slice(start, end);
}

/** Short code excerpt: at most 20 lines and 1200 characters. */
export function excerpt(lines: string[]): string {
  const trimmed = trimBlankEdges(lines);
  let text = trimmed.slice(0, EXCERPT_MAX_LINES).join('\n');
  let cut = trimmed.length > EXCERPT_MAX_LINES;
  if (text.length > EXCERPT_MAX_CHARS) {
    text = text.slice(0, EXCERPT_MAX_CHARS);
    cut = true;
  }
  return cut ? `${text}\n…` : text;
}

function hunksExcerpt(hunks: LineHunk[], side: 'oldLines' | 'newLines'): string {
  const parts = hunks.map((h) => h[side]).filter((lines) => lines.some((l) => l.trim() !== ''));
  return excerpt(parts.flatMap((lines, k) => (k === 0 ? lines : ['…', ...lines])));
}

function outputExcerpt(output: string): string {
  const lines = output.split(/\r?\n/).filter((line) => line.trim() !== '');
  let text = lines.slice(-OUTPUT_MAX_LINES).join('\n');
  if (text.length > OUTPUT_MAX_CHARS) {
    text = `…${text.slice(-OUTPUT_MAX_CHARS)}`;
  }
  return text;
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${hours} h ${rest} min`;
}

function inFunction(name: string | undefined): string {
  return name ? ` in ${name}()` : '';
}

/** One file's snapshots across all sessions, oldest first. */
interface TimelineEntry {
  sessionIndex: number;
  snapshot: Snapshot;
  absoluteTime: number;
}

/** Caches per-entry work (lines, functions, diffs) for one file's timeline. */
class FileTimeline {
  private lines: (string[] | undefined)[] = [];
  private functions: (FunctionSpan[] | undefined)[] = [];
  private diffs: (LineHunk[] | undefined)[] = [];
  private normalized: (string | undefined)[] = [];

  constructor(
    public readonly filePath: string,
    public readonly entries: TimelineEntry[]
  ) {}

  linesAt(k: number): string[] {
    return (this.lines[k] ??= splitLines(this.entries[k].snapshot.content));
  }

  functionsAt(k: number): FunctionSpan[] {
    if (!isCSource(this.filePath)) {
      return [];
    }
    return (this.functions[k] ??= findCFunctions(this.entries[k].snapshot.content));
  }

  /** Diff from the previous entry in the same session (or from nothing) to entry k. */
  diffAt(k: number): LineHunk[] {
    if (this.diffs[k] === undefined) {
      const prev = this.previousInSession(k);
      this.diffs[k] = diffLines(prev === -1 ? [] : this.linesAt(prev), this.linesAt(k));
    }
    return this.diffs[k]!;
  }

  previousInSession(k: number): number {
    return k > 0 && this.entries[k - 1].sessionIndex === this.entries[k].sessionIndex ? k - 1 : -1;
  }

  /** Content with blank lines dropped and lines trimmed, to search for blocks of code. */
  normalizedAt(k: number): string {
    return (this.normalized[k] ??= `\n${normalizeBlock(this.linesAt(k))}\n`);
  }

  contains(k: number, block: string): boolean {
    return this.normalizedAt(k).includes(`\n${block}\n`);
  }

  functionNameAt(k: number, zeroBasedLine: number): string | undefined {
    return functionAtLine(this.functionsAt(k), zeroBasedLine + 1)?.name;
  }
}

function normalizeBlock(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
}

// ---------------------------------------------------------------- extraction

interface Draft extends Omit<Moment, 'id' | 'sessionId' | 'absoluteTime' | 'score'> {
  baseScore: number;
}

/**
 * Finds the decision moments in one student's sessions. The result is sorted by
 * time and capped at `maxMoments`, keeping the highest scores: a kind's base score
 * plus up to 2 for the size of the change (one point per 20 changed lines). Ties
 * keep the earlier moment. The same sessions always give the same moments and ids.
 */
export function extractMoments(sessions: Session[], options: MomentOptions = {}): Moment[] {
  const opts = { ...DEFAULT_MOMENT_OPTIONS, ...options };
  const ordered = [...sessions].sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  const timelines = buildTimelines(ordered);

  const drafts: Draft[] = [];
  ordered.forEach((session, sessionIndex) => {
    drafts.push(...runMoments(session, sessionIndex, timelines, opts));
  });
  for (const timeline of timelines.values()) {
    drafts.push(...bulkInsertMoments(timeline, opts));
    drafts.push(...rewriteAndAbandonedMoments(timeline, opts));
    drafts.push(...functionWrittenMoments(timeline));
  }

  const seenIds = new Map<string, number>();
  const moments = drafts
    .map((draft) => {
      const session = ordered[draft.sessionIndex];
      const changed = typeof draft.evidence.linesChanged === 'number' ? draft.evidence.linesChanged : 0;
      const { baseScore, ...rest } = draft;
      return {
        ...rest,
        id: '',
        sessionId: session.id,
        absoluteTime: session.startTime + draft.at,
        score: baseScore + Math.min(2, Math.floor(changed / 20))
      };
    })
    .sort(
      (a, b) =>
        a.absoluteTime - b.absoluteTime ||
        a.kind.localeCompare(b.kind) ||
        (a.filePath ?? '').localeCompare(b.filePath ?? '') ||
        (a.functionName ?? '').localeCompare(b.functionName ?? '')
    );

  for (const moment of moments) {
    const base = `${moment.kind}-s${moment.sessionIndex}-t${moment.at}`;
    const count = (seenIds.get(base) ?? 0) + 1;
    seenIds.set(base, count);
    moment.id = count === 1 ? base : `${base}-${count}`;
  }

  const kept = new Set(
    [...moments]
      .sort((a, b) => b.score - a.score || a.absoluteTime - b.absoluteTime || a.id.localeCompare(b.id))
      .slice(0, opts.maxMoments)
  );
  return moments.filter((moment) => kept.has(moment));
}

function buildTimelines(sessions: Session[]): Map<string, FileTimeline> {
  const byFile = new Map<string, TimelineEntry[]>();
  sessions.forEach((session, sessionIndex) => {
    const snapshots = [...session.snapshots].sort((a, b) => a.timestamp - b.timestamp);
    for (const snapshot of snapshots) {
      const list = byFile.get(snapshot.filePath) ?? [];
      list.push({ sessionIndex, snapshot, absoluteTime: session.startTime + snapshot.timestamp });
      byFile.set(snapshot.filePath, list);
    }
  });
  const timelines = new Map<string, FileTimeline>();
  for (const [filePath, entries] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    timelines.set(filePath, new FileTimeline(filePath, entries));
  }
  return timelines;
}

/** Content of a file at `at` in a session: the last snapshot at or before it. */
function contentAt(timeline: FileTimeline, sessionIndex: number, at: number): string | undefined {
  let found: string | undefined;
  for (const entry of timeline.entries) {
    if (entry.sessionIndex === sessionIndex && entry.snapshot.timestamp <= at) {
      found = entry.snapshot.content;
    }
  }
  return found;
}

/** Content a file had before a window, when its first snapshot in the window is its arrival state. */
function contentBefore(timeline: FileTimeline, sessionIndex: number, from: number, to: number): string | undefined {
  const atStart = contentAt(timeline, sessionIndex, from);
  if (atStart !== undefined) {
    return atStart;
  }
  const first = timeline.entries.find(
    (e) => e.sessionIndex === sessionIndex && e.snapshot.timestamp > from && e.snapshot.timestamp <= to
  );
  if (!first) {
    return undefined;
  }
  // A focus capture without edits holds the file as it was on arrival.
  return first.snapshot.trigger === 'focus' && !first.snapshot.edit ? first.snapshot.content : '';
}

function runMoments(
  session: Session,
  sessionIndex: number,
  timelines: Map<string, FileTimeline>,
  opts: Required<MomentOptions>
): Draft[] {
  const drafts: Draft[] = [];
  const runs = [...session.runs].sort((a, b) => a.timestamp - b.timestamp);
  const key = (run: RunEvent) => run.command ?? '';

  // Fix after a failed run: the last failure of a command, then its next pass.
  const lastFailure = new Map<string, RunEvent>();
  runs.forEach((run, index) => {
    if (run.success === false) {
      lastFailure.set(key(run), run);
      return;
    }
    if (run.success !== true) {
      return;
    }
    let failed = lastFailure.get(key(run));
    if (failed) {
      lastFailure.delete(key(run));
    } else if (index > 0 && runs[index - 1].success === false) {
      failed = runs[index - 1];
      lastFailure.delete(key(failed));
    }
    if (!failed) {
      return;
    }
    const draft = fixDraft(session, sessionIndex, timelines, failed, run);
    if (draft) {
      drafts.push(draft);
    }
  });

  // Repeated failures: runs with an unknown result neither count nor break a streak.
  let streak: RunEvent[] = [];
  const closeStreak = () => {
    if (streak.length >= opts.repeatedFailureMin) {
      drafts.push(repeatedDraft(session, sessionIndex, timelines, streak));
    }
    streak = [];
  };
  for (const run of runs) {
    if (run.success === false) {
      streak.push(run);
    } else if (run.success === true) {
      closeStreak();
    }
  }
  closeStreak();
  return drafts;
}

function fixDraft(
  session: Session,
  sessionIndex: number,
  timelines: Map<string, FileTimeline>,
  failed: RunEvent,
  passed: RunEvent
): Draft | null {
  const changes: { filePath: string; hunks: LineHunk[]; after: string; linesChanged: number }[] = [];
  for (const timeline of timelines.values()) {
    const touched = timeline.entries.some(
      (e) =>
        e.sessionIndex === sessionIndex &&
        e.snapshot.timestamp > failed.timestamp &&
        e.snapshot.timestamp <= passed.timestamp
    );
    if (!touched) {
      continue;
    }
    const before = contentBefore(timeline, sessionIndex, failed.timestamp, passed.timestamp) ?? '';
    const after = contentAt(timeline, sessionIndex, passed.timestamp) ?? '';
    if (before === after) {
      continue;
    }
    const hunks = diffLines(splitLines(before), splitLines(after));
    const linesChanged = hunks.reduce((sum, h) => sum + Math.max(h.oldLines.length, h.newLines.length), 0);
    changes.push({ filePath: timeline.filePath, hunks, after, linesChanged });
  }
  if (changes.length === 0) {
    return null;
  }

  const primary = [...changes].sort((a, b) => b.linesChanged - a.linesChanged || a.filePath.localeCompare(b.filePath))[0];
  const firstHunk = primary.hunks[0];
  const functionName =
    isCSource(primary.filePath) && firstHunk
      ? functionAtLine(findCFunctions(primary.after), firstHunk.newStart + 1)?.name
      : undefined;
  const linesChanged = changes.reduce((sum, c) => sum + c.linesChanged, 0);
  const command = failed.command ?? 'a run';

  return {
    kind: 'fix-after-failed-run',
    sessionIndex,
    at: passed.timestamp,
    filePath: primary.filePath,
    functionName,
    summary: `After "${command}" failed, ${primary.filePath}${inFunction(functionName)} was changed (${linesChanged} line${linesChanged === 1 ? '' : 's'}) and "${passed.command ?? 'the next run'}" then passed.`,
    before: hunksExcerpt(primary.hunks, 'oldLines'),
    after: hunksExcerpt(primary.hunks, 'newLines'),
    evidence: {
      failedCommand: command,
      failedOutput: outputExcerpt(failed.output),
      failedAt: failed.timestamp,
      passedCommand: passed.command ?? '',
      passedAt: passed.timestamp,
      changedFiles: changes.map((c) => c.filePath).sort(),
      linesChanged
    },
    baseScore: KIND_SCORE['fix-after-failed-run']
  };
}

function repeatedDraft(
  session: Session,
  sessionIndex: number,
  timelines: Map<string, FileTimeline>,
  streak: RunEvent[]
): Draft {
  const first = streak[0];
  const last = streak[streak.length - 1];
  // The file worked on most during the streak, if any.
  let filePath: string | undefined;
  let most = 0;
  for (const timeline of timelines.values()) {
    const count = timeline.entries.filter(
      (e) =>
        e.sessionIndex === sessionIndex &&
        e.snapshot.timestamp >= first.timestamp &&
        e.snapshot.timestamp <= last.timestamp
    ).length;
    if (count > most) {
      most = count;
      filePath = timeline.filePath;
    }
  }
  const commands = [...new Set(streak.map((r) => r.command ?? 'unnamed run'))];
  return {
    kind: 'repeated-failures',
    sessionIndex,
    at: last.timestamp,
    filePath,
    summary: `${streak.length} runs failed in a row (${commands.map((c) => `"${c}"`).join(', ')}) over ${formatDuration(last.timestamp - first.timestamp)}.`,
    evidence: {
      count: streak.length,
      commands,
      firstAt: first.timestamp,
      lastAt: last.timestamp,
      lastOutput: outputExcerpt(last.output)
    },
    baseScore: KIND_SCORE['repeated-failures']
  };
}

function bulkInsertMoments(timeline: FileTimeline, opts: Required<MomentOptions>): Draft[] {
  const drafts: Draft[] = [];
  timeline.entries.forEach((entry, k) => {
    const edit = entry.snapshot.edit;
    if (!edit || edit.bulkInsertedChars < opts.bulkInsertMinChars) {
      return;
    }
    const hunks = timeline.diffAt(k).filter((h) => h.newLines.length > 0);
    const added = hunks.flatMap((h) => h.newLines);
    const functionName = hunks[0] ? timeline.functionNameAt(k, hunks[0].newStart) : undefined;
    drafts.push({
      kind: 'bulk-insert',
      sessionIndex: entry.sessionIndex,
      at: entry.snapshot.timestamp,
      filePath: timeline.filePath,
      functionName,
      summary: `${edit.bulkInsertedChars} characters were added to ${timeline.filePath}${inFunction(functionName)} in one edit (paste, autocomplete or formatting).`,
      after: excerpt(added),
      evidence: {
        bulkInsertedChars: edit.bulkInsertedChars,
        typedChars: edit.typedChars,
        linesAdded: nonBlank(added),
        linesChanged: nonBlank(added)
      },
      baseScore: KIND_SCORE['bulk-insert'] + (edit.bulkInsertedChars >= 400 ? 1 : 0)
    });
  });
  return drafts;
}

/**
 * Rewrites and abandoned approaches both start with code being removed. From the
 * snapshot before a removal, the file is compared with its state at the end of
 * the rewrite window: blocks replaced by new code are rewrites, blocks simply
 * gone (no new code in their place) are abandoned approaches if they had existed a while and never return.
 */
function rewriteAndAbandonedMoments(timeline: FileTimeline, opts: Required<MomentOptions>): Draft[] {
  const drafts: Draft[] = [];
  const { entries } = timeline;
  let k = 1;
  while (k < entries.length) {
    const prev = timeline.previousInSession(k);
    const removesCode = prev !== -1 && timeline.diffAt(k).some((h) => nonBlank(h.oldLines) > 0);
    if (!removesCode) {
      k++;
      continue;
    }

    const start = prev;
    const deletion = entries[k];
    let end = k;
    while (
      end + 1 < entries.length &&
      entries[end + 1].sessionIndex === deletion.sessionIndex &&
      entries[end + 1].snapshot.timestamp - deletion.snapshot.timestamp <= opts.rewriteWindowMs
    ) {
      end++;
    }

    for (const hunk of diffLines(timeline.linesAt(start), timeline.linesAt(end))) {
      const removed = nonBlank(hunk.oldLines);
      if (removed < opts.minBlockLines) {
        continue;
      }
      const functionName = timeline.functionNameAt(start, hunk.oldStart);
      const added = nonBlank(hunk.newLines);
      // Any new code in the block's place makes it a replacement; nothing at all is a deletion.
      if (added >= 1) {
        drafts.push({
          kind: 'rewrite',
          sessionIndex: deletion.sessionIndex,
          at: deletion.snapshot.timestamp,
          filePath: timeline.filePath,
          functionName,
          summary: `${removed} lines in ${timeline.filePath}${inFunction(functionName)} were replaced with ${added} different lines.`,
          before: excerpt(hunk.oldLines),
          after: excerpt(hunk.newLines),
          evidence: {
            linesRemoved: removed,
            linesAdded: added,
            windowEndAt: entries[end].snapshot.timestamp,
            linesChanged: Math.max(removed, added)
          },
          baseScore: KIND_SCORE.rewrite
        });
        continue;
      }

      const abandoned = abandonedDraft(timeline, start, k, end, hunk, functionName, opts);
      if (abandoned) {
        drafts.push(abandoned);
      }
    }
    k = end + 1;
  }
  return drafts;
}

function abandonedDraft(
  timeline: FileTimeline,
  start: number,
  deletionIndex: number,
  end: number,
  hunk: LineHunk,
  functionName: string | undefined,
  opts: Required<MomentOptions>
): Draft | null {
  const block = normalizeBlock(hunk.oldLines);
  const { entries } = timeline;

  // When did this code appear? Walk back while it was continuously there.
  let born = start;
  while (born > 0 && timeline.contains(born - 1, block)) {
    born--;
  }
  const deletion = entries[deletionIndex];
  const lifetime = deletion.absoluteTime - entries[born].absoluteTime;
  if (lifetime < opts.abandonedMinLifetimeMs) {
    return null;
  }
  for (let later = end + 1; later < entries.length; later++) {
    if (timeline.contains(later, block)) {
      return null;
    }
  }

  const removed = nonBlank(hunk.oldLines);
  return {
    kind: 'abandoned-approach',
    sessionIndex: deletion.sessionIndex,
    at: deletion.snapshot.timestamp,
    filePath: timeline.filePath,
    functionName,
    summary: `${removed} lines in ${timeline.filePath}${inFunction(functionName)} were deleted after existing for ${formatDuration(lifetime)}, and never came back.`,
    before: excerpt(hunk.oldLines),
    evidence: {
      linesRemoved: removed,
      existedForMs: lifetime,
      firstSeenAt: entries[born].absoluteTime,
      linesChanged: removed
    },
    baseScore: KIND_SCORE['abandoned-approach']
  };
}

/**
 * The first appearance of each C function, and whether the edits inside it were
 * mostly typed or bulk inserted. Functions already in the file when it was first
 * seen without edits (starter code) are skipped: the student did not write them.
 */
function functionWrittenMoments(timeline: FileTimeline): Draft[] {
  if (!isCSource(timeline.filePath) || timeline.entries.length === 0) {
    return [];
  }
  const drafts: Draft[] = [];
  const seen = new Set<string>();
  const first = timeline.entries[0].snapshot;
  if (!first.edit) {
    timeline.functionsAt(0).forEach((fn) => seen.add(fn.name));
  }

  timeline.entries.forEach((entry, k) => {
    for (const fn of timeline.functionsAt(k)) {
      if (seen.has(fn.name)) {
        continue;
      }
      seen.add(fn.name);
      drafts.push(functionDraft(timeline, k, fn.name, entry));
    }
  });
  return drafts;
}

function functionDraft(timeline: FileTimeline, firstIndex: number, name: string, entry: TimelineEntry): Draft {
  let typed = 0;
  let bulk = 0;
  let lastIndex = firstIndex;
  for (let k = firstIndex; k < timeline.entries.length; k++) {
    const span = timeline.functionsAt(k).find((fn) => fn.name === name);
    if (!span) {
      continue;
    }
    lastIndex = k;
    const edit = timeline.entries[k].snapshot.edit;
    const hunks = timeline.diffAt(k);
    if (!edit || hunks.length === 0) {
      continue;
    }
    // Blank lines around a new function belong to no function, so only code lines decide.
    const insideFunction = hunks.every((h) => {
      const codeLines = h.newLines
        .map((line, offset) => (line.trim() === '' ? -1 : h.newStart + offset + 1))
        .filter((line) => line !== -1);
      const lines = codeLines.length > 0 ? codeLines : [h.newStart + 1];
      return lines.every((line) => line >= span.startLine && line <= span.endLine);
    });
    if (insideFunction) {
      typed += edit.typedChars;
      bulk += edit.bulkInsertedChars;
    }
  }

  const finalSpan = timeline.functionsAt(lastIndex).find((fn) => fn.name === name)!;
  const finalLines = timeline.linesAt(lastIndex).slice(finalSpan.startLine - 1, finalSpan.endLine);
  const classification =
    typed + bulk === 0 ? 'unclassified' : bulk > typed ? 'mostly bulk inserted' : 'mostly typed';
  const how =
    classification === 'unclassified'
      ? 'its edits were not classified'
      : `it was ${classification} (${typed} typed, ${bulk} bulk inserted characters)`;

  return {
    kind: 'function-written',
    sessionIndex: entry.sessionIndex,
    at: entry.snapshot.timestamp,
    filePath: timeline.filePath,
    functionName: name,
    summary: `${name}() first appeared in ${timeline.filePath}; ${how}.`,
    after: excerpt(finalLines),
    evidence: {
      classification,
      typedChars: typed,
      bulkInsertedChars: bulk,
      finalLineCount: nonBlank(finalLines),
      linesChanged: nonBlank(finalLines)
    },
    baseScore: KIND_SCORE['function-written'] + (classification === 'mostly bulk inserted' ? 1 : 0)
  };
}
