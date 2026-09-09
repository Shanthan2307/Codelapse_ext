import * as assert from 'assert';
import { Snapshot, SessionEvent } from '../../models';

// Mock SessionManager interface for testing DocumentTracker logic
class MockSessionManager {
  public snapshots: Snapshot[] = [];
  public events: SessionEvent[] = [];
  public isRecordingActive: boolean = true;
  public elapsedTime: number = 1000;

  public isRecording(): boolean {
    return this.isRecordingActive;
  }

  public getElapsedTimeMs(): number {
    return this.elapsedTime;
  }

  public addSnapshot(s: Snapshot): void {
    this.snapshots.push(s);
  }

  public addSessionEvent(e: SessionEvent): void {
    this.events.push(e);
  }
}

// Simulates the debounced snapshot capture logic of DocumentTracker
class DocumentTrackerSimulator {
  private sessionManager: MockSessionManager;
  private debounceDelayMs: number;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private lastFileLengths: Map<string, number> = new Map();

  constructor(sessionManager: MockSessionManager, debounceDelayMs: number = 500) {
    this.sessionManager = sessionManager;
    this.debounceDelayMs = debounceDelayMs;
  }

  public scheduleEdit(filePath: string, content: string, cursorStart: number = 0, cursorEnd: number = 0): void {
    if (!this.sessionManager.isRecording()) {
      return;
    }

    const existing = this.debounceTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.captureSnapshot(filePath, content, cursorStart, cursorEnd);
    }, this.debounceDelayMs);

    this.debounceTimers.set(filePath, timer);
  }

  private captureSnapshot(filePath: string, content: string, cursorStart: number, cursorEnd: number): void {
    const currentLength = content.length;
    const previousLength = this.lastFileLengths.get(filePath);

    if (previousLength !== undefined && previousLength - currentLength > 50) {
      this.sessionManager.addSessionEvent({
        type: 'large-delete',
        timestamp: this.sessionManager.getElapsedTimeMs(),
        filePath,
        detail: `Deleted ${previousLength - currentLength} characters`
      });
    }
    this.lastFileLengths.set(filePath, currentLength);

    this.sessionManager.addSnapshot({
      timestamp: this.sessionManager.getElapsedTimeMs(),
      filePath,
      content,
      cursorStart,
      cursorEnd
    });
  }

  public flushPending(): void {
    for (const [filePath, timer] of this.debounceTimers.entries()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }
}

describe('DocumentTracker Debounce & Milestone Tests', () => {
  it('batches rapid keystrokes within 500ms into a single snapshot', async () => {
    const mockManager = new MockSessionManager();
    const tracker = new DocumentTrackerSimulator(mockManager, 50); // 50ms for fast test execution

    // Rapid keystrokes within 10ms of each other
    tracker.scheduleEdit('src/index.ts', 'c', 1, 1);
    tracker.scheduleEdit('src/index.ts', 'co', 2, 2);
    tracker.scheduleEdit('src/index.ts', 'con', 3, 3);
    tracker.scheduleEdit('src/index.ts', 'const', 5, 5);
    tracker.scheduleEdit('src/index.ts', 'const message = "Hello";', 24, 24);

    // Before debounce finishes: 0 snapshots
    assert.strictEqual(mockManager.snapshots.length, 0, 'No snapshots should be pushed before debounce delay');

    // Wait for debounce timer to fire
    await new Promise((resolve) => setTimeout(resolve, 80));

    // After debounce finishes: exactly 1 snapshot with the final text
    assert.strictEqual(mockManager.snapshots.length, 1, 'Only 1 snapshot should be emitted after debounce');
    assert.strictEqual(
      mockManager.snapshots[0].content,
      'const message = "Hello";',
      'Snapshot content should reflect latest batched state'
    );
    assert.strictEqual(mockManager.snapshots[0].cursorStart, 24);
  });

  it('independently tracks debouncing across distinct multi-file paths', async () => {
    const mockManager = new MockSessionManager();
    const tracker = new DocumentTrackerSimulator(mockManager, 40);

    tracker.scheduleEdit('src/fileA.ts', 'File A content');
    tracker.scheduleEdit('src/fileB.ts', 'File B content');

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.strictEqual(mockManager.snapshots.length, 2, 'Should capture snapshots for both distinct files');
    const filePaths = mockManager.snapshots.map((s) => s.filePath);
    assert.ok(filePaths.includes('src/fileA.ts'));
    assert.ok(filePaths.includes('src/fileB.ts'));
  });

  it('triggers a large-delete SessionEvent when more than 50 characters are deleted', async () => {
    const mockManager = new MockSessionManager();
    const tracker = new DocumentTrackerSimulator(mockManager, 20);

    const initialLargeContent = 'x'.repeat(120);
    tracker.scheduleEdit('src/buffer.ts', initialLargeContent);

    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.strictEqual(mockManager.snapshots.length, 1);
    assert.strictEqual(mockManager.events.length, 0);

    // Remove 80 characters
    const reducedContent = 'x'.repeat(40);
    tracker.scheduleEdit('src/buffer.ts', reducedContent);

    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.strictEqual(mockManager.snapshots.length, 2);
    assert.strictEqual(mockManager.events.length, 1, 'Should record a large-delete session event');
    assert.strictEqual(mockManager.events[0].type, 'large-delete');
    assert.strictEqual(mockManager.events[0].filePath, 'src/buffer.ts');
  });
});
