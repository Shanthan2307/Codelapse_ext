'use client';

import { useMemo, useState } from 'react';
import { computeSessionAnalytics, Session } from '@codelapse/core';
import { ActivityChart, MetricsRow, TimelapsePlayer } from '@codelapse/replay';
import '@codelapse/replay/styles.css';
import './replay-embed.css';

interface ReplayViewProps {
  sessions: Session[];
  /** Session to open first; defaults to the first one. */
  initialSessionId?: string;
  /** Session time (ms) to open at. */
  initialMs?: number;
}

/**
 * The CodeLapse replay (the same player as the VS Code report) inside the
 * instructor site. It keeps its dark editor look on the light page: the
 * replay styles fall back to dark colours when no VS Code theme is present.
 */
export function ReplayView({ sessions, initialSessionId, initialMs = 0 }: ReplayViewProps) {
  const ordered = useMemo(() => [...sessions].sort((a, b) => a.startTime - b.startTime), [sessions]);
  const firstIndex = Math.max(0, ordered.findIndex((s) => s.id === initialSessionId));
  const [index, setIndex] = useState(firstIndex);
  const session = ordered[index];
  const analytics = useMemo(() => computeSessionAnalytics(session), [session]);
  // The requested moment only applies to the session it belongs to.
  const startAt = index === firstIndex ? initialMs : 0;

  return (
    <div className="codelapse-replay replay-embed">
      <div className="codelapse-container">
        {ordered.length > 1 && (
          <div className="replay-sessions" role="tablist" aria-label="Recorded sessions">
            {ordered.map((s, i) => (
              <button
                key={s.id}
                role="tab"
                aria-selected={i === index}
                className={`btn ${i === index ? '' : 'btn-secondary'}`}
                onClick={() => setIndex(i)}
              >
                Session {i + 1} · {new Date(s.startTime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
              </button>
            ))}
          </div>
        )}
        <MetricsRow analytics={analytics} />
        <TimelapsePlayer
          key={`${session.id}:${startAt}`}
          snapshots={session.snapshots}
          runs={session.runs}
          events={session.events}
          totalDurationMs={analytics.durationMs}
          initialMs={startAt}
        />
        <ActivityChart buckets={analytics.activityBuckets} snapshots={session.snapshots} runs={session.runs} />
      </div>
    </div>
  );
}
