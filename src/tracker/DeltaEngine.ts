import { Snapshot } from '../models';

/**
 * Represents a single atomic character/range modification within a file.
 * Matches VS Code's TextDocumentContentChangeEvent structure for zero-copy efficiency.
 */
export interface TextChange {
  /** Character index where modification begins */
  rangeOffset: number;
  /** Number of characters deleted (0 for pure insertion) */
  rangeLength: number;
  /** Text inserted at rangeOffset (empty string for pure deletion) */
  text: string;
}

/**
 * Hybrid snapshot supporting both Keyframes (I-Frames) and Delta patches (P-Frames).
 */
export interface DeltaSnapshot {
  /** Milliseconds elapsed since session start */
  timestamp: number;
  /** Workspace-relative file path */
  filePath: string;
  /** True if this snapshot contains full file content baseline */
  isKeyframe: boolean;
  /** Full content (populated only when isKeyframe is true) */
  content?: string;
  /** Atomic diff changes (populated when isKeyframe is false) */
  changes?: TextChange[];
  /** Cursor selection character start offset */
  cursorStart: number;
  /** Cursor selection character end offset */
  cursorEnd: number;
}

export class DeltaEngine {
  /**
   * Applies a single atomic change to a content string.
   */
  public static applyChange(content: string, change: TextChange): string {
    const offset = Math.max(0, Math.min(content.length, change.rangeOffset));
    const length = Math.max(0, change.rangeLength);
    const before = content.slice(0, offset);
    const after = content.slice(offset + length);
    return before + change.text + after;
  }

  /**
   * Applies a sequence of atomic changes in order.
   * VS Code delivers multi-cursor or batch changes in reverse-document order (end to start),
   * which ensures offset validity during sequential application.
   */
  public static applyChanges(content: string, changes: TextChange[]): string {
    let result = content;
    for (const change of changes) {
      result = this.applyChange(result, change);
    }
    return result;
  }

  /**
   * Reconstructs full file content from a sequence of DeltaSnapshots for a specific file.
   * Finds the latest Keyframe at or before targetIndex, then applies subsequent Deltas.
   * Time Complexity: O(k) where k <= KEYFRAME_INTERVAL (e.g. <= 50 deltas) instead of O(N * L).
   */
  public static reconstructContent(
    snapshots: DeltaSnapshot[],
    targetIndex: number
  ): string {
    if (snapshots.length === 0 || targetIndex < 0) {
      return '';
    }

    const clampedIndex = Math.min(snapshots.length - 1, targetIndex);

    // 1. Locate the nearest preceding keyframe (I-Frame)
    let keyframeIndex = clampedIndex;
    while (keyframeIndex >= 0 && !snapshots[keyframeIndex].isKeyframe) {
      keyframeIndex--;
    }

    // Fallback: If no keyframe is marked, baseline is empty or first snapshot
    let currentText = '';
    let startIndex = 0;

    if (keyframeIndex >= 0 && snapshots[keyframeIndex].content !== undefined) {
      currentText = snapshots[keyframeIndex].content!;
      startIndex = keyframeIndex + 1;
    } else if (snapshots[0].content !== undefined) {
      currentText = snapshots[0].content;
      startIndex = 1;
    }

    // 2. Fold/apply intermediate deltas up to targetIndex
    for (let i = startIndex; i <= clampedIndex; i++) {
      const snap = snapshots[i];
      if (snap.isKeyframe && snap.content !== undefined) {
        currentText = snap.content;
      } else if (snap.changes && snap.changes.length > 0) {
        currentText = this.applyChanges(currentText, snap.changes);
      }
    }

    return currentText;
  }

  /**
   * Converts a collection of DeltaSnapshots into classic Snapshot objects for compatibility
   * with downstream consumers that expect full content representation.
   */
  public static materializeSnapshots(deltaSnapshots: DeltaSnapshot[]): Snapshot[] {
    const fileSnapshotsMap = new Map<string, DeltaSnapshot[]>();

    // Group by file
    for (const d of deltaSnapshots) {
      const list = fileSnapshotsMap.get(d.filePath) || [];
      list.push(d);
      fileSnapshotsMap.set(d.filePath, list);
    }

    const materialized: Snapshot[] = [];

    for (const [filePath, dList] of fileSnapshotsMap.entries()) {
      let currentContent = '';

      for (let i = 0; i < dList.length; i++) {
        const item = dList[i];
        if (item.isKeyframe && item.content !== undefined) {
          currentContent = item.content;
        } else if (item.changes && item.changes.length > 0) {
          currentContent = this.applyChanges(currentContent, item.changes);
        }

        materialized.push({
          timestamp: item.timestamp,
          filePath,
          content: currentContent,
          cursorStart: item.cursorStart,
          cursorEnd: item.cursorEnd
        });
      }
    }

    // Re-sort chronologically by timestamp
    return materialized.sort((a, b) => a.timestamp - b.timestamp);
  }
}
