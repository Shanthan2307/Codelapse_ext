import React, { useEffect, useState } from 'react';
import { Session, Snapshot, RunEvent, SessionEvent } from '../models';
import {
  computeSessionAnalytics,
  SessionAnalytics
} from '../analytics/engine';
import { MetricsRow } from './components/MetricsRow';
import { ActivityChart } from './components/ActivityChart';
import { TimelapsePlayer } from './components/TimelapsePlayer';
import './styles.css';

// VS Code API declaration
declare function acquireVsCodeApi(): {
  postMessage: (message: any) => void;
  getState: () => any;
  setState: (state: any) => void;
};

let vscodeApi: any = null;
try {
  vscodeApi = acquireVsCodeApi();
} catch {
  // Running outside VS Code webview (e.g. standard browser preview)
  vscodeApi = {
    postMessage: (msg: any) => console.log('Mock VS Code PostMessage:', msg),
    getState: () => null,
    setState: () => {}
  };
}

// Sample fallback session for demonstration & offline preview
const createMockSession = (): Session => {
  const now = Date.now();
  const snapshots: Snapshot[] = [
    {
      timestamp: 10000,
      filePath: 'src/index.ts',
      content: 'function helloWorld() {\n  console.log("Hello");\n}',
      cursorStart: 42,
      cursorEnd: 42
    },
    {
      timestamp: 35000,
      filePath: 'src/index.ts',
      content: 'function helloWorld(name: string) {\n  console.log(`Hello, ${name}!`);\n}\n\nexport default helloWorld;',
      cursorStart: 85,
      cursorEnd: 85
    },
    {
      timestamp: 70000,
      filePath: 'src/utils.ts',
      content: 'export function add(a: number, b: number): number {\n  return a + b;\n}',
      cursorStart: 60,
      cursorEnd: 60
    },
    {
      timestamp: 120000,
      filePath: 'src/utils.ts',
      content: 'export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport function multiply(a: number, b: number): number {\n  return a * b;\n}',
      cursorStart: 120,
      cursorEnd: 120
    }
  ];

  const runs: RunEvent[] = [
    {
      timestamp: 45000,
      command: 'npm test',
      output: 'PASS src/index.test.ts\nTests: 2 passed, 2 total\nTime: 1.2s',
      success: true,
      durationMs: 1200
    },
    {
      timestamp: 95000,
      command: 'npm test',
      output: 'FAIL src/utils.test.ts\nExpected 6 received NaN',
      success: false,
      durationMs: 900
    },
    {
      timestamp: 130000,
      command: 'npm test',
      output: 'PASS src/utils.test.ts\nTests: 4 passed, 4 total',
      success: true,
      durationMs: 1100
    }
  ];

  const events: SessionEvent[] = [
    { type: 'start', timestamp: 0, detail: 'Session started' },
    { type: 'run-pass', timestamp: 45000, detail: 'Test run passed' },
    { type: 'run-fail', timestamp: 95000, detail: 'Test run failed' },
    { type: 'run-pass', timestamp: 130000, detail: 'Test run passed' },
    { type: 'end', timestamp: 140000, detail: 'Session ended' }
  ];

  return {
    id: 'demo-session-001',
    workspaceName: 'CodeLapse Demo Workspace',
    startTime: now - 140000,
    endTime: now,
    snapshots,
    runs,
    events
  };
};

export const App: React.FC = () => {
  const [session, setSession] = useState<Session>(createMockSession);
  const [analytics, setAnalytics] = useState<SessionAnalytics>(() =>
    computeSessionAnalytics(createMockSession())
  );
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [savedSessions, setSavedSessions] = useState<any[]>([]);

  // IPC listener
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;
      if (!message || !message.type) return;

      switch (message.type) {
        case 'SET_SESSION_DATA': {
          if (message.payload?.session) {
            setSession(message.payload.session);
            setAnalytics(
              message.payload.analytics ||
                computeSessionAnalytics(message.payload.session)
            );
            if (message.payload.isRecording !== undefined) {
              setIsRecording(message.payload.isRecording);
            }
            if (message.payload.isPaused !== undefined) {
              setIsPaused(message.payload.isPaused);
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
  }, []);

  const handleRefresh = () => {
    vscodeApi.postMessage({ type: 'REQUEST_DATA' });
  };

  const handleLoadSavedSession = (uri: string) => {
    vscodeApi.postMessage({ type: 'LOAD_SESSION_BY_URI', payload: { uri } });
  };

  return (
    <div className="codelapse-container">
      {/* 1. Header */}
      <header className="dashboard-header">
        <div className="header-left">
          <h1 className="header-title">
            <span>⚡</span> CodeLapse Dashboard
          </h1>
          <span className="workspace-pill">{session.workspaceName}</span>
          <span
            className={`status-badge ${
              isRecording ? 'recording' : isPaused ? 'paused' : 'idle'
            }`}
          >
            <span className="pulse-dot" />
            {isRecording ? 'Recording' : isPaused ? 'Paused' : 'Saved Session'}
          </span>
        </div>

        <div className="header-actions">
          {savedSessions.length > 0 && (
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

          <button className="btn btn-secondary" onClick={handleRefresh}>
            🔄 Refresh
          </button>
        </div>
      </header>

      {/* 2. Top Metrics Row */}
      <MetricsRow analytics={analytics} />

      {/* 3. 24-Bucket Keystroke Activity Chart */}
      <ActivityChart
        buckets={analytics.activityBuckets}
        snapshots={session.snapshots}
        runs={session.runs}
      />

      {/* 4. Interactive Code Timelapse Player */}
      <TimelapsePlayer
        snapshots={session.snapshots}
        runs={session.runs}
        totalDurationMs={analytics.durationMs}
      />
    </div>
  );
};
