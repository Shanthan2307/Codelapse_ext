import React, { useEffect, useState } from 'react';
import { Session, computeSessionAnalytics, SessionAnalytics } from '@codelapse/core';
import { ActivityChart, MetricsRow, TimelapsePlayer } from '@codelapse/replay';
import '@codelapse/replay/styles.css';
import './app.css';

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
  | { type: 'EXPORT_BUNDLE' }
  | { type: 'OPEN_SUBMISSION_PAGE' }
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

  const send = (type: 'EXPORT_HTML' | 'EXPORT_BUNDLE' | 'OPEN_SUBMISSION_PAGE') => () => vscodeApi.postMessage({ type });

  const status = isRecording ? 'recording' : isPaused ? 'paused' : 'idle';
  const statusLabel = isRecording ? 'Recording' : isPaused ? 'Paused' : isStandalone ? 'Exported report' : 'Saved session';

  return (
    <div className="codelapse-replay codelapse-report">
    <div className="codelapse-container">
      <header className="dashboard-header">
        <div className="header-left">
          <h1 className="header-title">CodeLapse</h1>
          {session && <span className="workspace-pill" title="Recorded folder">{session.workspaceName}</span>}
          {session && (
            <span className={`status-badge ${status}`}>
              {status !== 'idle' && <span className="pulse-dot" />}
              {statusLabel}
            </span>
          )}
        </div>

        {!isStandalone && (
          <div className="header-actions">
            {session && savedSessions.length > 0 && (
              <select
                className="btn btn-secondary session-select"
                aria-label="Session to show"
                value={session.id}
                onChange={(e) => {
                  const found = savedSessions.find((s) => s.id === e.target.value);
                  if (found) handleLoadSavedSession(found.uri);
                }}
              >
                <option value={session.id}>Current session</option>
                {savedSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {new Date(s.startTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {s.snapshotCount} snapshots
                  </option>
                ))}
              </select>
            )}
            <button className="btn btn-secondary" onClick={handleRefresh} title="Reload the recorded data">
              Refresh
            </button>
            {session && (
              <>
                <button className="btn btn-secondary" onClick={send('EXPORT_HTML')} title="Save this report as one HTML file">
                  Export HTML
                </button>
                <button className="btn btn-secondary" onClick={send('OPEN_SUBMISSION_PAGE')} title="Open the assignment page to upload your work">
                  Submission Page
                </button>
                <button className="btn" onClick={send('EXPORT_BUNDLE')} title="Save the .codelapse file to upload with your code">
                  Export Assignment Bundle
                </button>
              </>
            )}
          </div>
        )}
      </header>

      {session && analytics ? (
        <>
          <MetricsRow analytics={analytics} />
          <ActivityChart buckets={analytics.activityBuckets} snapshots={session.snapshots} runs={session.runs} />
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
            Click <strong>CodeLapse: Choose folder</strong> in the status bar and pick your assignment folder. Recording starts
            straight away; your report appears here as you work.
          </p>
          <p>
            New to CodeLapse? Run <strong>CodeLapse: Get Started</strong> from the Command Palette for a short walkthrough.
          </p>
        </div>
      )}
    </div>
    </div>
  );
};
