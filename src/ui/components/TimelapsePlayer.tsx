import React, { useState, useEffect, useRef } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-python';
import { Snapshot, RunEvent } from '../../models';

interface TimelapsePlayerProps {
  snapshots: Snapshot[];
  runs: RunEvent[];
  totalDurationMs?: number;
}

export const TimelapsePlayer: React.FC<TimelapsePlayerProps> = ({
  snapshots,
  runs,
  totalDurationMs
}) => {
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(2); // 1x, 2x, 5x, 10x
  const [activeFile, setActiveFile] = useState<string>('');
  const [selectedRun, setSelectedRun] = useState<RunEvent | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const codeContainerRef = useRef<HTMLDivElement | null>(null);

  // Get list of all distinct files touched across snapshots
  const allFiles = Array.from(new Set(snapshots.map((s) => s.filePath)));

  // Sync active file on mount or when snapshots change
  useEffect(() => {
    if (snapshots.length > 0) {
      const initialFile = snapshots[0].filePath;
      setActiveFile(initialFile);
      setCurrentIndex(0);
    }
  }, [snapshots]);

  // Current snapshot
  const currentSnapshot = snapshots[currentIndex] || null;

  // Auto-switch tab if current snapshot is in another file
  useEffect(() => {
    if (currentSnapshot && currentSnapshot.filePath !== activeFile) {
      setActiveFile(currentSnapshot.filePath);
    }
  }, [currentSnapshot]);

  // Playback engine
  useEffect(() => {
    if (!isPlaying) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    if (currentIndex >= snapshots.length - 1) {
      setIsPlaying(false);
      return;
    }

    // Determine delay between consecutive snapshots
    const nextSnap = snapshots[currentIndex + 1];
    const currSnap = snapshots[currentIndex];
    const realDelta = nextSnap && currSnap ? Math.max(0, nextSnap.timestamp - currSnap.timestamp) : 500;

    // Scale delay by playback speed, clamped between 50ms and 800ms
    const delay = Math.max(50, Math.min(800, Math.round(realDelta / playbackSpeed)));

    timerRef.current = setTimeout(() => {
      setCurrentIndex((prev) => {
        if (prev < snapshots.length - 1) {
          return prev + 1;
        } else {
          setIsPlaying(false);
          return prev;
        }
      });
    }, delay);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [isPlaying, currentIndex, snapshots, playbackSpeed]);

  const togglePlay = () => {
    if (currentIndex >= snapshots.length - 1) {
      setCurrentIndex(0);
    }
    setIsPlaying(!isPlaying);
  };

  const handleStepBack = () => {
    setIsPlaying(false);
    setCurrentIndex((prev) => Math.max(0, prev - 1));
  };

  const handleStepForward = () => {
    setIsPlaying(false);
    setCurrentIndex((prev) => Math.min(snapshots.length - 1, prev + 1));
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsPlaying(false);
    setCurrentIndex(Number(e.target.value));
  };

  // Jump to the closest snapshot matching a run event's timestamp
  const handleSeekToRun = (run: RunEvent) => {
    setIsPlaying(false);
    setSelectedRun(run);

    let closestIdx = 0;
    let minDiff = Infinity;
    for (let i = 0; i < snapshots.length; i++) {
      const diff = Math.abs(snapshots[i].timestamp - run.timestamp);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = i;
      }
    }
    setCurrentIndex(closestIdx);
  };

  // Helper to determine language for Prism syntax highlighting
  const getLanguageGrammar = (filePath: string): { grammar: Prism.Grammar; lang: string } => {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    switch (ext) {
      case 'ts':
      case 'tsx':
        return { grammar: Prism.languages.typescript || Prism.languages.javascript, lang: 'typescript' };
      case 'js':
      case 'jsx':
        return { grammar: Prism.languages.javascript, lang: 'javascript' };
      case 'json':
        return { grammar: Prism.languages.json || Prism.languages.javascript, lang: 'json' };
      case 'css':
        return { grammar: Prism.languages.css, lang: 'css' };
      case 'py':
        return { grammar: Prism.languages.python || Prism.languages.javascript, lang: 'python' };
      default:
        return { grammar: Prism.languages.javascript, lang: 'javascript' };
    }
  };

  // Render code lines with line numbers, syntax highlighting, and exact cursor/selection
  const renderHighlightedCode = () => {
    if (!currentSnapshot) {
      return <div className="empty-player-state">No snapshot data recorded for this session.</div>;
    }

    const content = currentSnapshot.content || '';
    const lines = content.split(/\r?\n/);
    const { grammar, lang } = getLanguageGrammar(currentSnapshot.filePath);

    // Compute cursor offset line/column bounds
    const cursorStart = currentSnapshot.cursorStart ?? 0;
    const cursorEnd = currentSnapshot.cursorEnd ?? cursorStart;

    let charAccumulator = 0;

    return lines.map((lineText, lineIdx) => {
      const lineStartOffset = charAccumulator;
      const lineEndOffset = lineStartOffset + lineText.length;
      charAccumulator = lineEndOffset + 1; // +1 for newline

      const hasCursor =
        cursorStart >= lineStartOffset && cursorStart <= lineEndOffset;
      const hasRangeSelection =
        cursorStart < cursorEnd &&
        lineEndOffset >= cursorStart &&
        lineStartOffset <= cursorEnd;

      // Tokenize with Prism
      const highlightedHtml = Prism.highlight(lineText || ' ', grammar, lang);

      // If cursor is within this line, insert styled visual cursor
      let lineNode: React.ReactNode = (
        <span dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
      );

      if (hasCursor && cursorStart === cursorEnd) {
        const colOffset = Math.max(0, cursorStart - lineStartOffset);
        const beforeText = lineText.substring(0, colOffset);
        const afterText = lineText.substring(colOffset);

        const beforeHtml = Prism.highlight(beforeText, grammar, lang);
        const afterHtml = Prism.highlight(afterText, grammar, lang);

        lineNode = (
          <span>
            <span dangerouslySetInnerHTML={{ __html: beforeHtml }} />
            <span className="editor-cursor" />
            <span dangerouslySetInnerHTML={{ __html: afterHtml }} />
          </span>
        );
      } else if (hasRangeSelection) {
        const selStartCol = Math.max(0, cursorStart - lineStartOffset);
        const selEndCol = Math.min(lineText.length, cursorEnd - lineStartOffset);

        const beforeText = lineText.substring(0, selStartCol);
        const selectedText = lineText.substring(selStartCol, selEndCol);
        const afterText = lineText.substring(selEndCol);

        lineNode = (
          <span>
            <span dangerouslySetInnerHTML={{ __html: Prism.highlight(beforeText, grammar, lang) }} />
            <span className="editor-selection">
              <span dangerouslySetInnerHTML={{ __html: Prism.highlight(selectedText, grammar, lang) }} />
            </span>
            <span dangerouslySetInnerHTML={{ __html: Prism.highlight(afterText, grammar, lang) }} />
          </span>
        );
      }

      return (
        <div key={lineIdx} className={`code-line ${hasCursor ? 'active-line' : ''}`}>
          <span className="line-number">{lineIdx + 1}</span>
          <span className="line-content">{lineNode}</span>
        </div>
      );
    });
  };

  const totalSessionTime =
    totalDurationMs ||
    (snapshots.length > 0 ? snapshots[snapshots.length - 1].timestamp : 1);

  return (
    <div className="section-card timelapse-card">
      <div className="section-header">
        <div>
          <h2 className="section-title">
            <span>🎬</span> Interactive Code Timelapse Player
          </h2>
          <span className="section-subtitle">
            Scrub or replay typing history with exact cursor navigation and execution checkpoints.
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
        </div>
      </div>

      {/* File Tabs */}
      {allFiles.length > 0 && (
        <div className="file-tabs-bar">
          {allFiles.map((file) => (
            <button
              key={file}
              className={`file-tab ${activeFile === file ? 'active' : ''}`}
              onClick={() => {
                setActiveFile(file);
                // Seek to latest snapshot for this file if available
                const fileSnapIdx = snapshots.findIndex((s) => s.filePath === file);
                if (fileSnapIdx !== -1) {
                  setCurrentIndex(fileSnapIdx);
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
      <div className="code-viewer-container" ref={codeContainerRef}>
        <div className="code-editor-header">
          <span className="editor-file-path">{currentSnapshot?.filePath || 'No File'}</span>
          <span className="editor-snapshot-meta">
            Snapshot {currentIndex + 1} of {Math.max(1, snapshots.length)} &bull;{' '}
            {formatTime(currentSnapshot?.timestamp || 0)}
          </span>
        </div>
        <div className="code-editor-body">{renderHighlightedCode()}</div>
      </div>

      {/* Timeline Controls & Scrubber */}
      <div className="timelapse-controls">
        {/* Play/Pause/Step Buttons */}
        <div className="playback-button-group">
          <button
            className="btn btn-secondary btn-icon"
            onClick={handleStepBack}
            disabled={currentIndex === 0}
            title="Step backward (Previous snapshot)"
          >
            ⏮️
          </button>
          <button
            className="btn btn-icon btn-play"
            onClick={togglePlay}
            title={isPlaying ? 'Pause' : 'Play Timelapse'}
          >
            {isPlaying ? '⏸️ Pause' : '▶️ Play'}
          </button>
          <button
            className="btn btn-secondary btn-icon"
            onClick={handleStepForward}
            disabled={currentIndex >= snapshots.length - 1}
            title="Step forward (Next snapshot)"
          >
            ⏭️
          </button>
        </div>

        {/* Timeline Slider Track */}
        <div className="slider-track-container">
          <input
            type="range"
            min={0}
            max={Math.max(0, snapshots.length - 1)}
            value={currentIndex}
            onChange={handleSliderChange}
            className="timelapse-slider"
          />

          {/* RunEvent Markers overlaid along the slider */}
          {runs.map((run, idx) => {
            const positionPct = Math.min(
              100,
              Math.max(0, (run.timestamp / Math.max(1, totalSessionTime)) * 100)
            );
            return (
              <button
                key={idx}
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
        </div>

        {/* Time Progress Display */}
        <div className="time-display">
          <span>{formatTime(currentSnapshot?.timestamp || 0)}</span> /{' '}
          <span>{formatTime(totalSessionTime)}</span>
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
    </div>
  );
};

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
}
