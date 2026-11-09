import React from 'react';
import { SessionAnalytics } from '@codelapse/core';

interface MetricsRowProps {
  analytics: SessionAnalytics;
}

function runSummary(analytics: SessionAnalytics): React.ReactNode {
  const unrecorded = analytics.unrecordedTerminals > 0 ? 'Some terminal commands were not recorded' : null;
  if (analytics.totalRuns === 0) {
    return unrecorded ?? 'No runs logged';
  }
  const unknown = analytics.unknownRuns > 0 ? `${analytics.unknownRuns} result unknown` : null;
  if (analytics.passRate === null) {
    return [unknown, unrecorded].filter(Boolean).join(' · ');
  }
  return (
    <>
      <span>
        {analytics.successfulRuns} passed ({analytics.passRate}% pass rate)
      </span>
      {unknown && ` · ${unknown}`}
      {unrecorded && ` · ${unrecorded}`}
    </>
  );
}

export const MetricsRow: React.FC<MetricsRowProps> = ({ analytics }) => {
  const fileCount = Object.keys(analytics.files).length;
  const netLinesSign = analytics.netLinesWritten > 0 ? '+' : '';

  return (
    <div className="metrics-row">
      <div className="metric-card">
        <span className="metric-label">Recorded time</span>
        <div className="metric-value">
          {analytics.formattedDuration}
        </div>
        <span className="metric-subtext">
          {analytics.totalSnapshots} snapshots
        </span>
      </div>

      <div className="metric-card">
        <span className="metric-label">Characters typed</span>
        <div className="metric-value">
          {analytics.typedChars.toLocaleString()}
        </div>
        <span
          className="metric-subtext"
          title="Bulk inserted means one edit added many characters at once: paste, autocomplete, formatting or undo. Pre-existing means the text was already in the file when it was first seen. Unclassified edits come from recordings made before edits were classified."
        >
          {analytics.bulkInsertedChars.toLocaleString()} bulk inserted ·{' '}
          {analytics.unclassifiedChars > 0 && `${analytics.unclassifiedChars.toLocaleString()} unclassified · `}
          {analytics.preExistingChars.toLocaleString()} pre-existing · {fileCount}{' '}
          {fileCount === 1 ? 'file' : 'files'}
        </span>
      </div>

      <div className="metric-card">
        <span className="metric-label">Net lines changed</span>
        <div
          className={`metric-value ${
            analytics.netLinesWritten > 0
              ? 'positive'
              : analytics.netLinesWritten < 0
              ? 'negative'
              : ''
          }`}
        >
          {netLinesSign}
          {analytics.netLinesWritten}
        </div>
        <span className="metric-subtext">
          {analytics.netLinesWritten >= 0 ? 'Lines added across files' : 'Lines removed across files'}
        </span>
      </div>

      <div className="metric-card">
        <span className="metric-label">Builds and runs</span>
        <div className="metric-value">
          {analytics.totalRuns}
        </div>
        <span className="metric-subtext">
          {runSummary(analytics)}
        </span>
      </div>
    </div>
  );
};
