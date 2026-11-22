import { Session, Snapshot } from './models';

/**
 * Signs of AI use, read from how the code was written rather than only from
 * what it looks like. No AI is involved: plain rules over the recording.
 *
 * Nothing here proves anything. Each signal says what was seen and why it can
 * point to AI use, and how strongly; the instructor decides. Ordinary reasons
 * exist for every signal (a student who plans on paper and types top to
 * bottom, a formatter, a snippet from the lecture notes), which is why the
 * evidence is shown with each one.
 *
 * Two ways of using AI are looked for:
 * - pasting: the code arrives in large single edits, often after a pause away
 *   from the editor, or was already in the file before recording started;
 * - transcribing: the code is typed, but straight from top to bottom with
 *   almost no corrections, no failed builds and no going back, in a style
 *   typical of chat assistants.
 */

export const AUTHORSHIP_VERSION = 'authorship-v1';

export type SignalStrength = 'weak' | 'moderate' | 'strong';

export type AuthorshipSignalKind =
  | 'pasted-code'
  | 'code-from-outside'
  | 'away-then-paste'
  | 'transcribed'
  | 'straight-through'
  | 'few-corrections'
  | 'no-debugging'
  | 'fast-for-size'
  | 'ai-style';

export interface AuthorshipSignal {
  kind: AuthorshipSignalKind;
  strength: SignalStrength;
  /** Short title for the instructor. */
  title: string;
  /** What was seen, in one or two plain sentences. */
  detail: string;
  /** Ordinary explanations to rule out before reading it as AI use. */
  otherExplanations: string;
  evidence: Record<string, number | string | string[]>;
}

/**
 * Where each line of the final code came from, one letter per line:
 * t typed, p pasted (one large edit), o from outside the recording (already in
 * the file, or changed while not recording), - blank or too short to tell.
 */
export type LineOrigin = 't' | 'p' | 'o' | '-';

export interface FileOrigins {
  path: string;
  origins: string;
}

export type AuthorshipLevel = 'low' | 'some' | 'high';

export interface AuthorshipReport {
  version: typeof AUTHORSHIP_VERSION;
  /** low: few or no signs; some: worth a look; high: strong signs of AI use. */
  level: AuthorshipLevel;
  /** Sum of signal weights (weak 1, moderate 3, strong 6); for sorting, not a probability. */
  points: number;
  signals: AuthorshipSignal[];
  /** Lines of the final code by origin; blank and trivial lines are not counted. */
  lines: { typed: number; pasted: number; outside: number };
  files: FileOrigins[];
  /** Minutes with editing activity (gaps over two minutes are not counted). */
  activeMinutes: number;
}

export interface AuthorshipInput {
  sessions: Session[];
  /** The submitted code, under the paths it has in the recording. */
  submitted: { path: string; content: string }[];
  language: 'c' | 'python' | 'java';
}

export interface AuthorshipOptions {
  /** A pause at least this long before a bulk insert reads as "away, then pasted". */
  awayMs?: number;
  /** Bulk inserts smaller than this are not counted as away-then-paste. */
  awayPasteMinChars?: number;
  /** Gaps between edits longer than this do not count as active time. */
  activeGapCapMs?: number;
}

const DEFAULTS: Required<AuthorshipOptions> = {
  awayMs: 20_000,
  awayPasteMinChars: 80,
  activeGapCapMs: 2 * 60_000
};

const WEIGHT: Record<SignalStrength, number> = { weak: 1, moderate: 3, strong: 6 };

/** Lines this short after removing whitespace ("}", "else {") say nothing about who wrote them. */
const MIN_LINE_KEY = 4;

const lineKey = (line: string) => line.replace(/\s+/g, '');

interface TimedSnapshot {
  snap: Snapshot;
  /** Epoch ms. */
  at: number;
  sessionIndex: number;
}

