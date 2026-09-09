import * as vscode from 'vscode';
import { SessionManager } from './tracker/SessionManager';
import { DocumentTracker } from './tracker/DocumentTracker';
import { EventMonitor } from './events/EventMonitor';
import { ReportPanel } from './webview/ReportPanel';
import { ReportExporter } from './export/ReportExporter';

let sessionManager: SessionManager;
let documentTracker: DocumentTracker;
let eventMonitor: EventMonitor;
let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  console.log('CodeLapse extension activating...');

  // Initialize components
  sessionManager = new SessionManager(context);
  documentTracker = new DocumentTracker(sessionManager);
  eventMonitor = new EventMonitor(sessionManager);

  // Status Bar Item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'codelapse.showReport';
  context.subscriptions.push(statusBarItem);

  const updateStatusBar = () => {
    if (sessionManager.isRecording()) {
      statusBarItem.text = '$(record) CodeLapse: Recording';
      statusBarItem.tooltip = 'CodeLapse is actively recording workspace activity. Click to open report.';
      statusBarItem.show();
    } else if (sessionManager.isPaused()) {
      statusBarItem.text = '$(debug-pause) CodeLapse: Paused';
      statusBarItem.tooltip = 'CodeLapse recording is paused. Click to open report.';
      statusBarItem.show();
    } else {
      statusBarItem.text = '$(history) CodeLapse: Idle';
      statusBarItem.tooltip = 'CodeLapse recording is idle. Click to open report/start session.';
      statusBarItem.show();
    }
  };

  sessionManager.onSessionStateChanged(() => {
    updateStatusBar();
  });
  updateStatusBar();

  // Register Commands
  const startCmd = vscode.commands.registerCommand('codelapse.startSession', async () => {
    const session = await sessionManager.start();
    documentTracker.captureInitialOpenDocuments();
    vscode.window.showInformationMessage(`CodeLapse: Started recording session "${session.id}".`);
    updateStatusBar();
  });

  const stopCmd = vscode.commands.registerCommand('codelapse.stopSession', async () => {
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
  });

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

  context.subscriptions.push(
    startCmd,
    stopCmd,
    showReportCmd,
    exportHtmlCmd,
    openReplayCmd,
    sessionManager,
    documentTracker,
    eventMonitor
  );

  // Auto-start recording on activation for continuous passive tracking
  sessionManager.start().then(() => {
    documentTracker.captureInitialOpenDocuments();
  }).catch((err) => {
    console.error('Failed to auto-start CodeLapse recording session:', err);
  });
}

export function deactivate() {
  if (documentTracker) {
    documentTracker.flushPending();
    documentTracker.dispose();
  }
  if (eventMonitor) {
    eventMonitor.dispose();
  }
  if (sessionManager) {
    sessionManager.dispose();
  }
}
