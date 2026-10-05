import * as vscode from 'vscode';
import { Session, Snapshot, RunEvent, SessionEvent } from '../models';
import { DeltaSnapshot, DeltaEngine } from './DeltaEngine';
import { LogStreamer, LogRecord } from '../storage/LogStreamer';

export type SessionState = 'idle' | 'recording' | 'paused';

export class SessionManager {
  private currentSession: Session | null = null;
  private state: SessionState = 'idle';
  private storageUri: vscode.Uri;
  private currentSessionUri: vscode.Uri | null = null;
  private currentLogStreamer: LogStreamer = new LogStreamer();
  /**
   * Running full text of every tracked file, keyed by workspace-relative path.
   * Deltas (P-Frames) only carry a diff, so the previous content of the same file
   * is required as the baseline to materialize a usable in-memory Snapshot.
   */
  private liveFileContents: Map<string, string> = new Map();
  private flushTimer: NodeJS.Timeout | null = null;
  private flushIntervalMs: number = 5000;
  private isDirty: boolean = false;
  private isDisposed: boolean = false;

  private readonly _onSessionStateChanged = new vscode.EventEmitter<{
    state: SessionState;
    session: Session | null;
  }>();
  public readonly onSessionStateChanged = this._onSessionStateChanged.event;

  private readonly _onSessionUpdated = new vscode.EventEmitter<Session>();
  public readonly onSessionUpdated = this._onSessionUpdated.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    flushIntervalMs: number = 5000
  ) {
    this.storageUri = context.globalStorageUri;
    this.flushIntervalMs = flushIntervalMs;
  }

  /**
   * Ensures that the local storage directory exists.
   */
  public async ensureStorageDirectory(): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(this.storageUri);
    } catch (err) {
      console.error('Failed to create CodeLapse global storage directory:', err);
    }
  }

  /**
   * Starts a new recording session.
   */
  public async start(workspaceName?: string): Promise<Session> {
    if (this.state === 'recording') {
      console.warn('Session is already recording.');
      return this.currentSession!;
    }

    await this.ensureStorageDirectory();

    const now = Date.now();
    const wsName =
      workspaceName ||
      vscode.workspace.name ||
      (vscode.workspace.workspaceFolders?.[0]?.name ?? 'Untitled Workspace');

    const sessionId = `session_${now}_${Math.random().toString(36).substring(2, 9)}`;

    const initialEvent: SessionEvent = {
      type: 'start',
      timestamp: 0,
      detail: `Session started in workspace: ${wsName}`
    };

    this.currentSession = {
      id: sessionId,
      workspaceName: wsName,
      startTime: now,
      snapshots: [],
      runs: [],
      events: [initialEvent]
    };

    this.liveFileContents.clear();

    const fileName = `codelapse-${now}.json`;
    const logFileName = `codelapse-${now}.jsonl`;
    this.currentSessionUri = vscode.Uri.joinPath(this.storageUri, fileName);
    const logUri = vscode.Uri.joinPath(this.storageUri, logFileName);

    // Open append-only log stream for O(1) non-blocking writes
    await this.currentLogStreamer.open(logUri);
    this.currentLogStreamer.append({
      type: 'session_start',
      timestamp: now,
      data: { id: sessionId, workspaceName: wsName, startTime: now }
    });
    this.currentLogStreamer.append({
      type: 'event',
      timestamp: 0,
      data: initialEvent
    });

    this.state = 'recording';
    this.isDirty = true;

    this.startPeriodicFlush();
    await this.flush();

    this._onSessionStateChanged.fire({
      state: this.state,
      session: this.currentSession
    });

    return this.currentSession;
  }

  /**
   * Pauses the active recording session.
   */
  public async pause(): Promise<void> {
    if (this.state !== 'recording' || !this.currentSession) {
      return;
    }

    this.state = 'paused';
    const elapsed = Date.now() - this.currentSession.startTime;
    const pauseEvent: SessionEvent = {
      type: 'idle',
      timestamp: elapsed,
      detail: 'Session tracking paused'
    };
    this.addSessionEvent(pauseEvent);

    await this.flush();

    this._onSessionStateChanged.fire({
      state: this.state,
      session: this.currentSession
    });
  }

  /**
   * Resumes the paused recording session.
   */
  public async resume(): Promise<void> {
    if (this.state !== 'paused' || !this.currentSession) {
      return;
    }

    this.state = 'recording';
    const elapsed = Date.now() - this.currentSession.startTime;
    const resumeEvent: SessionEvent = {
      type: 'idle',
      timestamp: elapsed,
      detail: 'Session tracking resumed'
    };
    this.addSessionEvent(resumeEvent);

    this._onSessionStateChanged.fire({
      state: this.state,
      session: this.currentSession
    });
  }

  /**
   * Ends the current recording session and writes final data to disk.
   */
  public async end(): Promise<Session | null> {
    if (this.state === 'idle' || !this.currentSession) {
      return null;
    }

    this.stopPeriodicFlush();

    const now = Date.now();
    const elapsed = now - this.currentSession.startTime;

    this.currentSession.endTime = now;
    const endEvent: SessionEvent = {
      type: 'end',
      timestamp: elapsed,
      detail: `Session ended. Total duration: ${Math.round(elapsed / 1000)}s`
    };
    this.addSessionEvent(endEvent);

    this.currentLogStreamer.append({
      type: 'session_end',
      timestamp: elapsed,
      data: { endTime: now }
    });
    await this.currentLogStreamer.close();

    const finishedSession = this.currentSession;
    this.state = 'idle';
    this.isDirty = true;

    await this.flush();

    this._onSessionStateChanged.fire({
      state: this.state,
      session: finishedSession
    });

    this.currentSession = null;
    this.currentSessionUri = null;
    this.liveFileContents.clear();

    return finishedSession;
  }

  /**
   * Adds a high-performance delta/keyframe snapshot to the active session and log stream.
   */
  public addDeltaSnapshot(delta: DeltaSnapshot): void {
    if (this.state !== 'recording' || !this.currentSession) {
      return;
    }

    this.currentLogStreamer.append({
      type: delta.isKeyframe ? 'keyframe' : 'delta',
      timestamp: delta.timestamp,
      data: delta
    });

    // Materialize to snapshot for the in-memory active session view.
    // A keyframe carries the full text; a delta must be folded onto the previous
    // content of that same file, otherwise the snapshot would contain only the
    // freshly inserted characters instead of the whole document.
    const baseline = this.liveFileContents.get(delta.filePath) ?? '';
    const content = DeltaEngine.foldDelta(baseline, delta);
    this.liveFileContents.set(delta.filePath, content);

    const snapshot: Snapshot = {
      timestamp: delta.timestamp,
      filePath: delta.filePath,
      content,
      cursorStart: delta.cursorStart,
      cursorEnd: delta.cursorEnd
    };

    this.addSnapshot(snapshot);
  }

  /**
   * Adds a materialized file snapshot to the active session.
   */
  public addSnapshot(snapshot: Snapshot): void {
    if (this.state !== 'recording' || !this.currentSession) {
      return;
    }

    this.currentSession.snapshots.push(snapshot);
    this.isDirty = true;
    this._onSessionUpdated.fire(this.currentSession);
  }

  /**
   * Adds a terminal/debugger execution run event to the session.
   */
  public addRunEvent(run: RunEvent): void {
    if (!this.currentSession || this.state === 'idle') {
      return;
    }

    this.currentSession.runs.push(run);
    this.currentLogStreamer.append({
      type: 'run',
      timestamp: run.timestamp,
      data: run
    });

    // Auto-record milestone session event
    this.addSessionEvent({
      type: run.success ? 'run-pass' : 'run-fail',
      timestamp: run.timestamp,
      detail: run.command ? `Command: ${run.command}` : (run.success ? 'Run passed' : 'Run failed')
    });

    this.isDirty = true;
    this._onSessionUpdated.fire(this.currentSession);
  }

  /**
   * Adds a milestone or lifecycle event to the session.
   */
  public addSessionEvent(event: SessionEvent): void {
    if (!this.currentSession || this.state === 'idle') {
      return;
    }

    this.currentSession.events.push(event);
    this.currentLogStreamer.append({
      type: 'event',
      timestamp: event.timestamp,
      data: event
    });

    this.isDirty = true;
    this._onSessionUpdated.fire(this.currentSession);
  }

  /**
   * Flushes the current session in-memory state to disk.
   */
  public async flush(): Promise<void> {
    if (!this.currentSession || !this.currentSessionUri || !this.isDirty) {
      return;
    }

    try {
      const jsonContent = JSON.stringify(this.currentSession, null, 2);
      const data = new TextEncoder().encode(jsonContent);
      await vscode.workspace.fs.writeFile(this.currentSessionUri, data);
      this.isDirty = false;
    } catch (err) {
      console.error(`Failed to flush CodeLapse session to ${this.currentSessionUri.fsPath}:`, err);
    }
  }

  /**
   * Lists all stored session files in globalStorageUri.
   */
  public async listSavedSessions(): Promise<vscode.Uri[]> {
    await this.ensureStorageDirectory();
    try {
      const entries = await vscode.workspace.fs.readDirectory(this.storageUri);
      const uriMap = new Map<string, vscode.Uri>();

      for (const [name, type] of entries) {
        if (type === vscode.FileType.File && name.startsWith('codelapse-') && (name.endsWith('.json') || name.endsWith('.jsonl'))) {
          const base = name.replace(/\.jsonl?$/, '');
          const uri = vscode.Uri.joinPath(this.storageUri, name);
          // Prefer .jsonl if both exist, or .json
          if (!uriMap.has(base) || name.endsWith('.jsonl')) {
            uriMap.set(base, uri);
          }
        }
      }

      return Array.from(uriMap.values()).sort((a, b) => b.fsPath.localeCompare(a.fsPath));
    } catch (err) {
      console.error('Failed to list saved CodeLapse sessions:', err);
      return [];
    }
  }

  /**
   * Loads and parses a session file (either JSON or JSONL) from disk.
   */
  public async loadSession(fileUri: vscode.Uri): Promise<Session | null> {
    try {
      if (fileUri.fsPath.endsWith('.jsonl')) {
        return await LogStreamer.readSessionFromLog(fileUri);
      }

      const data = await vscode.workspace.fs.readFile(fileUri);
      const jsonText = new TextDecoder().decode(data);
      return JSON.parse(jsonText) as Session;
    } catch (err) {
      console.error(`Failed to load session from ${fileUri.fsPath}:`, err);
      return null;
    }
  }

  /**
   * Gets the current session object.
   */
  public getCurrentSession(): Session | null {
    return this.currentSession;
  }

  /**
   * Gets the current session state.
   */
  public getState(): SessionState {
    return this.state;
  }

  /**
   * Returns whether recording is currently active.
   */
  public isRecording(): boolean {
    return this.state === 'recording';
  }

  /**
   * Returns whether recording is currently paused.
   */
  public isPaused(): boolean {
    return this.state === 'paused';
  }

  /**
   * Returns milliseconds elapsed since the active session started.
   */
  public getElapsedTimeMs(): number {
    if (!this.currentSession) {
      return 0;
    }
    return Date.now() - this.currentSession.startTime;
  }

  /**
   * Starts background timer for periodic serialization.
   */
  private startPeriodicFlush(): void {
    this.stopPeriodicFlush();
    this.flushTimer = setInterval(() => {
      if (this.isDirty) {
        this.flush().catch((err) =>
          console.error('Periodic flush error:', err)
        );
      }
    }, this.flushIntervalMs);
  }

  /**
   * Stops background flush timer.
   */
  private stopPeriodicFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Disposes timers, log streamers, and flushes unwritten session changes.
   */
  public async dispose(): Promise<void> {
    // dispose() is reachable twice: once via context.subscriptions and once via
    // deactivate(). Guard so the second call cannot re-end an already-ended
    // session or fire events off disposed emitters.
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;

    this.stopPeriodicFlush();
    if (this.state === 'recording' || this.state === 'paused') {
      await this.end();
    } else {
      await this.flush();
    }
    await this.currentLogStreamer.close();
    this._onSessionStateChanged.dispose();
    this._onSessionUpdated.dispose();
  }
}
