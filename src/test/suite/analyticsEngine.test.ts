import * as assert from 'assert';
import {
  computeSessionDuration,
  computeTotalKeystrokes,
  computeNetLinesWritten,
  compute24BucketActivity,
  computeLineHeatmap,
  computeSessionAnalytics
} from '../../analytics/engine';
import { Session, Snapshot, RunEvent, SessionEvent } from '../../models';

describe('AnalyticsEngine Unit Tests', () => {
  const createMockSession = (): Session => {
    const startTime = 1000000;
    const endTime = 1120000; // 120,000 ms duration

    const snapshots: Snapshot[] = [
      {
        timestamp: 10000,
        filePath: 'src/app.ts',
        content: 'const x = 1;\nconsole.log(x);',
        cursorStart: 12,
        cursorEnd: 12
      },
      {
        timestamp: 40000,
        filePath: 'src/app.ts',
        content: 'const x = 1;\nconst y = 2;\nconsole.log(x + y);',
        cursorStart: 30,
        cursorEnd: 30
      },
      {
        timestamp: 70000,
        filePath: 'src/helper.ts',
        content: 'export function helper() {\n  return true;\n}',
        cursorStart: 40,
        cursorEnd: 40
      },
      {
        timestamp: 110000,
        filePath: 'src/app.ts',
        content: 'const x = 1;\nconst y = 2;\nconst z = 3;\nconsole.log(x + y + z);',
        cursorStart: 45,
        cursorEnd: 45
      }
    ];

    const runs: RunEvent[] = [
      {
        timestamp: 50000,
        command: 'npm test',
        output: 'PASS src/app.test.ts',
        success: true,
        durationMs: 1200
      },
      {
        timestamp: 95000,
        command: 'npm test',
        output: 'FAIL src/helper.test.ts',
        success: false,
        durationMs: 800
      }
    ];

    const events: SessionEvent[] = [
      { type: 'start', timestamp: 0, detail: 'Session started' },
      { type: 'run-pass', timestamp: 50000, detail: 'Run passed' },
      { type: 'run-fail', timestamp: 95000, detail: 'Run failed' },
      { type: 'end', timestamp: 120000, detail: 'Session ended' }
    ];

    return {
      id: 'test-session-1',
      workspaceName: 'Test Workspace',
      startTime,
      endTime,
      snapshots,
      runs,
      events
    };
  };

  it('accurately computes session duration', () => {
    const session = createMockSession();
    const duration = computeSessionDuration(session);
    assert.strictEqual(duration, 120000, 'Duration should equal endTime - startTime');
  });

  it('accurately calculates net lines written across multiple files', () => {
    const session = createMockSession();
    // src/app.ts: initial lines = 2, final lines = 4 -> net = +2
    // src/helper.ts: initial lines = 3, final lines = 3 -> net = 0
    // Total net lines = +2
    const netLines = computeNetLinesWritten(session);
    assert.strictEqual(netLines, 2, 'Net lines written should be 2');
  });

  it('accurately computes total estimated keystrokes', () => {
    const session = createMockSession();
    const keystrokes = computeTotalKeystrokes(session);
    assert.ok(keystrokes > 50, `Keystrokes count (${keystrokes}) should be greater than 50`);
  });

  it('generates a 24-bucket activity array representing the session timeline', () => {
    const session = createMockSession();
    const buckets = compute24BucketActivity(session);

    assert.strictEqual(buckets.length, 24, 'Activity array must contain exactly 24 buckets');

    // Total snapshot count across buckets should match session snapshots
    const totalSnapshotsInBuckets = buckets.reduce((sum, b) => sum + b.snapshotCount, 0);
    assert.strictEqual(
      totalSnapshotsInBuckets,
      session.snapshots.length,
      'Total snapshots in buckets should match session snapshots count'
    );

    // Runs should be mapped to the appropriate buckets
    const totalRunsInBuckets = buckets.reduce((sum, b) => sum + b.runCount, 0);
    assert.strictEqual(totalRunsInBuckets, session.runs.length, 'Total runs in buckets should match');
  });

  it('calculates line edit heatmaps with accurate edit counts and intensity', () => {
    const session = createMockSession();
    const heatmap = computeLineHeatmap(session, 'src/app.ts');

    assert.ok(heatmap.length > 0, 'Heatmap should contain line entries');
    assert.strictEqual(heatmap.length, 4, 'src/app.ts final snapshot has 4 lines');

    // Verify 1-based indexing
    assert.strictEqual(heatmap[0].lineNumber, 1);
    assert.strictEqual(heatmap[3].lineNumber, 4);

    // Verify intensity values are bounded between 0 and 1
    for (const entry of heatmap) {
      assert.ok(entry.intensity >= 0 && entry.intensity <= 1, 'Intensity must be in [0, 1]');
      assert.ok(entry.editCount >= 1, 'Edit count must be >= 1');
      assert.ok(typeof entry.text === 'string');
    }
  });

  it('produces comprehensive session analytics summary', () => {
    const session = createMockSession();
    const summary = computeSessionAnalytics(session);

    assert.strictEqual(summary.sessionId, 'test-session-1');
    assert.strictEqual(summary.workspaceName, 'Test Workspace');
    assert.strictEqual(summary.totalSnapshots, 4);
    assert.strictEqual(summary.totalRuns, 2);
    assert.strictEqual(summary.successfulRuns, 1);
    assert.strictEqual(summary.failedRuns, 1);
    assert.strictEqual(summary.passRate, 50);
    assert.strictEqual(summary.activityBuckets.length, 24);
    assert.ok(summary.files['src/app.ts']);
    assert.ok(summary.files['src/helper.ts']);
  });
});
