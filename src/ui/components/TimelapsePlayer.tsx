import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-python';
import { Snapshot, RunEvent, SessionEvent } from '../../models';
import { PlaybackModel, PlaybackFrame } from '../playback/PlaybackModel';

interface TimelapsePlayerProps {
  snapshots: Snapshot[];
  runs: RunEvent[];
  events?: SessionEvent[];
  totalDurationMs?: number;
}

/** Wall-clock time (ms) the player spends gliding across any idle gap when "Skip idle" is on. */
const IDLE_GLIDE_MS = 600;
/** Longest frame step honored after the tab was hidden, so playback never leaps ahead. */
const MAX_FRAME_DELTA_MS = 100;

export const TimelapsePlayer: React.FC<TimelapsePlayerProps> = ({
  snapshots,
  runs,
  events = [],
  totalDurationMs
}) => {
  const model = useMemo(() => new PlaybackModel(snapshots, totalDurationMs), [snapshots, totalDurationMs]);

  const [playheadMs, setPlayheadMs] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(2); // 1x, 2x, 5x, 10x
  const [skipIdle, setSkipIdle] = useState<boolean>(true);
  const [selectedRun, setSelectedRun] = useState<RunEvent | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<SessionEvent | null>(null);

  // The animation loop reads the playhead from a ref so it never waits on a re-render.
  const playheadRef = useRef<number>(0);
  const codeBodyRef = useRef<HTMLDivElement | null>(null);

  const seek = (ms: number) => {
    const clamped = Math.max(0, Math.min(model.durationMs, ms));
    playheadRef.current = clamped;
    setPlayheadMs(clamped);
  };

  // Live sessions grow while the panel is open: keep the playhead in range
  // instead of rewinding to the start on every update.
  useEffect(() => {
    seek(Math.min(playheadRef.current, model.durationMs));
  }, [model]);

  // Playback engine: requestAnimationFrame advances a continuous playhead in
  // sync with the display refresh, instead of hopping between snapshots.
  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    let frameId = 0;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(now - lastTime, MAX_FRAME_DELTA_MS);
      lastTime = now;

      const current = playheadRef.current;
      let rate = playbackSpeed;
      if (skipIdle) {
        // Cross any idle stretch in a fixed short glide, whatever its length.
        const idleSpan = model.idleSpanAt(current);
        if (idleSpan > 0) {
          rate = Math.max(rate, idleSpan / IDLE_GLIDE_MS);
        }
      }

      const next = Math.min(model.durationMs, current + dt * rate);
      playheadRef.current = next;
      setPlayheadMs(next);

      if (next >= model.durationMs) {
        setIsPlaying(false);
        return;
      }
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying, playbackSpeed, skipIdle, model]);

  const frame = useMemo(() => model.frameAt(playheadMs), [model, playheadMs]);
  const lines = useMemo(() => (frame ? buildLineModels(frame) : []), [frame]);
  const activeLine = lines.findIndex((l) => l.isActive);
  const language = languageFor(frame?.filePath ?? '');

  // Keep the caret in view: recenter only when it nears the viewport edge.
  useLayoutEffect(() => {
    const body = codeBodyRef.current;
    if (!body || activeLine < 0) {
      return;
    }
    const lineEl = body.querySelector<HTMLElement>(`[data-line="${activeLine + 1}"]`);
    if (!lineEl) {
      return;
    }
    const margin = lineEl.offsetHeight * 2;
    const lineTop = lineEl.offsetTop;
    const lineBottom = lineTop + lineEl.offsetHeight;
    if (lineTop < body.scrollTop + margin || lineBottom > body.scrollTop + body.clientHeight - margin) {
      body.scrollTop = lineTop - body.clientHeight / 2 + lineEl.offsetHeight / 2;
    }
  }, [activeLine, frame?.filePath]);

  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    if (playheadRef.current >= model.durationMs) {
      seek(0);
    }
    setIsPlaying(true);
  };

  const pauseAndSeek = (ms: number) => {
    setIsPlaying(false);
    seek(ms);
  };

  const handleStepBack = () => pauseAndSeek(model.previousBoundary(playheadRef.current));
  const handleStepForward = () => pauseAndSeek(model.nextBoundary(playheadRef.current));

  const handleSeekToRun = (run: RunEvent) => {
    setSelectedEvent(null);
    setSelectedRun(run);
    pauseAndSeek(run.timestamp);
  };

  const handleSeekToEvent = (event: SessionEvent) => {
    setSelectedRun(null);
    setSelectedEvent(event);
    pauseAndSeek(event.timestamp);
  };

  // Keyboard shortcuts. The listener is registered once and reads the latest
  // handlers through a ref, so it never captures stale state.
  const shortcutsRef = useRef({ togglePlay, handleStepBack, handleStepForward, pauseAndSeek, model });
  shortcutsRef.current = { togglePlay, handleStepBack, handleStepForward, pauseAndSeek, model };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (target?.isContentEditable || tag === 'TEXTAREA' || tag === 'SELECT') {
        return;
      }
      if (tag === 'INPUT' && (target as HTMLInputElement).type !== 'range') {
        return;
      }

      const s = shortcutsRef.current;
      switch (e.key) {
        case ' ':
          // A focused button already toggles itself on Space.
          if (tag === 'BUTTON') {
            return;
          }
          s.togglePlay();
          break;
        case 'ArrowLeft':
          s.handleStepBack();
          break;
        case 'ArrowRight':
          s.handleStepForward();
          break;
        case 'Home':
          s.pauseAndSeek(0);
          break;
        case 'End':
          s.pauseAndSeek(s.model.durationMs);
          break;
        default:
          return;
      }
      e.preventDefault();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const allFiles = useMemo(() => Array.from(new Set(model.snapshots.map((s) => s.filePath))), [model]);

  // Prefer the explicit event type; fall back to detail sniffing so sessions
  // recorded before 'framework' existed in the schema still show markers.
  const frameworkEvents = useMemo(
    () =>
      events.filter(
        (e) =>
          e.type === 'framework' ||
          e.detail?.includes('React') ||
          e.detail?.includes('Next.js') ||
          e.detail?.includes('Node') ||
          e.detail?.includes('Django')
      ),
    [events]
  );

  const totalSessionTime = Math.max(1, model.durationMs);
  const snapshotCount = model.snapshots.length;
  const showStartHint =
    frame !== null && frame.snapshotIndex === -1 && !frame.isTyping && frame.content === '';

  const renderEditorBody = () => {
    if (!frame) {
      return <div className="empty-player-state">No snapshot data recorded for this session.</div>;
    }
    if (showStartHint) {
      return (
        <div className="empty-player-state">
          Press ▶ Play (or Space) to watch this session being written.
        </div>
      );
    }
    return lines.map((line, idx) => (
      <CodeLine
        key={idx}
        lineNumber={idx + 1}
        text={line.text}
        language={language}
        caretCol={line.caretCol}
        selStart={line.selStart}
        selEnd={line.selEnd}
        isActive={line.isActive}
      />
    ));
  };

  return (
    <div className="section-card timelapse-card">
      <div className="section-header">
        <div>
          <h2 className="section-title">
            <span>🎬</span> Interactive Code Timelapse Player
          </h2>
          <span className="section-subtitle">
            Watch the code being typed, scrub anywhere in time, or jump to runs and milestones.
            Shortcuts: Space play/pause, ← → step, Home/End.
          </span>
        </div>

        {/* Playback speed selector */}
        <div className="speed-selector">
          <span className="speed-label">Speed:</span>
          {[1, 2, 5, 10].map((spd) => (
            <button
              key={spd}
              className={`btn-speed ${playbackSpeed === spd ? 'active' : ''}`}
              onClick={() => setPlaybackSpeed(spd)}
            >
              {spd}x
            </button>
          ))}
          <button
            className={`btn-speed ${skipIdle ? 'active' : ''}`}
            onClick={() => setSkipIdle(!skipIdle)}
            aria-pressed={skipIdle}
            title="Glide quickly through gaps where nothing was typed"
          >
            Skip idle
          </button>
        </div>
      </div>

      {/* File Tabs */}
      {allFiles.length > 0 && (
        <div className="file-tabs-bar">
          {allFiles.map((file) => (
            <button
              key={file}
              className={`file-tab ${frame?.filePath === file ? 'active' : ''}`}
              onClick={() => {
                const firstTime = model.firstTimeOf(file);
                if (firstTime !== null) {
                  pauseAndSeek(firstTime);
                }
              }}
            >
              <span className="tab-icon">📄</span>
              <span className="tab-name">{file}</span>
            </button>
          ))}
        </div>
      )}

      {/* Code Editor Container */}
      <div className="code-viewer-container">
        <div className="code-editor-header">
          <span className="editor-file-path">{frame?.filePath || 'No File'}</span>
          <span className="editor-snapshot-meta">
            {frame?.isTyping && <span className="typing-indicator">● typing</span>}
            Snapshot {Math.max(0, (frame?.snapshotIndex ?? -1) + 1)} of {snapshotCount} &bull;{' '}
            {formatTime(playheadMs)}
          </span>
        </div>
        <div className={`code-editor-body ${frame?.isTyping ? 'is-typing' : ''}`} ref={codeBodyRef}>
          {renderEditorBody()}
        </div>
      </div>

      {/* Timeline Controls & Scrubber */}
      <div className="timelapse-controls">
        <div className="playback-button-group">
          <button
            className="btn btn-secondary btn-icon"
            onClick={handleStepBack}
            disabled={playheadMs <= 0}
            title="Previous snapshot (←)"
          >
            ⏮️
          </button>
          <button
            className="btn btn-icon btn-play"
            onClick={togglePlay}
            title={isPlaying ? 'Pause (Space)' : 'Play Timelapse (Space)'}
          >
            {isPlaying ? '⏸️ Pause' : '▶️ Play'}
          </button>
          <button
            className="btn btn-secondary btn-icon"
            onClick={handleStepForward}
            disabled={playheadMs >= model.durationMs}
            title="Next snapshot (→)"
          >
            ⏭️
          </button>
        </div>

        {/* Timeline Slider Track: time-based, so the thumb lines up with the markers */}
        <div className="slider-track-container">
          <input
            type="range"
            min={0}
            max={totalSessionTime}
            step="any"
            value={playheadMs}
            onChange={(e) => pauseAndSeek(Number(e.target.value))}
            className="timelapse-slider"
            aria-label="Session timeline"
          />

          {/* RunEvent Markers */}
          {runs.map((run, idx) => {
            const positionPct = Math.min(100, Math.max(0, (run.timestamp / totalSessionTime) * 100));
            return (
              <button
                key={`run-${idx}`}
                className={`timeline-run-badge ${run.success ? 'pass' : 'fail'}`}
                style={{ left: `${positionPct}%` }}
                onClick={() => handleSeekToRun(run)}
                title={`Execution at ${formatTime(run.timestamp)}: ${
                  run.success ? 'PASSED' : 'FAILED'
                }\n${run.command || ''}`}
              >
                {run.success ? '✓' : '✕'}
              </button>
            );
          })}

          {/* Framework Milestone Markers */}
          {frameworkEvents.map((evt, idx) => {
            const positionPct = Math.min(100, Math.max(0, (evt.timestamp / totalSessionTime) * 100));
            const icon = evt.detail?.includes('React') ? '⚛️' : evt.detail?.includes('Django') ? '🐍' : '📦';
            return (
              <button
                key={`evt-${idx}`}
                className="timeline-framework-badge"
                style={{ left: `${positionPct}%` }}
                onClick={() => handleSeekToEvent(evt)}
                title={`Milestone at ${formatTime(evt.timestamp)}: ${evt.detail || ''}`}
              >
                {icon}
              </button>
            );
          })}
        </div>

        {/* Time Progress Display */}
        <div className="time-display">
          <span>{formatTime(playheadMs)}</span> / <span>{formatTime(model.durationMs)}</span>
        </div>
      </div>

      {/* Selected Run Details Modal / Banner */}
      {selectedRun && (
        <div className="run-details-banner">
          <div className="run-details-header">
            <span
              className={`run-status-tag ${
                selectedRun.success ? 'positive' : 'negative'
              }`}
            >
              {selectedRun.success ? '✓ Run Passed' : '✕ Run Failed'}
            </span>
            <span className="run-command-text">
              {selectedRun.command || 'Execution output'} ({selectedRun.durationMs}ms)
            </span>
            <button
              className="btn-close-banner"
              onClick={() => setSelectedRun(null)}
            >
              ✕
            </button>
          </div>
          <pre className="run-output-box">{selectedRun.output}</pre>
        </div>
      )}

      {/* Selected Framework Milestone Banner */}
      {selectedEvent && (
        <div className="run-details-banner">
          <div className="run-details-header">
            <span className="run-status-tag positive">
              📌 Framework Milestone ({formatTime(selectedEvent.timestamp)})
            </span>
            <span className="run-command-text">{selectedEvent.detail}</span>
            <button
              className="btn-close-banner"
              onClick={() => setSelectedEvent(null)}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------- Code rendering ---------------- //

interface LanguageInfo {
  grammar: Prism.Grammar;
  lang: string;
}

// Module-level constants so each language object keeps a stable identity,
// which lets React.memo skip lines whose props did not change.
const LANGUAGES: Record<string, LanguageInfo> = {
  typescript: { grammar: Prism.languages.typescript || Prism.languages.javascript, lang: 'typescript' },
  javascript: { grammar: Prism.languages.javascript, lang: 'javascript' },
  json: { grammar: Prism.languages.json || Prism.languages.javascript, lang: 'json' },
  css: { grammar: Prism.languages.css, lang: 'css' },
  python: { grammar: Prism.languages.python || Prism.languages.javascript, lang: 'python' }
};

function languageFor(filePath: string): LanguageInfo {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'ts':
    case 'tsx':
      return LANGUAGES.typescript;
    case 'json':
      return LANGUAGES.json;
    case 'css':
      return LANGUAGES.css;
    case 'py':
      return LANGUAGES.python;
    default:
      return LANGUAGES.javascript;
  }
}

/**
 * Prism highlighting is the most expensive work per frame. While code is being
 * typed only one line changes, so caching by (language, text) turns every
 * other line into a Map lookup.
 */
const HIGHLIGHT_CACHE_LIMIT = 5000;
const highlightCache = new Map<string, string>();

function highlight(text: string, language: LanguageInfo): string {
  const key = `${language.lang}\u0000${text}`;
  let html = highlightCache.get(key);
  if (html === undefined) {
    if (highlightCache.size >= HIGHLIGHT_CACHE_LIMIT) {
      highlightCache.clear();
    }
    html = Prism.highlight(text, language.grammar, language.lang);
    highlightCache.set(key, html);
  }
  return html;
}

interface LineModel {
  text: string;
  /** Column of a collapsed caret on this line, or -1. */
  caretCol: number;
  /** Selected column range on this line, or -1/-1. */
  selStart: number;
  selEnd: number;
  /** Line that contains the cursor start (gets the active-line highlight). */
  isActive: boolean;
}

/** Splits a frame into lines and works out where its caret or selection falls. */
function buildLineModels(frame: PlaybackFrame): LineModel[] {
  const start = Math.min(frame.cursorStart, frame.cursorEnd);
  const end = Math.max(frame.cursorStart, frame.cursorEnd);
  let offset = 0;
  let activeAssigned = false;

  return frame.content.split('\n').map((raw) => {
    // Offsets count the raw line (including any \r) plus its \n.
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const lineStart = offset;
    const lineEnd = lineStart + text.length;
    offset += raw.length + 1;

    const isActive = !activeAssigned && start >= lineStart && start <= lineEnd;
    if (isActive) {
      activeAssigned = true;
    }

    const caretCol = isActive && start === end ? start - lineStart : -1;
    const hasSelection = start < end && lineEnd >= start && lineStart <= end;

    return {
      text,
      caretCol,
      selStart: hasSelection ? Math.max(0, start - lineStart) : -1,
      selEnd: hasSelection ? Math.min(text.length, end - lineStart) : -1,
      isActive
    };
  });
}

interface CodeLineProps {
  lineNumber: number;
  text: string;
  language: LanguageInfo;
  caretCol: number;
  selStart: number;
  selEnd: number;
  isActive: boolean;
}

/** One editor line. Memoized: only lines whose text or caret changed re-render. */
const CodeLine = React.memo(function CodeLine({
  lineNumber,
  text,
  language,
  caretCol,
  selStart,
  selEnd,
  isActive
}: CodeLineProps) {
  let content: React.ReactNode;

  if (caretCol >= 0) {
    content = (
      <>
        <span dangerouslySetInnerHTML={{ __html: highlight(text.slice(0, caretCol), language) }} />
        <span className="editor-cursor" />
        <span dangerouslySetInnerHTML={{ __html: highlight(text.slice(caretCol), language) }} />
      </>
    );
  } else if (selStart >= 0) {
    content = (
      <>
        <span dangerouslySetInnerHTML={{ __html: highlight(text.slice(0, selStart), language) }} />
        <span className="editor-selection">
          <span dangerouslySetInnerHTML={{ __html: highlight(text.slice(selStart, selEnd), language) }} />
        </span>
        <span dangerouslySetInnerHTML={{ __html: highlight(text.slice(selEnd), language) }} />
      </>
    );
  } else {
    content = <span dangerouslySetInnerHTML={{ __html: highlight(text || ' ', language) }} />;
  }

  return (
    <div className={`code-line ${isActive ? 'active-line' : ''}`} data-line={lineNumber}>
      <span className="line-number">{lineNumber}</span>
      <span className="line-content">{content}</span>
    </div>
  );
});

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}
