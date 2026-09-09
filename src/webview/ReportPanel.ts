import * as vscode from 'vscode';
import { Session } from '../models';
import { computeSessionAnalytics, SessionAnalytics } from '../analytics/engine';
import { SessionManager } from '../tracker/SessionManager';

export class ReportPanel {
  public static currentPanel: ReportPanel | undefined;
  public static readonly viewType = 'codelapseReport';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _sessionManager: SessionManager;
  private _targetSession: Session | null = null;
  private _disposables: vscode.Disposable[] = [];

  /**
   * Creates or reveals the webview report panel.
   */
  public static createOrShow(
    extensionUri: vscode.Uri,
    sessionManager: SessionManager,
    targetSession?: Session
  ): ReportPanel {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If panel already exists, reveal it and send updated data
    if (ReportPanel.currentPanel) {
      ReportPanel.currentPanel._panel.reveal(column || vscode.ViewColumn.One);
      if (targetSession) {
        ReportPanel.currentPanel.setSession(targetSession);
      } else {
        ReportPanel.currentPanel.refreshCurrentSession();
      }
      return ReportPanel.currentPanel;
    }

    // Otherwise create a new webview panel
    const panel = vscode.window.createWebviewPanel(
      ReportPanel.viewType,
      'CodeLapse: Analytics & Replay',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist')
        ]
      }
    );

    ReportPanel.currentPanel = new ReportPanel(
      panel,
      extensionUri,
      sessionManager,
      targetSession
    );

    return ReportPanel.currentPanel;
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    sessionManager: SessionManager,
    initialSession?: Session
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._sessionManager = sessionManager;
    this._targetSession = initialSession || sessionManager.getCurrentSession();

    // Set webview initial HTML content
    this._update();

    // Listen for when the panel is disposed (closed by the user)
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    // Update the content based on view state changes
    this._panel.onDidChangeViewState(
      () => {
        if (this._panel.visible) {
          this.refreshCurrentSession();
        }
      },
      null,
      this._disposables
    );

    // Set up two-way IPC message passing from webview to extension host
    this._panel.webview.onDidReceiveMessage(
      (message) => this._handleWebviewMessage(message),
      null,
      this._disposables
    );

    // Listen to live session updates from SessionManager if currently recording
    const sessionUpdateSub = this._sessionManager.onSessionUpdated((session) => {
      if (!this._targetSession || this._targetSession.id === session.id) {
        this._targetSession = session;
        this.sendSessionData(session);
      }
    });

    this._disposables.push(sessionUpdateSub);
  }

  /**
   * Sets a specific session to display and pushes data to webview.
   */
  public setSession(session: Session): void {
    this._targetSession = session;
    this.sendSessionData(session);
  }

  /**
   * Refreshes and sends the active session or latest saved session.
   */
  public async refreshCurrentSession(): Promise<void> {
    const active = this._sessionManager.getCurrentSession();
    if (active) {
      this._targetSession = active;
      this.sendSessionData(active);
      return;
    }

    if (this._targetSession) {
      this.sendSessionData(this._targetSession);
      return;
    }

    // Try loading the latest session file from storage
    const saved = await this._sessionManager.listSavedSessions();
    if (saved.length > 0) {
      const latest = await this._sessionManager.loadSession(saved[0]);
      if (latest) {
        this._targetSession = latest;
        this.sendSessionData(latest);
      }
    }
  }

  /**
   * Computes analytics and sends the complete session payload across the IPC bridge to React.
   */
  public sendSessionData(session: Session): void {
    const analytics: SessionAnalytics = computeSessionAnalytics(session);
    this._panel.webview.postMessage({
      type: 'SET_SESSION_DATA',
      payload: {
        session,
        analytics,
        isRecording: this._sessionManager.isRecording(),
        isPaused: this._sessionManager.isPaused()
      }
    });
  }

  /**
   * Sends the list of available saved session files to the webview.
   */
  public async sendSavedSessionsList(): Promise<void> {
    const fileUris = await this._sessionManager.listSavedSessions();
    const sessionsMetadata = [];

    for (const uri of fileUris) {
      const session = await this._sessionManager.loadSession(uri);
      if (session) {
        sessionsMetadata.push({
          id: session.id,
          workspaceName: session.workspaceName,
          startTime: session.startTime,
          endTime: session.endTime,
          snapshotCount: session.snapshots.length,
          runCount: session.runs.length,
          uri: uri.toString()
        });
      }
    }

    this._panel.webview.postMessage({
      type: 'SET_SAVED_SESSIONS_LIST',
      payload: { sessions: sessionsMetadata }
    });
  }

  /**
   * Handles incoming IPC messages from the React Webview.
   */
  private async _handleWebviewMessage(message: { type: string; payload?: any }): Promise<void> {
    switch (message.type) {
      case 'READY':
      case 'REQUEST_DATA': {
        await this.refreshCurrentSession();
        await this.sendSavedSessionsList();
        break;
      }

      case 'REQUEST_SAVED_SESSIONS': {
        await this.sendSavedSessionsList();
        break;
      }

      case 'LOAD_SESSION_BY_URI': {
        if (message.payload?.uri) {
          const uri = vscode.Uri.parse(message.payload.uri);
          const session = await this._sessionManager.loadSession(uri);
          if (session) {
            this.setSession(session);
          }
        }
        break;
      }

      case 'SHOW_MESSAGE': {
        const text = message.payload?.message || '';
        const level = message.payload?.level || 'info';
        if (level === 'error') {
          vscode.window.showErrorMessage(text);
        } else if (level === 'warn') {
          vscode.window.showWarningMessage(text);
        } else {
          vscode.window.showInformationMessage(text);
        }
        break;
      }

      default:
        console.warn('Unhandled webview message type:', message.type);
    }
  }

  /**
   * Generates and updates the webview HTML shell.
   */
  private _update(): void {
    this._panel.title = 'CodeLapse Analytics';
    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);
  }

  /**
   * Renders the HTML template embedding the compiled React bundle with secure CSP.
   */
  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptPathOnDisk = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview.js');
    const scriptUri = webview.asWebviewUri(scriptPathOnDisk);
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} https: data:;">
  <title>CodeLapse Replay & Analytics</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  /**
   * Disposes of webview resources.
   */
  public dispose(): void {
    ReportPanel.currentPanel = undefined;
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
