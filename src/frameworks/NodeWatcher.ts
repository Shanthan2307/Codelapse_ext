import type * as vscode from 'vscode';
import { IFrameworkWatcher, FrameworkType } from './types';
import { SessionManager } from '../tracker/SessionManager';

export class NodeWatcher implements IFrameworkWatcher {
  public readonly framework: FrameworkType = 'node';
  private disposables: Array<{ dispose: () => void }> = [];

  constructor(private readonly sessionManager: SessionManager) {}

  /**
   * Parses terminal streams for Node.js lifecycle, nodemon restarts, package installs, and server ports.
   */
  public processTerminalOutput(terminalName: string, text: string): void {
    if (!this.sessionManager.isRecording()) {
      return;
    }

    const cleanText = text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');

    // 1. Nodemon / TSX Watch / Node --watch restarts
    if (/\[nodemon\]\s+restarting due to changes\.\.\./i.test(cleanText)) {
      this.sessionManager.addSessionEvent({
        type: 'framework',
        timestamp: this.sessionManager.getElapsedTimeMs(),
        detail: '🟢 [Node/Nodemon] Server restarting due to code changes'
      });
      return;
    }

    if (/\[nodemon\]\s+clean exit/i.test(cleanText)) {
      this.sessionManager.addSessionEvent({
        type: 'framework',
        timestamp: this.sessionManager.getElapsedTimeMs(),
        detail: '🟢 [Node/Nodemon] Server stopped cleanly'
      });
      return;
    }

    // 2. Server listening port detection: e.g. Server running at http://localhost:4000
    const serverPortMatch = cleanText.match(/(?:server|listening|app|running)(?: is| on)?\s*(?:at|on|port)?\s*(?:http:\/\/localhost:|https:\/\/localhost:|port\s*)(\d{3,5})/i);
    if (serverPortMatch) {
      const port = serverPortMatch[1];
      this.sessionManager.addSessionEvent({
        type: 'run-pass',
        timestamp: this.sessionManager.getElapsedTimeMs(),
        detail: `🚀 [Node Server] Listening on port :${port}`
      });
      return;
    }

    // 3. NPM / Yarn / PNPM package additions: e.g. added 14 packages in 2s
    const packageAddMatch = cleanText.match(/(?:added|installed)\s+(\d+)\s+packages?(?:\s+in\s+([\d.]+m?s))?/i);
    if (packageAddMatch) {
      const count = packageAddMatch[1];
      const duration = packageAddMatch[2] ? ` (${packageAddMatch[2]})` : '';
      this.sessionManager.addSessionEvent({
        type: 'framework',
        timestamp: this.sessionManager.getElapsedTimeMs(),
        detail: `📦 [Node/NPM] Installed ${count} packages${duration}`
      });
      return;
    }

    // 4. Node.js Uncaught Exception / Unhandled Promise Rejection
    if (/UnhandledPromiseRejection|TypeError:|ReferenceError:|SyntaxError:\s/i.test(cleanText)) {
      const firstLine = cleanText.split('\n').find(l => /Error:/i.test(l)) || 'Node runtime error';
      this.sessionManager.addSessionEvent({
        type: 'run-fail',
        timestamp: this.sessionManager.getElapsedTimeMs(),
        detail: `🚨 [Node Error] ${firstLine.trim().substring(0, 80)}`
      });
    }
  }

  public dispose(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
