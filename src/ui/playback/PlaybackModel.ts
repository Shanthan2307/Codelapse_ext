import { Snapshot } from '../../models';

/**
 * Smooth playback model for the timelapse player.
 *
 * Recorded snapshots are discrete: each one is the full text of a file after a
 * debounced burst of typing. Showing them one after another makes whole blocks
 * of code pop into existence. This model reconstructs what happened *between*
 * two snapshots so the player can animate it like real typing:
 *
 *   1. Diff the previous version of the file against the new one (line-level
 *      LCS, then trimmed to the exact changed characters inside each block).
 *   2. Express the change as a list of edits measured in "units" of work
 *      (one unit = one typed character, or several deleted characters).
 *   3. Given any playhead time, render the edits partially applied.
 *
 * The model is pure (no React, no DOM), so it can be unit tested directly.
 */

/** A single contiguous replacement, positioned in the *old* text. */
export interface TextEdit {
  /** Character offset in the old text where the edit begins. */
  offset: number;
  /** Text removed from the old version (may be empty). */
  removed: string;
  /** Text inserted in its place (may be empty). */
  inserted: string;
}

/** What the player should display at one instant. */
export interface PlaybackFrame {
  /** Index of the last snapshot fully reached, or -1 before the first one. */
  snapshotIndex: number;
  filePath: string;
  content: string;
  cursorStart: number;
  cursorEnd: number;
  /** True while an edit is being animated (caret should stay solid). */
  isTyping: boolean;
}

/** Backspacing is animated faster than typing: this many chars per unit. */
export const DELETE_CHARS_PER_UNIT = 4;
/** Session time spent per unit at 1x speed (~18 typed chars per second). */
export const MS_PER_UNIT = 55;
/** Shortest typing animation, so tiny edits remain visible. */
export const MIN_TYPING_MS = 250;
/** Beyond this many DP cells the line diff falls back to a single block. */
const MAX_LCS_CELLS = 2_000_000;

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

/** Splits text into lines that keep their trailing "\n", so joining is lossless. */
function splitLinesKeepEnds(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      lines.push(text.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < text.length) {
    lines.push(text.slice(start));
  }
  return lines;
}

interface LineHunk {
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
}

/**
 * Longest-common-subsequence diff over lines. Returns the blocks of lines that
 * differ; everything between blocks is shared by both versions.
 * Time and memory are O(n * m), which is why callers trim common head/tail first.
 */
function lcsHunks(a: string[], b: string[]): LineHunk[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  // dp[i * width + j] = LCS length of a[i..] and b[j..]
  const dp = new Uint32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] =
        a[i] === b[j]
          ? dp[(i + 1) * width + j + 1] + 1
          : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }

  const hunks: LineHunk[] = [];
  let open: { aStart: number; bStart: number } | null = null;
  let i = 0;
  let j = 0;

  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      if (open) {
        hunks.push({ aStart: open.aStart, aEnd: i, bStart: open.bStart, bEnd: j });
        open = null;
      }
      i++;
      j++;
      continue;
    }

    if (!open) {
      open = { aStart: i, bStart: j };
    }
    // Follow whichever branch keeps the longest common subsequence.
    if (j < m && (i >= n || dp[i * width + j + 1] >= dp[(i + 1) * width + j])) {
      j++;
    } else {
      i++;
    }
  }

  if (open) {
    hunks.push({ aStart: open.aStart, aEnd: n, bStart: open.bStart, bEnd: m });
  }
  return hunks;
}

/** Shrinks a block replacement down to the characters that actually changed. */
function trimEdit(offset: number, oldStr: string, newStr: string): TextEdit | null {
  const maxPrefix = Math.min(oldStr.length, newStr.length);
  let prefix = 0;
  while (prefix < maxPrefix && oldStr[prefix] === newStr[prefix]) {
    prefix++;
  }

  const maxSuffix = maxPrefix - prefix;
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    oldStr[oldStr.length - 1 - suffix] === newStr[newStr.length - 1 - suffix]
  ) {
    suffix++;
  }

  const removed = oldStr.slice(prefix, oldStr.length - suffix);
  const inserted = newStr.slice(prefix, newStr.length - suffix);
  if (removed === '' && inserted === '') {
    return null;
  }
  return { offset: offset + prefix, removed, inserted };
}

/**
 * Computes the minimal ordered list of edits that turns oldText into newText.
 * Edits are sorted by offset and never overlap.
 */
