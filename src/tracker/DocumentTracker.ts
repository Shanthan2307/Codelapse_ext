import * as vscode from 'vscode';
import { SessionManager } from './SessionManager';
import { DeltaSnapshot, TextChange } from './DeltaEngine';

export class DocumentTracker implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private pendingChanges: Map<string, TextChange[]> = new Map();
  private pendingSelections: Map<string, vscode.Selection> = new Map();
  private lastFileLengths: Map<string, number> = new Map();
  private fileEditCounts: Map<string, number> = new Map();
  private readonly debounceDelayMs: number;
  private readonly KEYFRAME_INTERVAL = 50;

  constructor(
    private readonly sessionManager: SessionManager,
    debounceDelayMs: number = 500
  ) {
    this.debounceDelayMs = debounceDelayMs;
    this.setupListeners();
  }

  /**
   * Sets up VS Code event listeners for document text and selection changes.
   */
  private setupListeners(): void {
    // Listen for text edits
    const docChangeDisposable = vscode.workspace.onDidChangeTextDocument(
      (event: vscode.TextDocumentChangeEvent) => {
        this.handleDocumentChange(event);
      }
    );

    // Listen for cursor / selection changes
    const selectionChangeDisposable = vscode.window.onDidChangeTextEditorSelection(
      (event: vscode.TextEditorSelectionChangeEvent) => {
        this.handleSelectionChange(event);
      }
    );

    this.disposables.push(docChangeDisposable, selectionChangeDisposable);
  }

  /**
   * Checks whether a document should be tracked.
   */
  private shouldTrackDocument(document: vscode.TextDocument): boolean {
    if (!this.sessionManager.isRecording()) {
      return false;
    }

    // Only track real workspace files or untitled buffers
    const scheme = document.uri.scheme;
    if (scheme !== 'file' && scheme !== 'untitled') {
      return false;
    }

    const fsPath = document.uri.fsPath;
    // Exclude git internal files and node_modules
    if (
      fsPath.includes('/.git/') ||
      fsPath.includes('\\.git\\') ||
      fsPath.includes('/node_modules/') ||
      fsPath.includes('\\node_modules\\')
    ) {
      return false;
    }

    return true;
  }

  /**
   * Handles text document modification events with delta aggregation.
   */
  private handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    const document = event.document;
    if (!this.shouldTrackDocument(document)) {
      return;
    }

    const filePath = vscode.workspace.asRelativePath(document.uri, false);

    // Collect atomic content changes
    const changes: TextChange[] = event.contentChanges.map((c) => ({
      rangeOffset: c.rangeOffset,
      rangeLength: c.rangeLength,
      text: c.text
    }));

    const existingChanges = this.pendingChanges.get(filePath) || [];
    existingChanges.push(...changes);
    this.pendingChanges.set(filePath, existingChanges);

    // Find cursor in active editor if it matches
    const activeEditor = vscode.window.activeTextEditor;
    const selection =
      activeEditor && activeEditor.document === document
        ? activeEditor.selection
        : undefined;

    this.scheduleSnapshot(document, selection);
  }

  /**
   * Handles editor selection / cursor movements.
   */
  private handleSelectionChange(event: vscode.TextEditorSelectionChangeEvent): void {
    const document = event.textEditor.document;
    if (!this.shouldTrackDocument(document)) {
      return;
    }

    const primarySelection = event.selections[0];
    this.scheduleSnapshot(document, primarySelection);
  }

  /**
   * Schedules a debounced snapshot capture for the given file.
   */
  private scheduleSnapshot(
    document: vscode.TextDocument,
    selection?: vscode.Selection
  ): void {
    const filePath = vscode.workspace.asRelativePath(document.uri, false);

    if (selection) {
      this.pendingSelections.set(filePath, selection);
    }

    // Clear previous timer for this file if active
    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Debounce capture
    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.captureSnapshot(document, filePath);
    }, this.debounceDelayMs);

    this.debounceTimers.set(filePath, timer);
  }

  /**
   * Captures a Keyframe (I-Frame) or Delta (P-Frame) snapshot and pushes it to SessionManager.
   */
  private captureSnapshot(document: vscode.TextDocument, filePath: string): void {
    if (!this.sessionManager.isRecording()) {
      return;
    }

    if (document.isClosed) {
      return;
    }

    const currentLength = document.getText().length;
    const previousLength = this.lastFileLengths.get(filePath);

    // Check for large deletion (e.g. reduction of more than 50 characters)
    if (previousLength !== undefined && previousLength - currentLength > 50) {
      const deletedCount = previousLength - currentLength;
      this.sessionManager.addSessionEvent({
        type: 'large-delete',
        timestamp: this.sessionManager.getElapsedTimeMs(),
        filePath,
        detail: `Deleted ${deletedCount} characters in ${filePath}`
      });
    }
    this.lastFileLengths.set(filePath, currentLength);

    // Calculate cursor positions
    let cursorStart = 0;
    let cursorEnd = 0;

    const selection =
      this.pendingSelections.get(filePath) ||
      (vscode.window.activeTextEditor?.document === document
        ? vscode.window.activeTextEditor.selection
        : undefined);

    if (selection) {
      try {
        cursorStart = document.offsetAt(selection.start);
        cursorEnd = document.offsetAt(selection.end);
      } catch {
        cursorStart = 0;
        cursorEnd = 0;
      }
    }

    // Determine Keyframe vs Delta
    const editCount = (this.fileEditCounts.get(filePath) || 0) + 1;
    this.fileEditCounts.set(filePath, editCount);

    const isKeyframe = editCount === 1 || editCount % this.KEYFRAME_INTERVAL === 0;
    const accumulatedChanges = this.pendingChanges.get(filePath) || [];
    this.pendingChanges.delete(filePath);

    const deltaSnapshot: DeltaSnapshot = {
      timestamp: this.sessionManager.getElapsedTimeMs(),
      filePath,
      isKeyframe,
      content: isKeyframe ? document.getText() : undefined,
      changes: isKeyframe ? undefined : accumulatedChanges,
      cursorStart,
      cursorEnd
    };

    this.sessionManager.addDeltaSnapshot(deltaSnapshot);
  }

  /**
   * Captures initial keyframes for all currently visible text editors.
   */
  public captureInitialOpenDocuments(): void {
    if (!this.sessionManager.isRecording()) {
      return;
    }

    for (const editor of vscode.window.visibleTextEditors) {
      if (this.shouldTrackDocument(editor.document)) {
        const filePath = vscode.workspace.asRelativePath(editor.document.uri, false);
        this.captureSnapshot(editor.document, filePath);
      }
    }
  }

  /**
   * Immediately flushes any pending debounced snapshots.
   */
  public flushPending(): void {
    for (const [filePath, timer] of this.debounceTimers.entries()) {
      clearTimeout(timer);
      const editor = vscode.window.visibleTextEditors.find(
        (e) => vscode.workspace.asRelativePath(e.document.uri, false) === filePath
      );
      if (editor) {
        this.captureSnapshot(editor.document, filePath);
      }
    }
    this.debounceTimers.clear();
  }

  /**
   * Disposes of all listeners and active timers.
   */
  public dispose(): void {
    this.flushPending();
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.pendingChanges.clear();
    this.pendingSelections.clear();
    this.lastFileLengths.clear();
    this.fileEditCounts.clear();

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}
