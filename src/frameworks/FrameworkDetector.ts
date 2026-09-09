import * as vscode from 'vscode';
import { IFrameworkWatcher, FrameworkType } from './types';
import { ReactWatcher } from './ReactWatcher';
import { NodeWatcher } from './NodeWatcher';
import { DjangoWatcher } from './DjangoWatcher';
import { SessionManager } from '../tracker/SessionManager';

export class FrameworkDetector implements vscode.Disposable {
  private activeWatchers: Map<FrameworkType, IFrameworkWatcher> = new Map();
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly sessionManager: SessionManager) {}

  /**
   * Scans workspace root folders and activates corresponding framework watchers.
   */
  public async initialize(): Promise<FrameworkType[]> {
    const detected: FrameworkType[] = [];

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      // Default to enabling Node and React watchers for generic JavaScript/TypeScript workspaces
      this.enableWatcher('node');
      this.enableWatcher('react');
      return ['node', 'react'];
    }

    for (const folder of workspaceFolders) {
      const detectedInFolder = await this.scanFolder(folder.uri);
      for (const f of detectedInFolder) {
        if (!detected.includes(f)) {
          detected.push(f);
          this.enableWatcher(f);
        }
      }
    }

    // If none detected explicitly, activate all 3 for passive listening
    if (detected.length === 0) {
      this.enableWatcher('node');
      this.enableWatcher('react');
      this.enableWatcher('django');
      return ['node', 'react', 'django'];
    }

    return detected;
  }

  /**
   * Scans a specific folder for framework manifest files.
   */
  private async scanFolder(uri: vscode.Uri): Promise<FrameworkType[]> {
    const frameworks: FrameworkType[] = [];

    try {
      const entries = await vscode.workspace.fs.readDirectory(uri);
      const fileNames = entries.map(([name]) => name.toLowerCase());

      // 1. Check for Node & React in package.json
      if (fileNames.includes('package.json')) {
        frameworks.push('node');
        try {
          const pkgUri = vscode.Uri.joinPath(uri, 'package.json');
          const data = await vscode.workspace.fs.readFile(pkgUri);
          const pkgJson = JSON.parse(new TextDecoder().decode(data));
          const allDeps = {
            ...pkgJson.dependencies,
            ...pkgJson.devDependencies
          };

          if (
            allDeps['react'] ||
            allDeps['react-dom'] ||
            allDeps['next'] ||
            allDeps['vite'] ||
            allDeps['@vitejs/plugin-react']
          ) {
            frameworks.push('react');
          }
        } catch {
          // Fallback if unparseable
          frameworks.push('react');
        }
      }

      // 2. Check for Django
      if (
        fileNames.includes('manage.py') ||
        fileNames.includes('wsgi.py') ||
        fileNames.includes('asgi.py')
      ) {
        frameworks.push('django');
      }
    } catch (err) {
      console.warn('Framework detector scan failed on folder:', uri.fsPath, err);
    }

    return frameworks;
  }

  private enableWatcher(type: FrameworkType): void {
    if (this.activeWatchers.has(type)) return;

    let watcher: IFrameworkWatcher;
    switch (type) {
      case 'react':
        watcher = new ReactWatcher(this.sessionManager);
        break;
      case 'node':
        watcher = new NodeWatcher(this.sessionManager);
        break;
      case 'django':
        watcher = new DjangoWatcher(this.sessionManager);
        break;
    }

    this.activeWatchers.set(type, watcher);
  }

  /**
   * Dispatches raw terminal output chunks to all active framework watchers.
   */
  public dispatchTerminalOutput(terminalName: string, text: string): void {
    for (const watcher of this.activeWatchers.values()) {
      watcher.processTerminalOutput(terminalName, text);
    }
  }

  /**
   * Dispatches document save events to active framework watchers.
   */
  public dispatchDocumentSaved(document: vscode.TextDocument): void {
    for (const watcher of this.activeWatchers.values()) {
      watcher.processDocumentSaved?.(document);
    }
  }

  /**
   * Returns list of currently active framework watcher types.
   */
  public getActiveFrameworks(): FrameworkType[] {
    return Array.from(this.activeWatchers.keys());
  }

  public dispose(): void {
    for (const watcher of this.activeWatchers.values()) {
      watcher.dispose();
    }
    this.activeWatchers.clear();

    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