export function computeEdits(oldText: string, newText: string): TextEdit[] {
  if (oldText === newText) {
    return [];
  }

  const a = splitLinesKeepEnds(oldText);
  const b = splitLinesKeepEnds(newText);

  // Trimming identical leading/trailing lines first keeps the LCS table tiny
  // for the common case of a localized edit in a large file.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) {
    head++;
  }
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }

  const aMid = a.slice(head, a.length - tail);
  const bMid = b.slice(head, b.length - tail);

  let charPos = 0;
  for (let i = 0; i < head; i++) {
    charPos += a[i].length;
  }

  const hunks =
    aMid.length === 0 || bMid.length === 0 || aMid.length * bMid.length > MAX_LCS_CELLS
      ? [{ aStart: 0, aEnd: aMid.length, bStart: 0, bEnd: bMid.length }]
      : lcsHunks(aMid, bMid);

  const edits: TextEdit[] = [];
  let aCursor = 0;
  for (const hunk of hunks) {
    for (; aCursor < hunk.aStart; aCursor++) {
      charPos += aMid[aCursor].length;
    }
    const oldStr = aMid.slice(hunk.aStart, hunk.aEnd).join('');
    const newStr = bMid.slice(hunk.bStart, hunk.bEnd).join('');
    const edit = trimEdit(charPos, oldStr, newStr);
    if (edit) {
      edits.push(edit);
    }
    charPos += oldStr.length;
    aCursor = hunk.aEnd;
  }

  return edits;
}

// ---------------------------------------------------------------------------
// Partial rendering
// ---------------------------------------------------------------------------

/**
 * Number of visible typing steps for an insertion. A trailing newline is shown
 * up front (like pressing Enter before typing a new line), so the code below
 * the insertion point never gets glued onto the half-typed line.
 */
function typingLength(inserted: string): number {
  return inserted.endsWith('\n') ? inserted.length - 1 : inserted.length;
}

function deletionUnits(removed: string): number {
  return Math.ceil(removed.length / DELETE_CHARS_PER_UNIT);
}

/** Total animation work for a list of edits. */
export function editUnits(edits: TextEdit[]): number {
  let total = 0;
  for (const edit of edits) {
    total += deletionUnits(edit.removed) + typingLength(edit.inserted);
  }
  return total;
}

/** The first `typed` characters of an insertion; caretBack excludes a pre-shown "\n". */
function partialInsert(inserted: string, typed: number): { text: string; caretBack: number } {
  if (inserted.endsWith('\n')) {
    return { text: inserted.slice(0, Math.min(typed, inserted.length - 1)) + '\n', caretBack: 1 };
  }
  return { text: inserted.slice(0, typed), caretBack: 0 };
}

/** What remains of `removed` after backspacing `deleted` characters from its end. */
function partialRemove(removed: string, deleted: number): { text: string; caretBack: number } {
  if (deleted >= removed.length) {
    return { text: '', caretBack: 0 };
  }
  if (removed.endsWith('\n')) {
    // Keep the line break until the very end so following lines don't jump up.
    const body = removed.slice(0, -1);
    return { text: body.slice(0, Math.max(0, body.length - deleted)) + '\n', caretBack: 1 };
  }
  return { text: removed.slice(0, removed.length - deleted), caretBack: 0 };
}

/**
 * Renders oldText with the first `units` of work applied: edits are processed
 * top to bottom, each one backspacing its removed text and then typing its
 * inserted text. Returns the visible text and the caret offset within it.
 */
