import React, { useEffect, useState } from 'react';
import { Session } from '@codelapse/core';
import {
  computeSessionAnalytics,
  SessionAnalytics
} from '@codelapse/core';
import { MetricsRow } from './components/MetricsRow';
import { ActivityChart } from './components/ActivityChart';
import { TimelapsePlayer } from './components/TimelapsePlayer';
import './styles.css';

// VS Code API declaration
interface VsCodeApi {
  postMessage: (message: OutgoingMessage) => void;
}
declare function acquireVsCodeApi(): VsCodeApi;

/** Summary of a saved recording, as sent by ReportPanel. */
interface SavedSessionInfo {
  id: string;
  workspaceName: string;
  startTime: number;
  endTime?: number;
  snapshotCount: number;
  runCount: number;
  uri: string;
}

type OutgoingMessage =
  | { type: 'READY' }
  | { type: 'REQUEST_DATA' }
  | { type: 'EXPORT_HTML' }
  | { type: 'LOAD_SESSION_BY_URI'; payload: { uri: string } };

type IncomingMessage =
  | {
      type: 'SET_SESSION_DATA';
      payload?: {
        session?: Session;
        analytics?: SessionAnalytics;
        isRecording?: boolean;
        isPaused?: boolean;
      };
    }
  | { type: 'SET_SAVED_SESSIONS_LIST'; payload?: { sessions?: SavedSessionInfo[] } };

/** Exported reports embed their session and have no extension host to talk to. */
const standaloneData = (window as Window & { __CODELAPSE_STANDALONE_DATA__?: { session: Session } })
  .__CODELAPSE_STANDALONE_DATA__;

const vscodeApi: VsCodeApi = standaloneData ? { postMessage: () => undefined } : acquireVsCodeApi();

export const App: React.FC = () => {
  const standaloneSession = standaloneData?.session ?? null;
  const isStandalone = standaloneSession !== null;
  const [session, setSession] = useState<Session | null>(standaloneSession);
  const [analytics, setAnalytics] = useState<SessionAnalytics | null>(() =>
    standaloneSession ? computeSessionAnalytics(standaloneSession) : null
  );
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [savedSessions, setSavedSessions] = useState<SavedSessionInfo[]>([]);

  // IPC listener
  useEffect(() => {
    if (isStandalone) return;

    const handleMessage = (event: MessageEvent<IncomingMessage>) => {
      const message = event.data;
      if (!message || !message.type) return;

      switch (message.type) {
        case 'SET_SESSION_DATA': {
          const payload = message.payload;
          if (payload?.session) {
            setSession(payload.session);
            setAnalytics(payload.analytics || computeSessionAnalytics(payload.session));
            if (payload.isRecording !== undefined) {
              setIsRecording(payload.isRecording);
            }
            if (payload.isPaused !== undefined) {
              setIsPaused(payload.isPaused);
            }
          }
          break;
        }

        case 'SET_SAVED_SESSIONS_LIST': {
          if (message.payload?.sessions) {
            setSavedSessions(message.payload.sessions);
          }
          break;
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // Notify extension host that webview is ready to receive data
    vscodeApi.postMessage({ type: 'READY' });

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [isStandalone]);

  const handleRefresh = () => {
    vscodeApi.postMessage({ type: 'REQUEST_DATA' });
  };

  const handleLoadSavedSession = (uri: string) => {
    vscodeApi.postMessage({ type: 'LOAD_SESSION_BY_URI', payload: { uri } });
  };

  const handleExportHtml = () => {
    vscodeApi.postMessage({ type: 'EXPORT_HTML' });
  };

  return (
    <div className="codelapse-container">
      {/* 1. Header */}
      <header className="dashboard-header">
        <div className="header-left">
          <h1 className="header-title">
            <span>⚡</span> CodeLapse Dashboard
          </h1>
          {session && <span className="workspace-pill">{session.workspaceName}</span>}
          {session && (
            <span
              className={`status-badge ${
                isRecording ? 'recording' : isPaused ? 'paused' : 'idle'
              }`}
            >
              <span className="pulse-dot" />
              {isRecording ? 'Recording' : isPaused ? 'Paused' : isStandalone ? 'Standalone Replay' : 'Saved Session'}
            </span>
          )}
        </div>

        <div className="header-actions">
          {!isStandalone && session && savedSessions.length > 0 && (
            <select
              className="btn btn-secondary"
              value={session.id}
              onChange={(e) => {
                const found = savedSessions.find((s) => s.id === e.target.value);
                if (found) handleLoadSavedSession(found.uri);
              }}
            >
              <option value={session.id}>Active / Current Session</option>
              {savedSessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {new Date(s.startTime).toLocaleTimeString()} ({s.snapshotCount} snaps)
                </option>
              ))}
            </select>
          )}

          {!isStandalone && (
            <>
              <button className="btn btn-secondary" onClick={handleRefresh} title="Reload active session data">
                🔄 Refresh
              </button>
              {session && (
                <button className="btn" onClick={handleExportHtml} title="Export as standalone self-contained HTML file">
                  📥 Export HTML Report
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {session && analytics ? (
        <>
          {/* 2. Top Metrics Row */}
          <MetricsRow analytics={analytics} />

          {/* 3. 24-Bucket Edit Activity Chart */}
          <ActivityChart
            buckets={analytics.activityBuckets}
            snapshots={session.snapshots}
            runs={session.runs}
          />

          {/* 4. Interactive Code Timelapse Player */}
          <TimelapsePlayer
            snapshots={session.snapshots}
            runs={session.runs}
            events={session.events}
            totalDurationMs={analytics.durationMs}
          />
        </>
      ) : (
        <div className="section-card empty-recording-state">
          <h2>No recording yet</h2>
          <p>
            Click <strong>CodeLapse: Choose folder</strong> in the status bar, or run{' '}
            <strong>CodeLapse: Start Recording Session</strong> from the Command Palette.
          </p>
          <p>Your report appears here once a session has been recorded.</p>
        </div>
      )}
    </div>
  );
};
