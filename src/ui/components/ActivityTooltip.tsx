import React from 'react';
import { ActivityBucket } from '../../analytics/engine';
import { Snapshot, RunEvent } from '../../models';

interface ActivityTooltipProps {
  bucket: ActivityBucket;
  snapshots: Snapshot[];
  runs: RunEvent[];
}

export const ActivityTooltip: React.FC<ActivityTooltipProps> = ({
  bucket,
  snapshots,
  runs
}) => {
  // Find snapshots and runs that occurred during this bucket's window
  const bucketSnapshots = snapshots.filter(
    (s) => s.timestamp >= bucket.startTimeMs && s.timestamp <= bucket.endTimeMs
  );

  const bucketRuns = runs.filter(
    (r) => r.timestamp >= bucket.startTimeMs && r.timestamp <= bucket.endTimeMs
  );

  // Generate mini-diff representation
  const diffLines: { text: string; type: 'add' | 'del' | 'info' }[] = [];

  if (bucketSnapshots.length === 0) {
    diffLines.push({ text: 'No document edits in this slice', type: 'info' });
  } else {
    // Show affected files and snippet
    const files = Array.from(new Set(bucketSnapshots.map((s) => s.filePath)));
    diffLines.push({
      text: `Modified: ${files.slice(0, 2).join(', ')}${files.length > 2 ? ` +${files.length - 2} more` : ''}`,
      type: 'info'
    });

    const latestSnap = bucketSnapshots[bucketSnapshots.length - 1];
    const lines = latestSnap.content.split(/\r?\n/);
    const cursorLine = latestSnap.cursorStart
      ? latestSnap.content.substring(0, latestSnap.cursorStart).split(/\r?\n/).length - 1
      : 0;

    const previewStart = Math.max(0, cursorLine - 1);
    const previewEnd = Math.min(lines.length, cursorLine + 2);

    for (let i = previewStart; i < previewEnd; i++) {
      const lineContent = lines[i]?.trim();
      if (lineContent) {
        diffLines.push({
          text: `+ ${lineContent.substring(0, 32)}`,
          type: 'add'
        });
      }
    }
  }

  return (
    <div className="activity-tooltip">
      <div className="tooltip-header">
        <span className="tooltip-title">{bucket.label}</span>
        <span className="tooltip-badge">Bucket #{bucket.bucketIndex + 1}</span>
      </div>

      <div className="tooltip-stats">
        <div>
          <strong>Edits:</strong> {bucket.changeVolume.toLocaleString()} chars
        </div>
        <div>
          <strong>Snapshots:</strong> {bucket.snapshotCount}
        </div>
        {bucketRuns.length > 0 && (
          <div style={{ gridColumn: 'span 2' }}>
            <strong>Executions:</strong> {bucketRuns.length} (
            {bucketRuns.filter((r) => r.success).length} passed)
          </div>
        )}
      </div>

      <div className="mini-diff-box">
        {diffLines.map((line, idx) => (
          <div key={idx} className={`diff-line ${line.type}`} title={line.text}>
            {line.text}
          </div>
        ))}
      </div>
    </div>
  );
};