/** A line of the final code, and when and how it first appeared in the recording. */
interface TrackedLine {
  file: string;
  index: number;
  key: string;
  origin: LineOrigin;
  firstAt?: number;
}

export function analyzeAuthorship(input: AuthorshipInput, options: AuthorshipOptions = {}): AuthorshipReport {
  const opts = { ...DEFAULTS, ...options };
  const sessions = [...input.sessions].sort((a, b) => a.startTime - b.startTime || a.id.localeCompare(b.id));
  const timeline: TimedSnapshot[] = sessions
    .flatMap((session, sessionIndex) =>
      session.snapshots.map((snap) => ({ snap, at: session.startTime + snap.timestamp, sessionIndex }))
    )
    .sort((a, b) => a.at - b.at);

  const submittedPaths = new Set(input.submitted.map((f) => f.path));
  const tracked = traceLines(input.submitted, timeline.filter((t) => submittedPaths.has(t.snap.filePath)));

  const counted = tracked.filter((l) => l.origin !== '-');
  const lines = {
    typed: counted.filter((l) => l.origin === 't').length,
    pasted: counted.filter((l) => l.origin === 'p').length,
    outside: counted.filter((l) => l.origin === 'o').length
  };
  const total = counted.length;

  const edits = editTotals(timeline.filter((t) => submittedPaths.has(t.snap.filePath)));
  const activeMinutes = activeTime(timeline, opts.activeGapCapMs) / 60_000;
  const runs = sessions.flatMap((s) => s.runs);
  const failedRuns = runs.filter((r) => r.success === false).length;

  const signals: AuthorshipSignal[] = [];
  const share = (n: number) => (total > 0 ? n / total : 0);
  const pct = (x: number) => `${Math.round(x * 100)}%`;

  // ---- Pasted code
  const pastedShare = share(lines.pasted);
  if (lines.pasted >= 3 && pastedShare >= 0.1) {
    const strength: SignalStrength = pastedShare >= 0.5 ? 'strong' : pastedShare >= 0.25 ? 'moderate' : 'weak';
    signals.push({
      kind: 'pasted-code',
      strength,
      title: `${pct(pastedShare)} of the final code arrived in large single edits`,
      detail: `${lines.pasted} of ${total} lines first appeared through one edit adding many characters at once, the way pasted code does. The largest single edit added ${edits.largestBulk} characters.`,
      otherExplanations:
        'Autocomplete snippets, a formatter rewriting the file, or code moved between files with cut and paste also arrive in one edit. AI code assistants in the editor (such as Copilot) also show up here.',
      evidence: { pastedLines: lines.pasted, countedLines: total, largestBulkInsertChars: edits.largestBulk }
    });
  }

  // ---- Code that was never written while recording
  const outsideShare = share(lines.outside);
  if (lines.outside >= 3 && outsideShare >= 0.1) {
    const strength: SignalStrength = outsideShare >= 0.5 ? 'strong' : outsideShare >= 0.2 ? 'moderate' : 'weak';
    signals.push({
      kind: 'code-from-outside',
      strength,
      title: `${pct(outsideShare)} of the final code was never written while recording`,
      detail: `${lines.outside} of ${total} lines were already in the file when recording started, changed while recording was off, or are not in the recording at all.`,
      otherExplanations:
        'Starter code handed out with the assignment, or work done before the student installed the extension. Check whether the assignment gave starter code.',
      evidence: { outsideLines: lines.outside, countedLines: total }
    });
  }

  // ---- A pause away from the editor, then a paste
  const awayPastes = awayThenPaste(timeline, submittedPaths, opts);
  if (awayPastes.length > 0) {
    signals.push({
      kind: 'away-then-paste',
      strength: awayPastes.length >= 2 ? 'strong' : 'moderate',
      title: `${awayPastes.length === 1 ? 'Once' : `${awayPastes.length} times`}, nothing happened in the editor and then a block of code arrived at once`,
      detail: awayPastes
        .slice(0, 3)
        .map((p) => `${Math.round(p.pauseMs / 1000)} s with no activity, then ${p.chars} characters added to ${p.file} in one edit.`)
        .join(' '),
      otherExplanations: 'Copying from the student\'s own earlier work, or from lecture notes, looks the same.',
      evidence: {
        pauses: awayPastes.map((p) => `${p.file}: ${Math.round(p.pauseMs / 1000)} s then ${p.chars} chars`)
      }
    });
  }

  // ---- Typed, but as if copied from another screen
  const typedLines = tracked.filter((l) => l.origin === 't');
  const order = straightThroughRatio(typedLines);
  const correctionRatio = edits.typed > 0 ? edits.deleted / edits.typed : 0;
  const mostlyTyped = total >= 15 && lines.typed / total >= 0.6;
  const straight = mostlyTyped && typedLines.length >= 15 && order >= 0.95;
  const fewCorrections = mostlyTyped && edits.typed >= 400 && correctionRatio < 0.05;
  const noDebugging = total >= 15 && failedRuns === 0;
  const style = styleTells(input.submitted, input.language);

  if (straight && fewCorrections && noDebugging) {
    // Together these are the pattern of copying by hand.
    signals.push({
      kind: 'transcribed',
      strength: style.length >= 2 ? 'strong' : 'moderate',
      title: 'Typed straight through, with almost no corrections and no failed runs',
      detail:
        `The code was typed from top to bottom (${pct(order)} of lines in final order), only ${pct(correctionRatio)} as many characters were deleted as typed, and no build or run failed. ` +
        'People writing their own code usually jump back to earlier lines, fix mistakes and hit errors; someone copying from another screen does not.',
      otherExplanations: 'A student who worked the solution out on paper first, or who is retyping their own earlier attempt.',
      evidence: { inOrderShare: round2(order), deletedPerTyped: round2(correctionRatio), failedRuns }
    });
  } else {
    if (straight) {
      signals.push({
        kind: 'straight-through',
        strength: 'weak',
        title: 'Written straight from top to bottom',
        detail: `${pct(order)} of the typed lines appeared in the same order as in the final file: the student hardly ever went back to add or change earlier code.`,
        otherExplanations: 'Small programs are often written in order, especially with a plan made beforehand.',
        evidence: { inOrderShare: round2(order), typedLines: typedLines.length }
      });
    }
    if (fewCorrections) {
      signals.push({
        kind: 'few-corrections',
        strength: 'weak',
        title: 'Almost no corrections while typing',
        detail: `Only ${edits.deleted} characters were deleted against ${edits.typed} typed (${pct(correctionRatio)}). People writing new code usually delete far more.`,
        otherExplanations: 'An experienced, careful typist.',
        evidence: { typedChars: edits.typed, deletedChars: edits.deleted }
      });
    }
  }

  // ---- Never debugged
  if (total >= 15 && !signals.some((s) => s.kind === 'transcribed')) {
    if (runs.length === 0) {
      signals.push({
        kind: 'no-debugging',
        strength: 'weak',
        title: 'The code was never run while recording',
        detail: 'No build or run was recorded, so there is no trace of the code being tried out.',
        otherExplanations: 'Runs from a terminal the extension cannot read (see the recording summary), or from outside VS Code.',
        evidence: { runs: 0 }
      });
    } else if (failedRuns === 0 && lines.typed + lines.pasted >= 30) {
      signals.push({
        kind: 'no-debugging',
        strength: 'weak',
        title: 'Every run worked first time',
        detail: `${runs.length} run${runs.length === 1 ? '' : 's'}, none failed, for ${total} lines of code.`,
        otherExplanations: 'A strong student, or a simple assignment.',
        evidence: { runs: runs.length, failedRuns: 0 }
      });
    }
  }

  // ---- Typed faster than people write new code (pasting is covered above)
  if (lines.typed >= 20 && activeMinutes > 0 && lines.typed / activeMinutes > 8) {
    const rate = lines.typed / activeMinutes;
    signals.push({
      kind: 'fast-for-size',
      strength: rate > 20 ? 'moderate' : 'weak',
      title: `About ${Math.round(rate)} typed lines per minute of activity`,
      detail: `${lines.typed} lines were typed in ${activeMinutes.toFixed(1)} minutes of editing. Students writing their own solution usually manage a few lines a minute, with pauses to think.`,
      otherExplanations: 'An experienced programmer, or a solution planned before recording.',
      evidence: { typedLines: lines.typed, activeMinutes: round2(activeMinutes) }
    });
  }

  // ---- Style typical of chat assistants
  if (style.length >= 2 || style.some((t) => t.strong)) {
    const strongTell = style.some((t) => t.strong);
    signals.push({
      kind: 'ai-style',
      strength: strongTell || style.length >= 4 ? 'moderate' : 'weak',
      title: 'Style typical of AI chat assistants',
      detail: `The code shows: ${style.map((t) => t.label).join('; ')}.`,
      otherExplanations: 'Some students write this way, and some of these habits are taught. Style alone is weak evidence; it matters most next to the signals above.',
      evidence: { tells: style.map((t) => t.label) }
    });
  }

  const points = signals.reduce((sum, s) => sum + WEIGHT[s.strength], 0);
  const level: AuthorshipLevel = signals.some((s) => s.strength === 'strong') || points >= 7 ? 'high' : points >= 3 ? 'some' : 'low';
  const order2: Record<SignalStrength, number> = { strong: 0, moderate: 1, weak: 2 };
  signals.sort((a, b) => order2[a.strength] - order2[b.strength]);

  const files = input.submitted.map((f) => ({
    path: f.path,
    origins: tracked
      .filter((l) => l.file === f.path)
      .map((l) => l.origin)
      .join('')
  }));

  return { version: AUTHORSHIP_VERSION, level, points, signals, lines, files, activeMinutes: round2(activeMinutes) };
}

