import type * as vscode from 'vscode';

export type FrameworkType = 'react' | 'node' | 'django';

export interface IFrameworkWatcher {
  readonly framework: FrameworkType;
  /**
   * Processes raw terminal output chunks to detect framework-specific lifecycles.
   */
  processTerminalOutput(terminalName: string, text: string): void;
  /**
   * Inspects saved document contents for framework structural patterns.
   */
  processDocumentSaved?(document: vscode.TextDocument): void;
  dispose(): void;
}
