import React, { useMemo, useState } from 'react';
import { FileFlow, FileVisit } from '../flow/FileFlowModel';
import { describeLines, summarizeJourney } from '../flow/journey';

interface FileJourneyProps {
  flow: FileFlow;
  playheadMs: number;
  /** Jump to the end of a visit and highlight what was typed during it. */
  onShowVisit: (visit: FileVisit) => void;
  /** Play a visit from start to end. */
  onReplayVisit: (visit: FileVisit) => void;
}

/** Height of one file's row in the timeline, in pixels (keep in sync with .journey-track). */
const ROW_H = 30;

/**
 * File journey: one row per file, time running left to right. Each stretch of
 * work in a file is a bar on its row (solid if the file was changed, outlined
 * if it was only read), and a thin line marks each switch between files. It
 * follows the replay: a playhead moves across, and what hasn't happened yet
 * is faded.
 */
export const FileJourney: React.FC<FileJourneyProps> = ({ flow, playheadMs, onShowVisit, onReplayVisit }) => {
  const summary = useMemo(() => summarizeJourney(flow), [flow]);
  const [selected, setSelected] = useState<number | null>(null);
  const laneIndex = useMemo(() => new Map(summary.lanes.map((l, i) => [l.filePath, i])), [summary]);

  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / summary.durationMs) * 100))}%`;
  const current = flow.visits.find((v) => playheadMs >= v.start && playheadMs < v.end);
  // Before the replay starts, show the whole journey; once it runs, fade what hasn't happened yet.
  const isLater = (ms: number) => playheadMs > 0 && ms > playheadMs;
  const visit = selected === null ? undefined : flow.visits[selected];

  const select = (v: FileVisit) => {
    setSelected(v.index);
    onShowVisit(v);
  };

  const singleFile = summary.lanes.length === 1;

  return (
    <div className="section-card journey-card">
      <div className="section-header">
        <div>
          <h2 className="section-title">File journey</h2>
          <span className="section-subtitle">
            {singleFile ? (
              <>
                All the work stayed in <code>{summary.lanes[0].label}</code>. Click a bar to see what was typed then.
              </>
            ) : (
              <>
                Which file the student was in, over time. Click a bar to see what was typed then.
              </>
            )}
          </span>
        </div>
      </div>

      {!singleFile && (
        <div className="journey-summary">
          <span>
            <b>{summary.lanes.length}</b> files
          </span>
          <span>
            <b>{summary.switches}</b> {summary.switches === 1 ? 'switch' : 'switches'}
          </span>
          {summary.mostTime && (
            <span>
              most time in <code>{summary.mostTime.label}</code> ({Math.round(summary.mostTime.share * 100)}%)
            </span>
          )}
          {summary.backAndForth && (
            <span>
              back and forth most between <code>{baseName(summary.backAndForth.a)}</code> and{' '}
              <code>{baseName(summary.backAndForth.b)}</code> ({summary.backAndForth.times} times)
            </span>
          )}
        </div>
      )}

      <div className="journey-grid" role="group" aria-label="Time spent in each file">
        <div className="journey-labels">
          {summary.lanes.map((lane) => (
            <div
              key={lane.filePath}
              className={`journey-label ${current?.filePath === lane.filePath ? 'current' : ''}`}
              style={{ height: ROW_H }}
              title={`${lane.filePath}\n${formatTime(lane.timeMs)} · ${lane.visits.length} ${lane.visits.length === 1 ? 'visit' : 'visits'} · ${lane.charsTyped} characters typed`}
            >
              <span className="journey-name">{lane.label}</span>
              <span className="journey-share">{Math.round(lane.share * 100)}%</span>
            </div>
          ))}
        </div>

        <div className="journey-track" style={{ height: summary.lanes.length * ROW_H }}>
          {summary.lanes.map((lane, i) => (
            <div key={lane.filePath} className="journey-row" style={{ top: i * ROW_H, height: ROW_H }} />
          ))}

          {flow.moves.map((move, i) => {
            const from = laneIndex.get(move.from) ?? 0;
            const to = laneIndex.get(move.to) ?? 0;
            const top = Math.min(from, to) * ROW_H + ROW_H / 2;
            return (
              <div
                key={i}
                className={`journey-switch ${isLater(move.time) ? 'later' : ''}`}
                style={{ left: pct(move.time), top, height: Math.abs(to - from) * ROW_H }}
                aria-hidden="true"
              />
            );
          })}

          {flow.visits.map((v) => {
            const row = laneIndex.get(v.filePath) ?? 0;
            const state = [
              v.edited ? 'edited' : 'read-only',
              isLater(v.start) ? 'later' : '',
              current?.index === v.index ? 'current' : '',
              selected === v.index ? 'selected' : ''
            ].join(' ');
            return (
              <button
                key={v.index}
                className={`journey-visit ${state}`}
                style={{ left: pct(v.start), width: `max(4px, ${pct(v.end - v.start)})`, top: row * ROW_H + 6, height: ROW_H - 12 }}
                onClick={() => select(v)}
                aria-label={describeVisit(v)}
                title={describeVisit(v)}
              />
            );
          })}

          {playheadMs > 0 && <div className="journey-playhead" style={{ left: pct(playheadMs) }} aria-hidden="true" />}
        </div>

        <div />
        <div className="journey-axis">
          <span>00:00</span>
          <span>{formatTime(summary.durationMs / 2)}</span>
          <span>{formatTime(summary.durationMs)}</span>
        </div>
      </div>

      <div className="journey-legend" aria-hidden="true">
        <span>
          <i className="journey-key edited" /> changed the file
        </span>
        <span>
          <i className="journey-key read-only" /> only read it
        </span>
        {!singleFile && (
          <span>
            <i className="journey-key switch" /> switched files
          </span>
        )}
      </div>

      {visit && (
        <div className="journey-detail">
          <div className="journey-detail-text">
            <b>
              Visit {visit.index + 1} of {flow.visits.length}
            </b>{' '}
            · <code>{visit.filePath}</code> · {formatTime(visit.start)}–{formatTime(visit.end)}
            <div>
              {visit.edited ? (
                <>
                  Typed {visit.charsTyped} characters
                  {visit.changedLines.length > 0 && <> on {describeLines(visit.changedLines)}</>}, highlighted in the code
                  above.
                </>
              ) : (
                <>Read the file for {formatTime(visit.end - visit.start)} without changing it.</>
              )}
            </div>
          </div>
          <div className="journey-detail-actions">
            <button
              className="btn btn-secondary"
              disabled={visit.index === 0}
              onClick={() => select(flow.visits[visit.index - 1])}
              aria-label="Previous visit"
            >
              ‹
            </button>
            <button
              className="btn btn-secondary"
              disabled={visit.index === flow.visits.length - 1}
              onClick={() => select(flow.visits[visit.index + 1])}
              aria-label="Next visit"
            >
              ›
            </button>
            <button className="btn" onClick={() => onReplayVisit(visit)}>
              Replay this visit
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

function describeVisit(v: FileVisit): string {
  const when = `${formatTime(v.start)}–${formatTime(v.end)}`;
  return v.edited
    ? `${v.filePath}, ${when}: typed ${v.charsTyped} characters${v.changedLines.length ? ` on ${describeLines(v.changedLines)}` : ''}`
    : `${v.filePath}, ${when}: read only`;
}

function baseName(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(totalSec / 60).toString().padStart(2, '0')}:${(totalSec % 60).toString().padStart(2, '0')}`;
}