// ------------------------------------------------------------------ line origins

/**
 * Follows each line of the final code back to the first snapshot that held it
 * (ignoring whitespace, so reindenting or a formatter does not move it), and
 * classifies that snapshot's edit: mostly bulk inserted is pasted, otherwise
 * typed. A line in a file's first snapshot that the snapshot's own edits do
 * not account for, or in a snapshot with no recorded edit, came from outside.
 */
function traceLines(submitted: AuthorshipInput['submitted'], timeline: TimedSnapshot[]): TrackedLine[] {
  const tracked: TrackedLine[] = [];
  const pending = new Map<string, Map<string, TrackedLine[]>>();
  for (const file of submitted) {
    const byKey = new Map<string, TrackedLine[]>();
    file.content.split(/\r?\n/).forEach((text, index) => {
      const key = lineKey(text);
      const line: TrackedLine = { file: file.path, index, key, origin: key.length < MIN_LINE_KEY ? '-' : 'o' };
      tracked.push(line);
      if (line.origin === '-') return;
      byKey.set(key, [...(byKey.get(key) ?? []), line]);
    });
    pending.set(file.path, byKey);
  }

  // Recordings from before edits were classified have no edit data: their changes cannot be told apart.
  const classified = timeline.some((t) => t.snap.edit);
  const previous = new Map<string, string>();
  const seenCounts = new Map<string, Map<string, number>>();
  for (const { snap, at } of timeline) {
    const byKey = pending.get(snap.filePath);
    if (!byKey) continue;
    const prior = previous.get(snap.filePath);
    previous.set(snap.filePath, snap.content);
    if (prior === snap.content) continue;

    const inserted = (snap.edit?.typedChars ?? 0) + (snap.edit?.bulkInsertedChars ?? 0);
    let origin: LineOrigin;
    if (!classified) {
      origin = prior === undefined ? 'o' : 't';
    } else if (!snap.edit || inserted === 0) {
      // Content changed with no recorded edit: written while not recording.
      origin = 'o';
    } else if (prior === undefined && inserted < snap.content.length * 0.5) {
      // First sight of the file, mostly already there.
      origin = 'o';
    } else {
      origin = snap.edit.bulkInsertedChars >= snap.edit.typedChars ? 'p' : 't';
    }

    // A line that appears twice in the final file is matched by its occurrences in order.
    const counts = new Map<string, number>();
    for (const text of snap.content.split(/\r?\n/)) {
      const key = lineKey(text);
      if (byKey.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const seen = seenCounts.get(snap.filePath) ?? new Map<string, number>();
    seenCounts.set(snap.filePath, seen);
    for (const [key, count] of counts) {
      const lines = byKey.get(key)!;
      const already = seen.get(key) ?? 0;
      for (let i = already; i < Math.min(count, lines.length); i++) {
        lines[i].origin = origin;
        lines[i].firstAt = at;
      }
      if (count > already) seen.set(key, Math.min(count, lines.length));
      if ((seen.get(key) ?? 0) >= lines.length) byKey.delete(key);
    }
  }
  // Lines never seen in the recording stay 'o'.
  return tracked;
}

/**
 * Share of typed lines that appeared in final-file order: the longest run of
 * lines whose first appearance is in increasing line order, over all typed
 * lines, per file.
 */
function straightThroughRatio(lines: TrackedLine[]): number {
  if (lines.length === 0) return 0;
  let inOrder = 0;
  const files = new Set(lines.map((l) => l.file));
  for (const file of files) {
    const seq = lines
      .filter((l) => l.file === file && l.firstAt !== undefined)
      .sort((a, b) => a.firstAt! - b.firstAt! || a.index - b.index)
      .map((l) => l.index);
    inOrder += longestIncreasing(seq);
  }
  return inOrder / lines.length;
}

function longestIncreasing(seq: number[]): number {
  const tails: number[] = [];
  for (const x of seq) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = x;
  }
  return tails.length;
}

// ------------------------------------------------------------------ timing

function editTotals(timeline: TimedSnapshot[]): { typed: number; deleted: number; largestBulk: number } {
  let typed = 0;
  let deleted = 0;
  let largestBulk = 0;
  for (const { snap } of timeline) {
    if (!snap.edit) continue;
    typed += snap.edit.typedChars;
    deleted += snap.edit.deletedChars;
    largestBulk = Math.max(largestBulk, snap.edit.bulkInsertedChars);
  }
  return { typed, deleted, largestBulk };
}

/** Time with editing activity: gaps between snapshots, each capped, within each session. */
function activeTime(timeline: TimedSnapshot[], capMs: number): number {
  let total = 0;
  for (let i = 1; i < timeline.length; i++) {
    if (timeline[i].sessionIndex !== timeline[i - 1].sessionIndex) continue;
    total += Math.min(capMs, timeline[i].at - timeline[i - 1].at);
  }
  return total;
}

function awayThenPaste(
  timeline: TimedSnapshot[],
  paths: Set<string>,
  opts: Required<AuthorshipOptions>
): { file: string; pauseMs: number; chars: number }[] {
  const found: { file: string; pauseMs: number; chars: number }[] = [];
  for (let i = 0; i < timeline.length; i++) {
    const { snap, at, sessionIndex } = timeline[i];
    const bulk = snap.edit?.bulkInsertedChars ?? 0;
    if (!paths.has(snap.filePath) || bulk < opts.awayPasteMinChars) continue;
    // The pause before the edit; a session's first edit counts from the session start.
    const prev = i > 0 && timeline[i - 1].sessionIndex === sessionIndex ? timeline[i - 1].at : at - snap.timestamp;
    const pauseMs = at - prev;
    if (pauseMs >= opts.awayMs) found.push({ file: snap.filePath, pauseMs, chars: bulk });
  }
  return found;
}

// ------------------------------------------------------------------ style

interface StyleTell {
  label: string;
  /** Strong tells are hard to explain other than by copying from a chat. */
  strong?: boolean;
}

/**
 * Habits common in code from chat assistants and uncommon in beginners' code.
 * Each is weak on its own.
 */
export function styleTells(files: { path: string; content: string }[], language: 'c' | 'python' | 'java'): StyleTell[] {
  const code = files.map((f) => f.content).join('\n');
  const tells: StyleTell[] = [];
  const add = (label: string, strong = false) => tells.push({ label, strong });

  if (/```|^\s*(#|\/\/)\s*(Here(?:'s| is)|Sure[,!]|Certainly|I've|I have (?:added|updated|fixed))/im.test(code)) {
    add('text left over from a chat reply (a ``` fence or "Here\'s…")', true);
  }
  if (/[—–“”‘’→…✓✅]/.test(code)) {
    add('typographic characters such as —, “ ” or → that keyboards do not type', true);
  }
  if (/(#|\/\/|\*)\s*(Example usage|Usage example|Test the function|Test cases?:|Driver code|Main function to test)/i.test(code)) {
    add('a comment such as "Example usage" or "Test the function"');
  }
  if (/(#|\/\/|\*)\s*(Time|Space) complexity|O\((n|1|log n|n\^?2)\)/i.test(code)) {
    add('a note on time or space complexity');
  }
  if (/(#|\/\/|\*)\s*(Edge case|Handle (the )?edge|Helper function)/i.test(code)) {
    add('comments such as "Edge case" or "Helper function"');
  }

  const lines = code.split(/\r?\n/).filter((l) => l.trim() !== '');
  const commentRe = language === 'python' ? /^\s*#/ : /^\s*(\/\/|\/\*|\*)/;
  const commentLines = lines.filter((l) => commentRe.test(l)).length;
  if (lines.length >= 15 && commentLines / lines.length >= 0.25) {
    add(`a comment on ${Math.round((commentLines / lines.length) * 100)}% of lines, explaining each step`);
  }

  if (language === 'python') {
    const defs = (code.match(/^\s*def\s+\w+\s*\(/gm) ?? []).length;
    const docstrings = (code.match(/^\s*def\s+[^\n]*:\s*\n\s*("""|''')/gm) ?? []).length;
    if (defs >= 2 && docstrings === defs) add('a docstring on every function');
    if (/"""[\s\S]*?\b(Args|Parameters|Returns|Raises):/.test(code)) add('docstrings with Args/Returns sections');
    const hinted = (code.match(/^\s*def\s+\w+\s*\([^)]*:\s*\w[^)]*\)\s*->/gm) ?? []).length;
    if (defs >= 2 && hinted === defs) add('type hints on every function');
    if (/^from typing import|^import typing/m.test(code)) add('imports from typing');
  } else if (language === 'java') {
    if (/@(param|return|throws)\b/.test(code)) add('Javadoc @param / @return comments');
    const methods = (code.match(/^\s*(public|private|protected)\s+(static\s+)?[\w<>\[\]]+\s+\w+\s*\(/gm) ?? []).length;
    const javadocs = (code.match(/\*\/\s*\n\s*(public|private|protected)\s/g) ?? []).length;
    if (methods >= 2 && javadocs >= methods) add('a Javadoc comment on every method');
    if (/\bfinal\s+\w+\s+\w+\s*=/.test(code) && /\bfinal\b[^\n]*\bfinal\b/s.test(code)) add('final on local variables throughout');
  } else {
    if (/#include\s*<stdbool\.h>/.test(code)) add('#include <stdbool.h>');
    if (/\bEXIT_(SUCCESS|FAILURE)\b/.test(code)) add('EXIT_SUCCESS / EXIT_FAILURE');
    if (/@(param|return|brief)\b/.test(code)) add('Doxygen-style @param / @return comments');
    if (/fprintf\s*\(\s*stderr/.test(code)) add('error messages to stderr');
  }
  return tells;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
