import type { Moment } from '@codelapse/core';
import './replay-embed.css';

/** Seconds of lead-in before a moment, so the replay shows what led up to it. */
const LEAD_IN_MS = 3000;

/** Link to a submission's replay, optionally opened just before a moment. */
export function replayHref(submissionId: string, moment?: Pick<Moment, 'sessionId' | 'at'>): string {
  const base = `/instructor/submissions/${submissionId}/replay`;
  if (!moment) {
    return base;
  }
  const at = Math.max(0, Math.round(moment.at - LEAD_IN_MS));
  return `${base}?session=${encodeURIComponent(moment.sessionId)}&at=${at}`;
}

export function WatchMomentLink({ submissionId, moment }: { submissionId: string; moment: Moment }) {
  return (
    <a className="watch-link" href={replayHref(submissionId, moment)}>
      Watch this moment
    </a>
  );
}
