import type * as vscode from 'vscode';
import { IFrameworkWatcher, FrameworkType } from './types';
import { SessionManager } from '../tracker/SessionManager';

export class DjangoWatcher implements IFrameworkWatcher {
  public readonly framework: FrameworkType = 'django';
  private disposables: Array<{ dispose: () => void }> = [];

  constructor(private readonly sessionManager: SessionManager) {}

  /**
   * Parses terminal streams for Django migrations, manage.py commands, and runserver reloads.
   */
  public processTerminalOutput(terminalName: string, text: string): void {
    if (!this.sessionManager.isRecording()) {
      return;
    }

    const cleanText = text.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');

    // 1. Django Migration Execution: e.g. Applying accounts.0001_initial... OK
    const migrationAppliedMatch = cleanText.match(/Applying\s+([a-zA-Z0-9_]+(?:\.\d+_[a-zA-Z0-9_]+)?)\.\.\.\s+OK/i);
    if (migrationAppliedMatch) {
      const migrationName = migrationAppliedMatch[1];
      this.sessionManager.addSessionEvent({
        type: 'framework',
        timestamp: this.sessionManager.getElapsedTimeMs(),
        detail: `🐍 [Django Migration] Applied: ${migrationName}`
      });
      return;
    }

    // 2. Django makemigrations output: e.g. Migrations for 'users': 0002_user_profile.py
    const makeMigrationsMatch = cleanText.match(/Migrations for '([a-zA-Z0-9_]+)':\s*\n\s*([a-zA-Z0-9_]+\.py)/i);
    if (makeMigrationsMatch) {
      const app = makeMigrationsMatch[1];
      const file = makeMigrationsMatch[2];
      this.sessionManager.addSessionEvent({
        type: 'framework',
        timestamp: this.sessionManager.getElapsedTimeMs(),
        detail: `🐍 [Django makemigrations] Created ${app}/${file}`
      });
      return;
    }

    // 3. Django Dev Server Start / Check
    if (/System check identified no issues/i.test(cleanText)) {
      const versionMatch = cleanText.match(/Django version\s+([\d.]+)/i);
      const version = versionMatch ? ` (v${versionMatch[1]})` : '';
      this.sessionManager.addSessionEvent({
        type: 'run-pass',
        timestamp: this.sessionManager.getElapsedTimeMs(),
        detail: `🐍 [Django Server] System check passed${version} - ready`
      });
      return;
    }

    // 4. Django StatReloader reloading server
    if (/Watching for file changes with StatReloader/i.test(cleanText) || /change in '.*' reloading/i.test(cleanText)) {
      this.sessionManager.addSessionEvent({
        type: 'framework',
        timestamp: this.sessionManager.getElapsedTimeMs(),
        detail: '🐍 [Django Reloader] Reloading server due to code changes'
      });
      return;
    }

    // 5. Django Traceback & Exceptions
    if (/django\.core\.exceptions|django\.db\.utils|Traceback \(most recent call last\):/i.test(cleanText)) {
      const errorLine = cleanText.split('\n').find(l => /Error:|Exception:/i.test(l)) || 'Django runtime error';
      this.sessionManager.addSessionEvent({
        type: 'run-fail',
        timestamp: this.sessionManager.getElapsedTimeMs(),
        detail: `🚨 [Django Error] ${errorLine.trim().substring(0, 80)}`
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
