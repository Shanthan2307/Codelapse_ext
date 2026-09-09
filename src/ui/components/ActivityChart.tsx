import React, { useState } from 'react';
import { ActivityBucket } from '../../analytics/engine';
import { Snapshot, RunEvent } from '../../models';
import { ActivityTooltip } from './ActivityTooltip';

interface ActivityChartProps {
  buckets: ActivityBucket[];
  snapshots: Snapshot[];
  runs: RunEvent[];
  onSelectBucket?: (bucketIndex: number) => void;
}

export const ActivityChart: React.FC<ActivityChartProps> = ({
  buckets,
  snapshots,
  runs,
  onSelectBucket
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Compute maximum volume for proportional scaling (at least 1 to avoid / 0)
  const maxVolume = Math.max(1, ...buckets.map((b) => b.changeVolume));

  return (
    <div className="section-card">
      <div className="section-header">
        <div>
          <h2 className="section-title">
            <span style={{ fontSize: '18px' }}>📊</span> 24-Bucket Keystroke & Change Activity
          </h2>
          <span className="section-subtitle">
            Timeline distribution partitioned into 24 proportional slices. Hover for mini-diffs.
          </span>
        </div>
      </div>

      <div className="chart-wrapper">
        <div className="bars-container">
          {buckets.map((bucket, index) => {
            // Calculate proportional height between 10% and 100%
            const heightPercent = bucket.changeVolume > 0
              ? Math.max(12, Math.round((bucket.changeVolume / maxVolume) * 100))
              : 6;

            // Check if there are runs in this bucket
            const bucketRuns = runs.filter(
              (r) => r.timestamp >= bucket.startTimeMs && r.timestamp <= bucket.endTimeMs
            );
            const hasPass = bucketRuns.some((r) => r.success);
            const hasFail = bucketRuns.some((r) => !r.success);

            return (
              <div
                key={bucket.bucketIndex}
                className={`bar-column ${hoveredIndex === index ? 'active' : ''}`}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                onClick={() => onSelectBucket?.(index)}
                role="button"
                tabIndex={0}
                aria-label={`Bucket ${index + 1}: ${bucket.label}`}
              >
                {/* Run indicator marker */}
                {bucketRuns.length > 0 && (
                  <div
                    className={`run-marker ${hasFail ? 'fail' : 'pass'}`}
                    title={`Run execution: ${hasFail ? 'Failed' : 'Passed'}`}
                  />
                )}

                {/* Bar Fill */}
                <div
                  className="bar-fill"
                  style={{
                    height: `${heightPercent}%`,
                    opacity: bucket.changeVolume > 0 ? 0.95 : 0.3
                  }}
                />

                {/* Hover Tooltip */}
                {hoveredIndex === index && (
                  <ActivityTooltip
                    bucket={bucket}
                    snapshots={snapshots}
                    runs={runs}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Timeline Axis Labels */}
        <div className="timeline-axis">
          <span>{buckets[0]?.label.split(' - ')[0] || '00:00'}</span>
          <span>Session Midpoint</span>
          <span>{buckets[buckets.length - 1]?.label.split(' - ')[1] || 'End'}</span>
        </div>
      </div>
    </div>
  );
};
