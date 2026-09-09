import { Session, Snapshot, RunEvent, SessionEvent } from '../models';

export interface ActivityBucket {
  bucketIndex: number;
  startTimeMs: number;
  endTimeMs: number;
  changeVolume: number;
  snapshotCount: number;
  runCount: number;
  label: string;
}

export interface LineHeatmapEntry {
  lineNumber: number; // 1-based line number
  text: string;
  editCount: number;
  intensity: number; // 0.0 to 1.0 relative to max edits
}

export interface FileAnalytics {
  filePath: string;
  initialLines: number;
  finalLines: number;
  netLines: number;
  totalSnapshots: number;
  estimatedKeystrokes: number;
  lineHeatmap: LineHeatmapEntry[];
}

export interface SessionAnalytics {
  sessionId: string;
  workspaceName: string;
  durationMs: number;
  formattedDuration: string;
  totalKeystrokes: number;
  netLinesWritten: number;
  totalSnapshots: number;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  passRate: number; // Percentage 0 - 100
  activityBuckets: ActivityBucket[]; // 24 buckets
  files: Record<string, FileAnalytics>;
  overallHeatmap: LineHeatmapEntry[];
  keyMoments: SessionEvent[];
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
 * Computes the total estimated keystrokes / character alterations across all files.
 */
export function computeTotalKeystrokes(session: Session): number {
  let total = 0;
  const fileSnapshots = groupSnapshotsByFile(session.snapshots);

  for (const snapshots of fileSnapshots.values()) {
    if (snapshots.length === 0) {
      continue;
    }

    // Initial snapshot contribution
    total += snapshots[0].content.length;

    // Subsequent snapshot diff estimations
    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1].content;
      const curr = snapshots[i].content;
      total += estimateCharEdits(prev, curr);
    }
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

      const editVol = i === 0 ? snap.content.length : estimateCharEdits(snapshots[i - 1].content, snap.content);
      buckets[bIndex].changeVolume += Math.max(1, editVol);
    }
  }

  // Factor in runs into activity buckets
  for (const run of session.runs) {
    const bIndex = Math.min(23, Math.max(0, Math.floor(run.timestamp / bucketDuration)));
    buckets[bIndex].runCount += 1;
    buckets[bIndex].changeVolume += 10; // Boost weight for execution runs
  }

  return buckets;
}

/**
 * Computes the line edit heatmap for a specific file or the primary file in the session.
 * Diffs sequential snapshots and maps line modifications to final file line indices.
 */
export function computeLineHeatmap(session: Session, targetFilePath?: string): LineHeatmapEntry[] {
  const fileSnapshots = groupSnapshotsByFile(session.snapshots);
  let filePath = targetFilePath;

  if (!filePath || !fileSnapshots.has(filePath)) {
    // Pick file with most snapshots
    let maxCount = -1;
    for (const [fPath, snpList] of fileSnapshots.entries()) {
      if (snpList.length > maxCount) {
        maxCount = snpList.length;
        filePath = fPath;
      }
    }
  }

  if (!filePath || !fileSnapshots.has(filePath)) {
    return [];
  }

  const snapshots = fileSnapshots.get(filePath)!;
  if (snapshots.length === 0) {
    return [];
  }

  const finalSnapshot = snapshots[snapshots.length - 1];
  const finalLines = finalSnapshot.content.split(/\r?\n/);
  const lineEditCounts = new Array(finalLines.length).fill(1); // Baseline: created = 1 edit

  // Diff consecutive snapshots
  for (let i = 1; i < snapshots.length; i++) {
    const prevLines = snapshots[i - 1].content.split(/\r?\n/);
    const currLines = snapshots[i].content.split(/\r?\n/);

    const modifiedIndices = diffLines(prevLines, currLines);

    // If this is the last step or near it, map directly; otherwise proportion to final line positions
    for (const lineIdx of modifiedIndices) {
      const mappedIdx = Math.min(
        finalLines.length - 1,
        Math.max(0, Math.floor((lineIdx / Math.max(currLines.length, 1)) * finalLines.length))
      );
      lineEditCounts[mappedIdx] = (lineEditCounts[mappedIdx] || 0) + 1;
    }
  }

  const maxEdits = Math.max(1, ...lineEditCounts);

  return finalLines.map((lineText, idx) => {
    const count = lineEditCounts[idx] || 1;
    return {
      lineNumber: idx + 1,
      text: lineText,
      editCount: count,
      intensity: Number((count / maxEdits).toFixed(2))
    };
  });
}

/**
 * Computes full, aggregated analytics for the entire session.
 */
export function computeSessionAnalytics(session: Session): SessionAnalytics {
  const durationMs = computeSessionDuration(session);
  const totalKeystrokes = computeTotalKeystrokes(session);
  const netLinesWritten = computeNetLinesWritten(session);
  const activityBuckets = compute24BucketActivity(session);

  const successfulRuns = session.runs.filter((r) => r.success).length;
  const failedRuns = session.runs.length - successfulRuns;
  const passRate = session.runs.length > 0 ? Math.round((successfulRuns / session.runs.length) * 100) : 100;

  const fileSnapshots = groupSnapshotsByFile(session.snapshots);
  const files: Record<string, FileAnalytics> = {};

  for (const [filePath, snapshots] of fileSnapshots.entries()) {
    const initialLines = countLines(snapshots[0]?.content || '');
    const finalLines = countLines(snapshots[snapshots.length - 1]?.content || '');
    let fileKeystrokes = snapshots[0]?.content.length || 0;
    for (let i = 1; i < snapshots.length; i++) {
      fileKeystrokes += estimateCharEdits(snapshots[i - 1].content, snapshots[i].content);
    }

    files[filePath] = {
      filePath,
      initialLines,
      finalLines,
      netLines: finalLines - initialLines,
      totalSnapshots: snapshots.length,
      estimatedKeystrokes: fileKeystrokes,
      lineHeatmap: computeLineHeatmap(session, filePath)
    };
  }

  const overallHeatmap = computeLineHeatmap(session);

  return {
    sessionId: session.id,
    workspaceName: session.workspaceName,
    durationMs,
    formattedDuration: formatDuration(durationMs),
    totalKeystrokes,
    netLinesWritten,
    totalSnapshots: session.snapshots.length,
    totalRuns: session.runs.length,
    successfulRuns,
    failedRuns,
    passRate,
    activityBuckets,
    files,
    overallHeatmap,
    keyMoments: session.events
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

/**
 * Line diff algorithm computing modified line numbers in currLines.
 */
function diffLines(prevLines: string[], currLines: string[]): number[] {
  const modifiedIndices: number[] = [];
  const prevSet = new Set(prevLines);

  for (let j = 0; j < currLines.length; j++) {
    const line = currLines[j];
    if (j >= prevLines.length || prevLines[j] !== line || !prevSet.has(line)) {
      modifiedIndices.push(j);
    }
  }

  return modifiedIndices;
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
