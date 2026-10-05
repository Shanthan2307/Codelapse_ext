import type * as vscode from 'vscode';
import { IFrameworkWatcher, FrameworkType } from './types';
import { SessionManager } from '../tracker/SessionManager';

export class ReactWatcher implements IFrameworkWatcher {
  public readonly framework: FrameworkType = 'react';
  private disposables: Array<{ dispose: () => void }> = [];
  /** Last reported hook set per file, used to emit only on actual change. */
  private reportedHooks: Map<string, string> = new Map();

  constructor(private readonly sessionManager: SessionManager) {}

  /**
   * Parses terminal streams for React, Vite, Next.js, and Webpack HMR / build events.
   */
  public processTerminalOutput(terminalName: string, text: string): void {
    if (!this.sessionManager.isRecording()) {
      return;
    }

    const cleanText = text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');

    // 1. Vite HMR update: e.g. [vite] hmr update /src/App.tsx (24ms)
    const viteHmrMatch = cleanText.match(/\[vite\]\s+hmr\s+update\s+([^\s\n()]+)(?:\s+\((\d+ms)\))?/i);
    if (viteHmrMatch) {
      const file = viteHmrMatch[1];
      const time = viteHmrMatch[2] ? ` (${viteHmrMatch[2]})` : '';
      this.sessionManager.addSessionEvent({
        type: 'framework',
        timestamp: this.sessionManager.getElapsedTimeMs(),
        filePath: file,
        detail: `⚛️ [React/Vite] HMR updated: ${file}${time}`
      });
      return;
    }

    // 2. Next.js Fast Refresh & Compilation: e.g. ✓ Compiled /dashboard in 450ms
    const nextCompileMatch = cleanText.match(/(?:✓|ready|-)\s+Compiled\s+([^\s]+)\s+in\s+([\d.]+m?s)/i);
    if (nextCompileMatch) {
      const route = nextCompileMatch[1];
      const duration = nextCompileMatch[2];
      this.sessionManager.addSessionEvent({
        type: 'framework',
        timestamp: this.sessionManager.getElapsedTimeMs(),
        detail: `▲ [Next.js] Compiled route ${route} in ${duration}`
      });
      return;
    }

    // 3. Webpack / Create React App: e.g. webpack 5.x compiled successfully in 120 ms
    const webpackMatch = cleanText.match(/compiled\s+successfully\s+in\s+([\d.]+\s*(?:ms|s))/i);
    if (webpackMatch) {
      this.sessionManager.addSessionEvent({
        type: 'framework',
        timestamp: this.sessionManager.getElapsedTimeMs(),
        detail: `⚛️ [React/Webpack] Bundle compiled in ${webpackMatch[1]}`
      });
      return;
    }

    // 4. React Runtime Warnings / Errors in Console
    if (/Warning:\s+Each child in a list should have a unique "key" prop/i.test(cleanText)) {
      this.sessionManager.addSessionEvent({
        type: 'run-fail',
        timestamp: this.sessionManager.getElapsedTimeMs(),
        detail: '⚠️ [React Warning] Missing unique "key" prop in list'
      });
    } else if (/Minified React error #\d+/i.test(cleanText) || /Uncaught Error:.*React/i.test(cleanText)) {
      this.sessionManager.addSessionEvent({
        type: 'run-fail',
        timestamp: this.sessionManager.getElapsedTimeMs(),
        detail: '🚨 [React Error] Runtime render exception caught'
      });
    }
  }

  /**
   * Inspects saved React files for structural additions (Hooks, Components).
   */
  public processDocumentSaved(document: vscode.TextDocument): void {
    if (!this.sessionManager.isRecording()) return;

    const ext = document.fileName.split('.').pop()?.toLowerCase();
    if (ext !== 'tsx' && ext !== 'jsx' && ext !== 'ts' && ext !== 'js') {
      return;
    }

    const text = document.getText();
    const filePath = document.uri?.fsPath || document.fileName;

    // Detect React Hook usages
    const hooksFound = new Set<string>();
    const hookMatches = text.matchAll(/\b(use(?:State|Effect|Context|Reducer|Callback|Memo|Ref|Id|LayoutEffect))\b/g);
    for (const m of hookMatches) {
      hooksFound.add(m[1]);
    }

    if (hooksFound.size === 0) {
      return;
    }

    // Emit only when the file's hook set actually changes. Sampling randomly
    // would drop real milestones and make the same session replay differently
    // every time it is recorded.
    const signature = Array.from(hooksFound).sort().join(',');
    if (this.reportedHooks.get(filePath) === signature) {
      return;
    }
    this.reportedHooks.set(filePath, signature);

    this.sessionManager.addSessionEvent({
      type: 'framework',
      timestamp: this.sessionManager.getElapsedTimeMs(),
      filePath,
      detail: `⚛️ [React] ${filePath} uses hooks: [${signature.split(',').join(', ')}]`
    });
  }

  public dispose(): void {
    this.reportedHooks.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
