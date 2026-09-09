import * as vscode from 'vscode';
import { RunEvent, SessionEvent } from '../models';
import { SessionManager } from '../tracker/SessionManager';

export class EventMonitor implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private taskStartTimes: Map<string, { startTime: number; command: string }> = new Map();
  private debugStartTimes: Map<string, { startTime: number; name: string; type: string }> = new Map();
  private terminalOutputs: Map<string, string[]> = new Map();

  private idleTimer: NodeJS.Timeout | null = null;
  private lastActivityTime: number = Date.now();
  private isCurrentlyIdle: boolean = false;
  private readonly idleThresholdMs: number;

  constructor(
    private readonly sessionManager: SessionManager,
    idleThresholdMs: number = 5 * 60 * 1000 // 5 minutes default
  ) {
    this.idleThresholdMs = idleThresholdMs;
    this.setupListeners();
    this.resetIdleTimer();
  }

  /**
   * Subscribes to task, debugging, terminal, and user activity events.
   */
  private setupListeners(): void {
    // 1. Task start and end processes
    const taskStartDisposable = vscode.tasks.onDidStartTaskProcess((e) => {
      this.recordActivity();
      const taskId = this.getTaskIdentifier(e.execution.task);
      this.taskStartTimes.set(taskId, {
        startTime: Date.now(),
        command: e.execution.task.name
      });
    });

    const taskEndDisposable = vscode.tasks.onDidEndTaskProcess((e) => {
      this.recordActivity();
      const taskId = this.getTaskIdentifier(e.execution.task);
      const startInfo = this.taskStartTimes.get(taskId);
      const durationMs = startInfo ? Date.now() - startInfo.startTime : 0;
      this.taskStartTimes.delete(taskId);

      const success = e.exitCode === 0;
      const recentOutput = this.getRecentTerminalOutput();

      const runEvent: RunEvent = {
        timestamp: this.sessionManager.getElapsedTimeMs(),
        command: startInfo?.command || e.execution.task.name,
        output: recentOutput || `Task "${e.execution.task.name}" finished with exit code ${e.exitCode}`,
        success,
        durationMs
      };

      this.sessionManager.addRunEvent(runEvent);
    });

    // 2. Debug sessions
    const debugStartDisposable = vscode.debug.onDidStartDebugSession((session) => {
      this.recordActivity();
      this.debugStartTimes.set(session.id, {
        startTime: Date.now(),
        name: session.name,
        type: session.type
      });
    });

    const debugEndDisposable = vscode.debug.onDidTerminateDebugSession((session) => {
      this.recordActivity();
      const startInfo = this.debugStartTimes.get(session.id);
      const durationMs = startInfo ? Date.now() - startInfo.startTime : 0;
      this.debugStartTimes.delete(session.id);

      const recentOutput = this.getRecentTerminalOutput();

      const runEvent: RunEvent = {
        timestamp: this.sessionManager.getElapsedTimeMs(),
        command: `Debug [${startInfo?.type || session.type}]: ${startInfo?.name || session.name}`,
        output: recentOutput || `Debug session "${session.name}" ended.`,
        success: true, // Default to true unless specific debug failure is intercepted
        durationMs
      };

      this.sessionManager.addRunEvent(runEvent);
    });

    // 3. Terminal Output Monitoring (where supported by VS Code API)
    if (typeof (vscode.window as any).onDidWriteTerminalData === 'function') {
      try {
        const terminalDataDisposable = (vscode.window as any).onDidWriteTerminalData(
          (e: { terminal: vscode.Terminal; data: string }) => {
            this.recordActivity();
            this.appendTerminalOutput(e.terminal.name, e.data);
          }
        );
        this.disposables.push(terminalDataDisposable);
      } catch (err) {
        console.warn('onDidWriteTerminalData listener not supported:', err);
      }
    }

    // 4. Activity detection via editor typing/selection
    const docChangeDisposable = vscode.workspace.onDidChangeTextDocument(() => {
      this.recordActivity();
    });

    const selectionChangeDisposable = vscode.window.onDidChangeTextEditorSelection(() => {
      this.recordActivity();
    });

    this.disposables.push(
      taskStartDisposable,
      taskEndDisposable,
      debugStartDisposable,
      debugEndDisposable,
      docChangeDisposable,
      selectionChangeDisposable
    );
  }

  /**
   * Resets the idle countdown when user activity is detected.
   */
  public recordActivity(): void {
    this.lastActivityTime = Date.now();

    if (this.isCurrentlyIdle) {
      this.isCurrentlyIdle = false;
      if (this.sessionManager.isRecording()) {
        this.sessionManager.addSessionEvent({
          type: 'idle',
          timestamp: this.sessionManager.getElapsedTimeMs(),
          detail: 'User resumed active coding'
        });
      }
    }

    this.resetIdleTimer();
  }

  /**
   * Resets the background idle timer.
   */
  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    this.idleTimer = setTimeout(() => {
      this.handleIdleTimeout();
    }, this.idleThresholdMs);
  }

  /**
   * Handles when the idle duration threshold is reached.
   */
  private handleIdleTimeout(): void {
    if (!this.sessionManager.isRecording() || this.isCurrentlyIdle) {
      return;
    }

    this.isCurrentlyIdle = true;
    const idleDurationMinutes = Math.round(this.idleThresholdMs / 60000);

    const idleEvent: SessionEvent = {
      type: 'idle',
      timestamp: this.sessionManager.getElapsedTimeMs(),
      detail: `Idle gap detected: no activity for ${idleDurationMinutes} minutes`
    };

    this.sessionManager.addSessionEvent(idleEvent);
  }

  /**
   * Appends terminal stream output chunks to memory buffer.
   */
  private appendTerminalOutput(terminalName: string, chunk: string): void {
    const cleanChunk = chunk.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, ''); // Strip ANSI escape codes
    if (!cleanChunk.trim()) {
      return;
    }

    const lines = this.terminalOutputs.get(terminalName) || [];
    lines.push(cleanChunk);
    if (lines.length > 100) {
      lines.shift(); // Keep only last 100 entries
    }
    this.terminalOutputs.set(terminalName, lines);
  }

  /**
   * Retrieves the most recent buffered terminal output.
   */
  private getRecentTerminalOutput(): string {
    const allRecentLines: string[] = [];
    for (const lines of this.terminalOutputs.values()) {
      allRecentLines.push(...lines.slice(-20));
    }
    return allRecentLines.join('').trim();
  }

  /**
   * Returns a unique key for tracking task lifecycle.
   */
  private getTaskIdentifier(task: vscode.Task): string {
    return `${task.source}_${task.name}_${task.scope ? JSON.stringify(task.scope) : ''}`;
  }

  /**
   * Cleans up all event listeners and background timers.
   */
  public dispose(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    this.taskStartTimes.clear();
    this.debugStartTimes.clear();
    this.terminalOutputs.clear();

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}
