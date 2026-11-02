import { EditStats, Session, Snapshot } from '../models';

export interface ActivityBucket {
  bucketIndex: number;
  startTimeMs: number;
  endTimeMs: number;
  changeVolume: number;
  snapshotCount: number;
  runCount: number;
  label: string;
}

export interface FileAnalytics {
  filePath: string;
  initialLines: number;
  finalLines: number;
  netLines: number;
  totalSnapshots: number;
}

export interface SessionAnalytics {
  sessionId: string;
  workspaceName: string;
  durationMs: number;
  formattedDuration: string;
  /** Characters added by ordinary small edits. */
  typedChars: number;
  /** Characters added by single large edits: paste, autocomplete, formatting or undo. */
  bulkInsertedChars: number;
  deletedChars: number;
  /** Characters changed by edits with no classification (older recordings). */
  unclassifiedChars: number;
  /** Times a terminal was open whose commands could not be recorded. */
  unrecordedTerminals: number;
  /** Characters already in files before their first recorded edit. */
  preExistingChars: number;
  netLinesWritten: number;
  totalSnapshots: number;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  /** Runs whose result is not known, such as debug sessions. */
  unknownRuns: number;
  /** Percentage 0 - 100 of runs with a known result; null when none has one. */
  passRate: number | null;
  activityBuckets: ActivityBucket[]; // 24 buckets
  files: Record<string, FileAnalytics>;
}

/** True if `ms` falls in this bucket. Each time belongs to exactly one bucket. */
export function isInBucket(ms: number, bucket: ActivityBucket): boolean {
  const isLastBucket = bucket.bucketIndex === 23;
  return ms >= bucket.startTimeMs && (ms < bucket.endTimeMs || isLastBucket);
}

/**
 * Computes the total active session duration in milliseconds.
 */
export function computeSessionDuration(session: Session): number {
  if (session.endTime && session.endTime > session.startTime) {
    return session.endTime - session.startTime;
  }
  if (session.snapshots.length > 0) {
    return session.snapshots[session.snapshots.length - 1].timestamp;
  }
  if (session.events.length > 0) {
    return session.events[session.events.length - 1].timestamp;
  }
  return 0;
}

/**
 * Totals the characters added and removed by recorded edits. Opening or
 * switching to a file adds nothing here: its content counts as pre-existing.
 */
export function computeEditTotals(session: Session): EditStats {
  const totals: EditStats = { typedChars: 0, bulkInsertedChars: 0, deletedChars: 0 };
  for (const { edit } of session.snapshots) {
    if (edit) {
      totals.typedChars += edit.typedChars;
      totals.bulkInsertedChars += edit.bulkInsertedChars;
      totals.deletedChars += edit.deletedChars;
    }
  }
  return totals;
}

/**
 * Counts characters changed by edits that carry no edit data, as in recordings
 * made before edits were classified. The content shows they changed, but not
 * whether they were typed or inserted in bulk, so they are not guessed at.
 */
export function computeUnclassifiedChars(session: Session): number {
  let total = 0;
  for (const snapshots of groupSnapshotsByFile(session.snapshots).values()) {
    for (let i = 1; i < snapshots.length; i++) {
      if (!snapshots[i].edit) {
        total += estimateCharEdits(snapshots[i - 1].content, snapshots[i].content);
      }
    }
  }
  return total;
}

/**
 * Counts the characters each file held before its first recorded edit. The first
 * snapshot may already include edits, so those are taken back out.
 */
export function computePreExistingChars(session: Session): number {
  let total = 0;
  for (const snapshots of groupSnapshotsByFile(session.snapshots).values()) {
    const first = snapshots[0];
    const inserted = (first.edit?.typedChars ?? 0) + (first.edit?.bulkInsertedChars ?? 0);
    total += Math.max(0, first.content.length - inserted + (first.edit?.deletedChars ?? 0));
  }
  return total;
}

/**
 * Computes net lines written (final line count - initial line count) across all files.
 */
export function computeNetLinesWritten(session: Session): number {
  let netLines = 0;
  const fileSnapshots = groupSnapshotsByFile(session.snapshots);

  for (const snapshots of fileSnapshots.values()) {
    if (snapshots.length === 0) {
      continue;
    }
    const initialLines = countLines(snapshots[0].content);
    const finalLines = countLines(snapshots[snapshots.length - 1].content);
    netLines += finalLines - initialLines;
  }

  return netLines;
}

/**
 * Computes a 24-bucket activity timeline array representing volume of changes over time.
 */
