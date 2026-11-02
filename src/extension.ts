import * as vscode from 'vscode';
import * as path from 'path';
import { Session } from './models';
import { SessionManager } from './tracker/SessionManager';
import { DocumentTracker } from './tracker/DocumentTracker';
import { RecordingScope } from './tracker/RecordingScope';
import { EventMonitor } from './events/EventMonitor';
import { ReportPanel } from './webview/ReportPanel';
import { ReportExporter } from './export/ReportExporter';
import { SubmissionExporter, SubmissionOptions } from './export/SubmissionExporter';

/** workspaceState key: the "choose a folder" prompt is shown once per workspace. */
const PROMPTED_KEY = 'codelapse.folderPromptShown';

let sessionManager: SessionManager;
let recordingScope: RecordingScope;
let documentTracker: DocumentTracker;
let eventMonitor: EventMonitor;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  console.log('CodeLapse extension activating...');

  // Initialize components
  sessionManager = new SessionManager(context);
  recordingScope = new RecordingScope(context);
  documentTracker = new DocumentTracker(sessionManager, recordingScope);
  eventMonitor = new EventMonitor(sessionManager, recordingScope);

  // Status Bar Item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  context.subscriptions.push(statusBarItem);

  const updateStatusBar = () => {
    const folderName = recordingScope.getFolderName();
    if (sessionManager.isRecording()) {
      statusBarItem.text = `$(record) CodeLapse: ${folderName}`;
      statusBarItem.tooltip = `Recording changes inside "${folderName}" only. Click to open the report.`;
      statusBarItem.command = 'codelapse.showReport';
    } else if (sessionManager.isPaused()) {
      statusBarItem.text = `$(debug-pause) CodeLapse: Paused (${folderName})`;
      statusBarItem.tooltip = 'CodeLapse recording is paused. Click to open the report.';
      statusBarItem.command = 'codelapse.showReport';
    } else if (!folderName) {
      statusBarItem.text = '$(circle-large-outline) CodeLapse: Choose folder';
      statusBarItem.tooltip = 'Not recording. Click to choose the folder you are working in.';
      statusBarItem.command = 'codelapse.selectFolder';
    } else {
      statusBarItem.text = '$(circle-large-outline) CodeLapse: Not recording';
      statusBarItem.tooltip = `Click to start recording "${folderName}".`;
      statusBarItem.command = 'codelapse.startSession';
    }
    statusBarItem.show();
  };

  sessionManager.onSessionStateChanged(() => {
    updateStatusBar();
  });
  recordingScope.onDidChange(() => {
    updateStatusBar();
  });
  updateStatusBar();

  /**
   * Starts a fresh session limited to `folder`. A session belongs to exactly
   * one folder, so any session already running is saved and ended first.
   */
  const startRecordingIn = async (folder: vscode.Uri): Promise<Session> => {
    if (sessionManager.getState() !== 'idle') {
      documentTracker.flushPending();
      await sessionManager.end();
    }
    await recordingScope.setFolder(folder);
    const session = await sessionManager.start(recordingScope.getFolderName() ?? undefined);
    documentTracker.captureInitialOpenDocuments();
    updateStatusBar();
    return session;
  };

  const announceRecording = (prefix: string = '') => {
    const name = recordingScope.getFolderName();
    vscode.window
      .showInformationMessage(
        `CodeLapse: ${prefix}Recording "${name}". Only files inside this folder are recorded.`,
        'Change Folder'
      )
      .then((choice) => {
        if (choice === 'Change Folder') {
          vscode.commands.executeCommand('codelapse.selectFolder');
        }
      });
  };

  // Register Commands
  const startCmd = vscode.commands.registerCommand(
    'codelapse.startSession',
    async (): Promise<Session | undefined> => {
      if (sessionManager.isRecording()) {
        vscode.window.showInformationMessage(
          `CodeLapse: Already recording "${recordingScope.getFolderName()}". ` +
            'Use "CodeLapse: Choose Folder to Record" to switch folders.'
        );
        return sessionManager.getCurrentSession() ?? undefined;
      }

      const folder = recordingScope.getFolder() ?? (await recordingScope.pickFolder());
      if (!folder) {
        return undefined;
      }
      const session = await startRecordingIn(folder);
      announceRecording();
      return session;
    }
  );

  // Also reachable from the Explorer's right-click menu, which passes the folder.
  const selectFolderCmd = vscode.commands.registerCommand(
    'codelapse.selectFolder',
    async (uri?: vscode.Uri): Promise<Session | undefined> => {
      const folder = uri instanceof vscode.Uri ? uri : await recordingScope.pickFolder();
      if (!folder) {
        return undefined;
      }

      const previous = recordingScope.getFolder();
      if (sessionManager.isRecording() && previous?.toString() === folder.toString()) {
        vscode.window.showInformationMessage(
          `CodeLapse: Already recording "${recordingScope.getFolderName()}".`
        );
        return sessionManager.getCurrentSession() ?? undefined;
      }

      const previousName = sessionManager.isRecording() ? recordingScope.getFolderName() : null;
      const session = await startRecordingIn(folder);
      announceRecording(previousName ? `Saved the "${previousName}" session. ` : '');
      return session;
    }
  );

  const stopCmd = vscode.commands.registerCommand(
    'codelapse.stopSession',
    async (): Promise<Session | undefined> => {
      documentTracker.flushPending();
      const session = await sessionManager.end();
      if (session) {
        vscode.window.showInformationMessage(
          `CodeLapse: Session recording stopped (${session.snapshots.length} snapshots saved).`
        );
        ReportPanel.createOrShow(context.extensionUri, sessionManager, session);
      } else {
        vscode.window.showInformationMessage('CodeLapse: No active recording session.');
      }
      updateStatusBar();
      return session ?? undefined;
    }
  );

  const showReportCmd = vscode.commands.registerCommand('codelapse.showReport', () => {
    ReportPanel.createOrShow(context.extensionUri, sessionManager);
  });

  const exportHtmlCmd = vscode.commands.registerCommand('codelapse.exportHtmlReport', async () => {
    const activeSession = sessionManager.getCurrentSession();
    if (activeSession) {
      await ReportExporter.exportStandaloneHtml(context.extensionUri, activeSession);
    } else {
      const saved = await sessionManager.listSavedSessions();
      if (saved.length > 0) {
        const latest = await sessionManager.loadSession(saved[0]);
        if (latest) {
          await ReportExporter.exportStandaloneHtml(context.extensionUri, latest);
          return;
        }
      }
      vscode.window.showWarningMessage('CodeLapse: No session data available to export.');
    }
  });

  const openReplayCmd = vscode.commands.registerCommand('codelapse.openReplay', () => {
    ReportPanel.createOrShow(context.extensionUri, sessionManager);
  });

  const saveDataCmd = vscode.commands.registerCommand(
    'codelapse.exportForSubmission',
    async (options?: SubmissionOptions): Promise<vscode.Uri | undefined> => {
      const interactive = !options?.destination;

      // A running session's log is still being written: end it first so the
      // copied files are complete.
      if (sessionManager.getState() !== 'idle') {
        if (interactive) {
          const choice = await vscode.window.showWarningMessage(
            'CodeLapse needs to stop the current recording before saving its data.',
            { modal: true },
            'Stop and Continue'
          );
          if (choice !== 'Stop and Continue') {
            return undefined;
          }
        }
        documentTracker.flushPending();
        await sessionManager.end();
        updateStatusBar();
      }

      const target = await SubmissionExporter.run(
        context.extensionUri,
        sessionManager,
        recordingScope.getFolderName(),
        options
      );

      if (target && interactive) {
        await vscode.commands.executeCommand('revealFileInOS', target);
        vscode.window.showInformationMessage(
          `CodeLapse: Saved session data and HTML reports to "${path.basename(target.fsPath)}".`
        );
      }
      return target;
    }
  );

  context.subscriptions.push(
    startCmd,
    selectFolderCmd,
    stopCmd,
    showReportCmd,
    exportHtmlCmd,
    openReplayCmd,
    saveDataCmd,
    sessionManager,
    recordingScope,
    documentTracker,
    eventMonitor
  );

  // Nothing is recorded until a folder has been chosen. If one was chosen
  // earlier in this workspace, resume recording it; otherwise ask once.
  recordingScope
    .restore()
    .then(async (folder) => {
      if (folder) {
        await startRecordingIn(folder);
        return;
      }
      updateStatusBar();

      const hasOpenFolder = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
      if (hasOpenFolder && !context.workspaceState.get<boolean>(PROMPTED_KEY)) {
        await context.workspaceState.update(PROMPTED_KEY, true);
        const choice = await vscode.window.showInformationMessage(
          'CodeLapse is not recording yet. Choose the folder you are working in, and only files inside it will be recorded.',
          'Choose Folder'
        );
        if (choice === 'Choose Folder') {
          await vscode.commands.executeCommand('codelapse.selectFolder');
        }
      }
    })
    .catch((err) => {
      console.error('Failed to restore CodeLapse recording folder:', err);
    });
}

export async function deactivate(): Promise<void> {
  if (documentTracker) {
    documentTracker.flushPending();
    documentTracker.dispose();
  }
  if (eventMonitor) {
    eventMonitor.dispose();
  }
  if (sessionManager) {
    // VS Code awaits the promise returned by deactivate(), so returning this
    // guarantees the final session flush and log-stream close complete before
    // the extension host tears the process down.
    await sessionManager.dispose();
  }
}