export function renderPartial(
  oldText: string,
  edits: TextEdit[],
  units: number
): { text: string; cursor: number } {
  let out = '';
  let pos = 0;
  let remaining = Math.max(0, units);
  let cursor = 0;

  for (const edit of edits) {
    out += oldText.slice(pos, edit.offset);
    pos = edit.offset + edit.removed.length;

    const delUnits = deletionUnits(edit.removed);
    const insUnits = typingLength(edit.inserted);

    if (remaining >= delUnits + insUnits) {
      out += edit.inserted;
      cursor = out.length;
      remaining -= delUnits + insUnits;
      continue;
    }

    const partial =
      remaining >= delUnits
        ? partialInsert(edit.inserted, Math.floor(remaining - delUnits))
        : partialRemove(edit.removed, Math.floor(remaining * DELETE_CHARS_PER_UNIT));

    out += partial.text;
    cursor = out.length - partial.caretBack;
    // Edits after the active one have not started yet: keep the old text.
    return { text: out + oldText.slice(pos), cursor };
  }

  return { text: out + oldText.slice(pos), cursor };
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

interface PlaybackStep {
  /** Content of the same file just before this snapshot. */
  previousContent: string;
  edits: TextEdit[];
  units: number;
  /** Session time at which the typing animation for this snapshot begins. */
  typingStart: number;
}

/**
 * Maps any playhead time to a renderable frame.
 *
 * The gap before each snapshot is split in two: an idle part (the previous
 * snapshot is shown as-is) followed by a typing window that ends exactly at
 * the snapshot's timestamp. Typing windows never overlap the previous
 * snapshot, so stepping onto any snapshot timestamp shows its exact content.
 */
export class PlaybackModel {
  /** Snapshots in chronological order. */
  public readonly snapshots: Snapshot[];
  public readonly durationMs: number;
  private readonly steps: PlaybackStep[];
  private readonly timestamps: number[];

  constructor(snapshots: Snapshot[], totalDurationMs?: number) {
    const isSorted = snapshots.every((s, i) => i === 0 || snapshots[i - 1].timestamp <= s.timestamp);
    this.snapshots = isSorted ? snapshots : [...snapshots].sort((a, b) => a.timestamp - b.timestamp);
    this.timestamps = this.snapshots.map((s) => s.timestamp);

    const lastContentByFile = new Map<string, string>();
    let previousTime = 0;

    this.steps = this.snapshots.map((snap) => {
      const content = snap.content ?? '';
      const previousContent = lastContentByFile.get(snap.filePath) ?? '';
      lastContentByFile.set(snap.filePath, content);

      const edits = computeEdits(previousContent, content);
      const units = editUnits(edits);
      const gap = Math.max(0, snap.timestamp - previousTime);
      previousTime = Math.max(previousTime, snap.timestamp);

      // Type at a natural pace, but never start before the previous snapshot.
      const typingMs = units === 0 ? 0 : Math.min(gap, Math.max(MIN_TYPING_MS, units * MS_PER_UNIT));

      return { previousContent, edits, units, typingStart: snap.timestamp - typingMs };
    });

    const lastTimestamp = this.timestamps[this.timestamps.length - 1] ?? 0;
    this.durationMs = Math.max(lastTimestamp, totalDurationMs ?? 0);
  }

  /** Frame to display at the given session time, or null when nothing was recorded. */
  public frameAt(ms: number): PlaybackFrame | null {
    const count = this.snapshots.length;
    if (count === 0) {
      return null;
    }

    const next = this.firstIndexAfter(ms);
    if (next >= count) {
      return this.exactFrame(count - 1);
    }

    const step = this.steps[next];
    const snap = this.snapshots[next];

    // Strictly after typingStart: a window that fills its whole gap starts on the
    // previous snapshot's timestamp, and that instant must show it exactly.
    if (ms > step.typingStart && snap.timestamp > step.typingStart) {
      const progress = (ms - step.typingStart) / (snap.timestamp - step.typingStart);
      const { text, cursor } = renderPartial(step.previousContent, step.edits, progress * step.units);
      return {
        snapshotIndex: next - 1,
        filePath: snap.filePath,
        content: text,
        cursorStart: cursor,
        cursorEnd: cursor,
        isTyping: true
      };
    }

    if (next === 0) {
      return {
        snapshotIndex: -1,
        filePath: snap.filePath,
        content: step.previousContent,
        cursorStart: 0,
        cursorEnd: 0,
        isTyping: false
      };
    }

    return this.exactFrame(next - 1);
  }

  /**
   * Length of the idle stretch containing `ms` (nothing being typed), or 0
   * while typing. The player uses this to glide quickly across idle gaps.
   */
  public idleSpanAt(ms: number): number {
    const count = this.snapshots.length;
    if (count === 0) {
      return this.durationMs;
    }

    const next = this.firstIndexAfter(ms);
    if (next >= count) {
      return Math.max(0, this.durationMs - this.timestamps[count - 1]);
    }

    const idleStart = next === 0 ? 0 : this.timestamps[next - 1];
    const idleEnd = this.steps[next].typingStart;
    return ms < idleEnd ? Math.max(0, idleEnd - idleStart) : 0;
  }

  /** Latest snapshot time strictly before `ms`, or 0. */
  public previousBoundary(ms: number): number {
    const idx = this.firstIndexAtOrAfter(ms) - 1;
    return idx >= 0 ? this.timestamps[idx] : 0;
  }

  /** Earliest snapshot time strictly after `ms`, or the end of the session. */
  public nextBoundary(ms: number): number {
    const idx = this.firstIndexAfter(ms);
    return idx < this.timestamps.length ? this.timestamps[idx] : this.durationMs;
  }

  /** Time of the first snapshot of `filePath`, or null if it never appears. */
  public firstTimeOf(filePath: string): number | null {
    const snap = this.snapshots.find((s) => s.filePath === filePath);
    return snap ? snap.timestamp : null;
  }

  private exactFrame(index: number): PlaybackFrame {
    const snap = this.snapshots[index];
    return {
      snapshotIndex: index,
      filePath: snap.filePath,
      content: snap.content ?? '',
      cursorStart: snap.cursorStart ?? 0,
      cursorEnd: snap.cursorEnd ?? snap.cursorStart ?? 0,
      isTyping: false
    };
  }

  /** Binary search: first index whose timestamp is > ms. */
  private firstIndexAfter(ms: number): number {
    let lo = 0;
    let hi = this.timestamps.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.timestamps[mid] <= ms) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }

  /** Binary search: first index whose timestamp is >= ms. */
  private firstIndexAtOrAfter(ms: number): number {
    let lo = 0;
    let hi = this.timestamps.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.timestamps[mid] < ms) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo;
  }
}