export function compute24BucketActivity(session: Session): ActivityBucket[] {
  const totalDuration = Math.max(computeSessionDuration(session), 1000);
  const bucketDuration = totalDuration / 24;

  const buckets: ActivityBucket[] = Array.from({ length: 24 }, (_, i) => {
    const startMs = Math.round(i * bucketDuration);
    const endMs = Math.round((i + 1) * bucketDuration);
    return {
      bucketIndex: i,
      startTimeMs: startMs,
      endTimeMs: endMs,
      changeVolume: 0,
      snapshotCount: 0,
      runCount: 0,
      label: `${formatTime(startMs)} - ${formatTime(endMs)}`
    };
  });

  // Group snapshots by file to calculate sequential edit volume accurately
  const fileSnapshots = groupSnapshotsByFile(session.snapshots);
  for (const snapshots of fileSnapshots.values()) {
    for (let i = 0; i < snapshots.length; i++) {
      const snap = snapshots[i];
      const bIndex = Math.min(23, Math.max(0, Math.floor(snap.timestamp / bucketDuration)));
      buckets[bIndex].snapshotCount += 1;

      // A file's first snapshot has nothing to compare against, so only its
      // recorded edits count: content that was already there is not activity.
      buckets[bIndex].changeVolume +=
        i === 0
          ? (snap.edit?.typedChars ?? 0) + (snap.edit?.bulkInsertedChars ?? 0) + (snap.edit?.deletedChars ?? 0)
          : estimateCharEdits(snapshots[i - 1].content, snap.content);
    }
  }

  // Factor in runs into activity buckets
  for (const run of session.runs) {
    const bIndex = Math.min(23, Math.max(0, Math.floor(run.timestamp / bucketDuration)));
    buckets[bIndex].runCount += 1;
  }

  return buckets;
}

/**
 * Computes full, aggregated analytics for the entire session.
 */
export function computeSessionAnalytics(session: Session): SessionAnalytics {
  const durationMs = computeSessionDuration(session);
  const editTotals = computeEditTotals(session);
  const netLinesWritten = computeNetLinesWritten(session);
  const activityBuckets = compute24BucketActivity(session);

  const successfulRuns = session.runs.filter((r) => r.success === true).length;
  const failedRuns = session.runs.filter((r) => r.success === false).length;
  const unknownRuns = session.runs.length - successfulRuns - failedRuns;
  const knownRuns = successfulRuns + failedRuns;
  const passRate = knownRuns > 0 ? Math.round((successfulRuns / knownRuns) * 100) : null;

  const fileSnapshots = groupSnapshotsByFile(session.snapshots);
  const files: Record<string, FileAnalytics> = {};

  for (const [filePath, snapshots] of fileSnapshots.entries()) {
    const initialLines = countLines(snapshots[0]?.content || '');
    const finalLines = countLines(snapshots[snapshots.length - 1]?.content || '');

    files[filePath] = {
      filePath,
      initialLines,
      finalLines,
      netLines: finalLines - initialLines,
      totalSnapshots: snapshots.length
    };
  }

  return {
    sessionId: session.id,
    workspaceName: session.workspaceName,
    durationMs,
    formattedDuration: formatDuration(durationMs),
    ...editTotals,
    unclassifiedChars: computeUnclassifiedChars(session),
    unrecordedTerminals: session.events.filter((e) => e.type === 'terminal-unrecorded').length,
    preExistingChars: computePreExistingChars(session),
    netLinesWritten,
    totalSnapshots: session.snapshots.length,
    totalRuns: session.runs.length,
    successfulRuns,
    failedRuns,
    unknownRuns,
    passRate,
    activityBuckets,
    files
  };
}

// ---------------- Helper Functions ---------------- //

function groupSnapshotsByFile(snapshots: Snapshot[]): Map<string, Snapshot[]> {
  const map = new Map<string, Snapshot[]>();
  for (const s of snapshots) {
    const list = map.get(s.filePath) || [];
    list.push(s);
    map.set(s.filePath, list);
  }
  return map;
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r?\n/).length;
}

function estimateCharEdits(str1: string, str2: string): number {
  if (str1 === str2) return 0;
  const lenDiff = Math.abs(str1.length - str2.length);

  // Common prefix length
  let prefix = 0;
  const minLen = Math.min(str1.length, str2.length);
  while (prefix < minLen && str1[prefix] === str2[prefix]) {
    prefix++;
  }

  // Common suffix length
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    str1[str1.length - 1 - suffix] === str2[str2.length - 1 - suffix]
  ) {
    suffix++;
  }

  const edits = Math.max(str1.length - prefix - suffix, str2.length - prefix - suffix);
  return Math.max(lenDiff, edits);
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
