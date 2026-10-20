import * as vscode from 'vscode';
import { SessionManager } from './SessionManager';
import { DeltaSnapshot, TextChange } from './DeltaEngine';
import { RecordingScope } from './RecordingScope';

export class DocumentTracker implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private pendingChanges: Map<string, TextChange[]> = new Map();
  private pendingSelections: Map<string, vscode.Selection> = new Map();
  private lastFileLengths: Map<string, number> = new Map();
  private fileEditCounts: Map<string, number> = new Map();
  /** Document behind each pending capture, so flushing never depends on editor visibility. */
  private pendingDocuments: Map<string, vscode.TextDocument> = new Map();
  /** Session the per-file state above belongs to. */
  private trackedSessionId: string | null = null;
  /** Last file the user switched to, so repeated focus events for it are ignored. */
  private lastFocusedPath: string | null = null;
  private readonly debounceDelayMs: number;
  private readonly KEYFRAME_INTERVAL = 50;

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly scope: RecordingScope,
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

    // Per-file keyframe counters belong to one session's log. Without a reset,
    // the next session (e.g. after Stop/Start or switching folders) would begin
    // with deltas that have no keyframe in its own log, and could not be replayed.
    const sessionStateDisposable = this.sessionManager.onSessionStateChanged(({ state, session }) => {
      if (state === 'recording' && session && session.id !== this.trackedSessionId) {
        this.resetFileState();
        this.trackedSessionId = session.id;
      }
    });

    // File switches: which file the user moved to, even if they only read it.
    const focusDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        this.handleFocusChange(editor.document);
      }
    });

    this.disposables.push(docChangeDisposable, selectionChangeDisposable, sessionStateDisposable, focusDisposable);
  }

  /**
   * Records a move to another file in the recorded folder: a 'focus' event,
   * plus a snapshot of the file as it was on arrival, so what was typed during
   * the visit can later be told apart from what was already there.
   */
  private handleFocusChange(document: vscode.TextDocument): void {
    if (!this.shouldTrackDocument(document)) {
      return;
    }
    const filePath = this.scope.relativePath(document.uri);
    if (filePath === this.lastFocusedPath) {
      return;
    }
    this.lastFocusedPath = filePath;

    this.sessionManager.addSessionEvent({
      type: 'focus',
      timestamp: this.sessionManager.getElapsedTimeMs(),
      filePath
    });

    // Capture now rather than after the debounce, so the arrival state is exact.
    const pending = this.debounceTimers.get(filePath);
    if (pending) {
      clearTimeout(pending);
      this.debounceTimers.delete(filePath);
      this.pendingDocuments.delete(filePath);
    }
    this.captureSnapshot(document, filePath, 'focus');
  }

  /** Forgets all per-file state so the next capture of every file is a fresh keyframe. */
  private resetFileState(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.pendingChanges.clear();
    this.pendingSelections.clear();
    this.pendingDocuments.clear();
    this.lastFileLengths.clear();
    this.fileEditCounts.clear();
    this.lastFocusedPath = null;
  }

  /**
   * Checks whether a document should be tracked.
   */
  private shouldTrackDocument(document: vscode.TextDocument): boolean {
    // Only files saved inside the chosen folder are recorded (never .git or
    // node_modules). Unsaved "Untitled" buffers start being recorded once they
    // are saved into the folder.
    return this.sessionManager.isRecording() && this.scope.contains(document.uri);
  }

  /**
   * Handles text document modification events with delta aggregation.
   */
  private handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    const document = event.document;
    if (!this.shouldTrackDocument(document)) {
      return;
    }

    const filePath = this.scope.relativePath(document.uri);

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
    const filePath = this.scope.relativePath(document.uri);
    this.pendingDocuments.set(filePath, document);

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
      this.pendingDocuments.delete(filePath);
      this.captureSnapshot(document, filePath);
    }, this.debounceDelayMs);

    this.debounceTimers.set(filePath, timer);
  }

  /**
   * Captures a Keyframe (I-Frame) or Delta (P-Frame) snapshot and pushes it to SessionManager.
   */
  private captureSnapshot(document: vscode.TextDocument, filePath: string, trigger?: 'focus'): void {
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

    const accumulatedChanges = this.pendingChanges.get(filePath) || [];
    this.pendingChanges.delete(filePath);

    // Determine Keyframe vs Delta.
    // Only real text edits advance the keyframe counter: a bare cursor movement
    // carries no changes, so counting it would drift the I-Frame cadence away
    // from every 50 *edits* and inflate the session's edit statistics.
    const hasEdits = accumulatedChanges.length > 0;
    const isFirstCapture = !this.fileEditCounts.has(filePath);

    let editCount = this.fileEditCounts.get(filePath) || 0;
    if (hasEdits) {
      editCount += 1;
    }
    this.fileEditCounts.set(filePath, editCount);

    // The first capture of a file must be a keyframe: it establishes the baseline
    // every subsequent delta for that file is folded onto.
    const isKeyframe =
      isFirstCapture || (hasEdits && editCount % this.KEYFRAME_INTERVAL === 0);

    const deltaSnapshot: DeltaSnapshot = {
      timestamp: this.sessionManager.getElapsedTimeMs(),
      filePath,
      isKeyframe,
      content: isKeyframe ? document.getText() : undefined,
      changes: isKeyframe ? undefined : accumulatedChanges,
      cursorStart,
      cursorEnd,
      ...(trigger ? { trigger } : {})
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

    const active = vscode.window.activeTextEditor?.document;
    for (const editor of vscode.window.visibleTextEditors) {
      if (this.shouldTrackDocument(editor.document) && editor.document !== active) {
        this.captureSnapshot(editor.document, this.scope.relativePath(editor.document.uri));
      }
    }
    // The file open when recording starts is where the session's first visit begins.
    if (active) {
      this.handleFocusChange(active);
    }
  }

  /**
   * Immediately flushes any pending debounced snapshots.
   */
  public flushPending(): void {
    for (const [filePath, timer] of this.debounceTimers.entries()) {
      clearTimeout(timer);
      // Use the stored document: an edit in a file that is no longer visible
      // (e.g. its tab was switched away within the debounce window) still counts.
      const document = this.pendingDocuments.get(filePath);
      if (document) {
        this.captureSnapshot(document, filePath);
      }
    }
    this.debounceTimers.clear();
    this.pendingDocuments.clear();
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
    this.pendingDocuments.clear();
    this.lastFileLengths.clear();
    this.fileEditCounts.clear();

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}
