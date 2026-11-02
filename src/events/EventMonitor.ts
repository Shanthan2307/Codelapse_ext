import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { RunEvent, SessionEvent } from '../models';
import { SessionManager } from '../tracker/SessionManager';
import { RecordingScope } from '../tracker/RecordingScope';
import { isInsideFolder } from '../tracker/folderScope';
import { MAX_RUN_OUTPUT_CHARS, isRunCommand, isTaskCommand, sanitizeOutput } from './terminalRuns';

/** How long a finished terminal command may take to deliver its remaining output. */
const OUTPUT_DRAIN_TIMEOUT_MS = 1000;
/** A task's end and its terminal command's end arrive in either order, this close together. */
const TASK_COMMAND_WAIT_MS = 400;
/** How long a terminal gets to start shell integration before it counts as unrecorded. */
const SHELL_INTEGRATION_WAIT_MS = 15000;

interface RunningTask {
  name: string;
  commandLine?: string;
  startTime: number;
  /** Output of the terminal command that carried this task, once it has been matched. */
  output?: Promise<string>;
}

export class EventMonitor implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private runningTasks: Map<string, RunningTask> = new Map();
  private debugStartTimes: Map<string, { startTime: number; name: string; type: string }> = new Map();
  private shellRuns: Map<vscode.TerminalShellExecution, { startTime: number; output: Promise<string> }> = new Map();
  private terminalChecks: Map<vscode.Terminal, NodeJS.Timeout> = new Map();
  private warnedAboutTerminals = false;

  private idleTimer: NodeJS.Timeout | null = null;
  private isCurrentlyIdle: boolean = false;
  private readonly idleThresholdMs: number;

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly scope: RecordingScope,
    idleThresholdMs: number = 5 * 60 * 1000 // 5 minutes default
  ) {
    this.idleThresholdMs = idleThresholdMs;
    this.setupListeners();
    this.resetIdleTimer();
  }

  /**
   * True unless the run clearly belongs to a different project: a task or
   * debug session tied to a workspace folder that neither contains nor sits
   * inside the recorded folder. Global/workspace-wide runs are kept.
   */
  private isRunInScope(folderUri: vscode.Uri | undefined): boolean {
    return !folderUri || this.scope.overlaps(folderUri);
  }

  private taskFolder(task: vscode.Task): vscode.Uri | undefined {
    const scope = task.scope;
    return scope && typeof scope === 'object' ? scope.uri : undefined;
  }

  /**
   * Subscribes to task, debugging, terminal, and user activity events.
   */
  private setupListeners(): void {
    // 1. Task start and end processes
    const taskStartDisposable = vscode.tasks.onDidStartTaskProcess((e) => {
      this.recordActivity();
      this.runningTasks.set(this.getTaskIdentifier(e.execution.task), {
        name: e.execution.task.name,
        commandLine: taskCommandLine(e.execution.task),
        startTime: Date.now()
      });
    });

    const taskEndDisposable = vscode.tasks.onDidEndTaskProcess((e) => {
      this.recordActivity();
      void this.recordTaskRun(e);
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

      if (!this.isRunInScope(session.workspaceFolder?.uri)) {
        return;
      }

      // VS Code does not report how a debug session ended, so its result is unknown.
      const runEvent: RunEvent = {
        timestamp: this.sessionManager.getElapsedTimeMs(),
        command: `Debug [${startInfo?.type || session.type}]: ${startInfo?.name || session.name}`,
        output: `Debug session "${session.name}" ended.`,
        success: null,
        durationMs
      };

      this.sessionManager.addRunEvent(runEvent);
    });

    // 3. Commands run in the integrated terminal (needs VS Code shell integration).
    // Output is only available from the start of a command, while its command line
    // and folder are most reliable at the end, so filtering happens when it ends.
    const shellStartDisposable = vscode.window.onDidStartTerminalShellExecution((e) => {
      this.recordActivity();
      if (this.sessionManager.getState() !== 'idle') {
        this.shellRuns.set(e.execution, { startTime: Date.now(), output: collectOutput(e.execution) });
      }
    });

    const shellEndDisposable = vscode.window.onDidEndTerminalShellExecution((e) => {
      this.recordActivity();
      void this.recordShellRun(e);
    });

    // Without shell integration a terminal's commands cannot be seen at all, so
    // say so rather than let a report look like nothing was run.
    const terminalOpenDisposable = vscode.window.onDidOpenTerminal((terminal) => this.watchTerminal(terminal));
    const terminalCloseDisposable = vscode.window.onDidCloseTerminal((terminal) => this.stopWatchingTerminal(terminal));
    const terminalReadyDisposable = vscode.window.onDidChangeTerminalShellIntegration((e) =>
      this.stopWatchingTerminal(e.terminal)
    );
    const sessionStateDisposable = this.sessionManager.onSessionStateChanged(({ state }) => {
      if (state === 'recording') {
        vscode.window.terminals.forEach((terminal) => this.watchTerminal(terminal));
      }
    });

    // 4. Saving counts as activity
    const docSaveDisposable = vscode.workspace.onDidSaveTextDocument(() => {
      this.recordActivity();
    });

    // 5. Activity detection via editor typing/selection
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
      shellStartDisposable,
      shellEndDisposable,
      terminalOpenDisposable,
      terminalCloseDisposable,
      terminalReadyDisposable,
      sessionStateDisposable,
      docSaveDisposable,
      docChangeDisposable,
      selectionChangeDisposable
    );
  }

  /**
   * Resets the idle countdown when user activity is detected.
   */
  public recordActivity(): void {
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

  /** Records a finished task, with its terminal command's output when there is one. */
  private async recordTaskRun(e: vscode.TaskProcessEndEvent): Promise<void> {
    const task = e.execution.task;
    const session = this.sessionManager.getCurrentSession();
    const taskId = this.getTaskIdentifier(task);
    const running = this.runningTasks.get(taskId);
    const timestamp = this.sessionManager.getElapsedTimeMs();
    const durationMs = running ? Date.now() - running.startTime : 0;

    await new Promise((resolve) => setTimeout(resolve, TASK_COMMAND_WAIT_MS));
    const rawOutput = running?.output ? await withTimeout(running.output, OUTPUT_DRAIN_TIMEOUT_MS, '') : '';
    this.runningTasks.delete(taskId);

    if (!session || !this.isRunInScope(this.taskFolder(task))) {
      return;
    }
    // A folder switch while the output drained must not leak into the next session.
    if (this.sessionManager.getCurrentSession()?.id !== session.id) {
      return;
    }

    this.sessionManager.addRunEvent({
      timestamp,
      command: task.name,
      output:
        sanitizeOutput(rawOutput, this.recordedFolderPaths(), os.homedir()) ||
        `Task "${task.name}" finished with exit code ${e.exitCode ?? 'unknown'}`,
      success: e.exitCode === undefined ? null : e.exitCode === 0,
      durationMs
    });
  }

  /** Warns once a terminal has had long enough to start shell integration and has not. */
  private watchTerminal(terminal: vscode.Terminal): void {
    if (terminal.shellIntegration || this.terminalChecks.has(terminal) || !this.sessionManager.isRecording()) {
      return;
    }
    const timer = setTimeout(() => {
      this.terminalChecks.delete(terminal);
      const isTaskTerminal = [...this.runningTasks.values()].some((task) => isTaskCommand(terminal.name, '', task));
      const isOpen = vscode.window.terminals.includes(terminal);
      if (isOpen && !terminal.shellIntegration && !isTaskTerminal) {
        this.reportUnrecordedTerminal();
      }
    }, SHELL_INTEGRATION_WAIT_MS);
    this.terminalChecks.set(terminal, timer);
  }

  private stopWatchingTerminal(terminal: vscode.Terminal): void {
    const timer = this.terminalChecks.get(terminal);
    if (timer) {
      clearTimeout(timer);
      this.terminalChecks.delete(terminal);
    }
  }

  private reportUnrecordedTerminal(): void {
    if (!this.sessionManager.isRecording()) {
      return;
    }
    this.sessionManager.addSessionEvent({
      type: 'terminal-unrecorded',
      timestamp: this.sessionManager.getElapsedTimeMs(),
      detail: 'A terminal without shell integration was open: commands run in it were not recorded.'
    });
    if (!this.warnedAboutTerminals) {
      this.warnedAboutTerminals = true;
      void vscode.window.showWarningMessage(
        'CodeLapse cannot record commands in this terminal because VS Code shell integration is not active. ' +
          'Use bash, zsh, fish or PowerShell with "terminal.integrated.shellIntegration.enabled" turned on.'
      );
    }
  }

  /**
   * Records a finished terminal command if it ran from inside the recorded
   * folder and actually ran something (not `cd`, `ls`, `git status`, ...).
   */
  private async recordShellRun(e: vscode.TerminalShellExecutionEndEvent): Promise<void> {
    const started = this.shellRuns.get(e.execution);
    this.shellRuns.delete(e.execution);
    if (!started) {
      return;
    }

    const commandLine = e.execution.commandLine.value;

    // A task's command is the same run as the task: recordTaskRun takes its output.
    const task = [...this.runningTasks.values()].find((t) => isTaskCommand(e.terminal.name, commandLine, t));
    if (task) {
      task.output = started.output;
      return;
    }

    const session = this.sessionManager.getCurrentSession();
    const folderPaths = this.recordedFolderPaths();
    const cwd = e.execution.cwd?.fsPath;
    const inFolder = !!cwd && folderPaths.some((folder) => isInsideFolder(folder, cwd));
    if (!session || !inFolder || !isRunCommand(commandLine)) {
      return;
    }

    const timestamp = this.sessionManager.getElapsedTimeMs();
    const durationMs = Date.now() - started.startTime;
    const rawOutput = await withTimeout(started.output, OUTPUT_DRAIN_TIMEOUT_MS, '');

    // A folder switch while the output drained must not leak into the next session.
    if (this.sessionManager.getCurrentSession()?.id !== session.id) {
      return;
    }

    const homeDir = os.homedir();
    this.sessionManager.addRunEvent({
      timestamp,
      command: sanitizeOutput(commandLine, folderPaths, homeDir),
      output:
        sanitizeOutput(rawOutput, folderPaths, homeDir) ||
        `Command finished with exit code ${e.exitCode ?? 'unknown'}`,
      // Ctrl+C and shells that do not report a code leave exitCode undefined.
      success: e.exitCode === undefined ? null : e.exitCode === 0,
      durationMs
    });
  }

  /** The recorded folder as chosen and as the shell reports it (symlinks resolved). */
  private recordedFolderPaths(): string[] {
    const folder = this.scope.getFolder()?.fsPath;
    if (!folder) {
      return [];
    }
    try {
      return [folder, fs.realpathSync(folder)];
    } catch {
      return [folder];
    }
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

    this.runningTasks.clear();
    this.debugStartTimes.clear();
    this.shellRuns.clear();
    for (const timer of this.terminalChecks.values()) {
      clearTimeout(timer);
    }
    this.terminalChecks.clear();

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}

/** The command line a task runs, when it is a shell command given as one string. */
function taskCommandLine(task: vscode.Task): string | undefined {
  const execution = task.execution;
  return execution instanceof vscode.ShellExecution ? execution.commandLine?.trim() : undefined;
}

/** Reads a command's output as it arrives, holding on to only the newest part. */
async function collectOutput(execution: vscode.TerminalShellExecution): Promise<string> {
  let output = '';
  try {
    for await (const chunk of execution.read()) {
      output = (output + chunk).slice(-2 * MAX_RUN_OUTPUT_CHARS);
    }
  } catch (err) {
    console.warn('CodeLapse could not read terminal output:', err);
  }
  return output;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    void promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}
