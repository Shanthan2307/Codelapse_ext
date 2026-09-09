import React from 'react';
import { SessionAnalytics } from '../../analytics/engine';

interface MetricsRowProps {
  analytics: SessionAnalytics;
}

export const MetricsRow: React.FC<MetricsRowProps> = ({ analytics }) => {
  const fileCount = Object.keys(analytics.files).length;
  const netLinesSign = analytics.netLinesWritten > 0 ? '+' : '';

  return (
    <div className="metrics-row">
      {/* 1. Session Duration */}
      <div className="metric-card">
        <span className="metric-label">Session Duration</span>
        <div className="metric-value">
          <span>⏱️</span> {analytics.formattedDuration}
        </div>
        <span className="metric-subtext">
          {analytics.totalSnapshots} snapshots captured
        </span>
      </div>

      {/* 2. Total Keystrokes */}
      <div className="metric-card">
        <span className="metric-label">Total Keystrokes</span>
        <div className="metric-value">
          <span>⌨️</span> {analytics.totalKeystrokes.toLocaleString()}
        </div>
        <span className="metric-subtext">
          Across {fileCount} {fileCount === 1 ? 'file' : 'files'}
        </span>
      </div>

      {/* 3. Net Lines Written */}
      <div className="metric-card">
        <span className="metric-label">Net Lines Written</span>
        <div
          className={`metric-value ${
            analytics.netLinesWritten > 0
              ? 'positive'
              : analytics.netLinesWritten < 0
              ? 'negative'
              : ''
          }`}
        >
          <span>📝</span> {netLinesSign}
          {analytics.netLinesWritten}
        </div>
        <span className="metric-subtext">
          {analytics.netLinesWritten >= 0 ? 'Lines added to workspace' : 'Lines removed from workspace'}
        </span>
      </div>

      {/* 4. Runs & Pass Rate */}
      <div className="metric-card">
        <span className="metric-label">Executions & Runs</span>
        <div className="metric-value">
          <span>🚀</span> {analytics.totalRuns}
        </div>
        <span className="metric-subtext">
          {analytics.totalRuns > 0 ? (
            <span className={analytics.passRate >= 80 ? 'positive' : 'negative'}>
              {analytics.successfulRuns} passed ({analytics.passRate}% pass rate)
            </span>
          ) : (
            'No runs logged'
          )}
        </span>
      </div>
    </div>
  );
};
