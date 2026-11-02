import * as assert from 'assert';
import {
  computeSessionDuration,
  computeEditTotals,
  computeNetLinesWritten,
  compute24BucketActivity,
  isInBucket,
  computePreExistingChars,
  computeSessionAnalytics
} from '../src/analytics';
import { Session, Snapshot, RunEvent, SessionEvent } from '../src/models';

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

  it('totals recorded edits by kind', () => {
    const session = createMockSession();
    session.snapshots[1].edit = { typedChars: 12, bulkInsertedChars: 0, deletedChars: 2 };
    session.snapshots[3].edit = { typedChars: 3, bulkInsertedChars: 40, deletedChars: 0 };

    assert.deepStrictEqual(computeEditTotals(session), {
      typedChars: 15,
      bulkInsertedChars: 40,
      deletedChars: 2
    });
  });

  it('treats opening a large file as pre-existing, never as typing', () => {
    const session = createMockSession();
    const content = 'x'.repeat(5000);
    session.snapshots = [{ timestamp: 1000, filePath: 'big.c', content, cursorStart: 0, cursorEnd: 0, trigger: 'focus' }];
    session.runs = [];

    const summary = computeSessionAnalytics(session);
    assert.strictEqual(summary.typedChars, 0);
    assert.strictEqual(summary.bulkInsertedChars, 0);
    assert.strictEqual(summary.preExistingChars, 5000);
    assert.strictEqual(
      summary.activityBuckets.reduce((sum, b) => sum + b.changeVolume, 0),
      0,
      'reading a file is not edit activity'
    );
  });

  it('takes edits folded into the first snapshot back out of pre-existing text', () => {
    const session = createMockSession();
    session.snapshots = [
      {
        timestamp: 1000,
        filePath: 'main.c',
        content: 'int main;',
        cursorStart: 0,
        cursorEnd: 0,
        edit: { typedChars: 4, bulkInsertedChars: 0, deletedChars: 1 }
      }
    ];
    assert.strictEqual(computePreExistingChars(session), 6);
  });

  it('does not inflate activity with runs or cursor-only snapshots', () => {
    const session = createMockSession();
    const same = 'int x;';
    session.snapshots = [
      { timestamp: 1000, filePath: 'a.c', content: same, cursorStart: 0, cursorEnd: 0 },
      { timestamp: 2000, filePath: 'a.c', content: same, cursorStart: 3, cursorEnd: 3 }
    ];
    const buckets = compute24BucketActivity(session);
    assert.strictEqual(buckets.reduce((sum, b) => sum + b.changeVolume, 0), 0);
  });

  it('reports no pass rate when no run has a known result', () => {
    const session = createMockSession();
    session.runs = [];
    assert.strictEqual(computeSessionAnalytics(session).passRate, null);

    session.runs = [{ timestamp: 1000, command: 'Debug [cppdbg]: main', output: 'ended', success: null, durationMs: 10 }];
    const summary = computeSessionAnalytics(session);
    assert.strictEqual(summary.passRate, null);
    assert.strictEqual(summary.unknownRuns, 1);
    assert.strictEqual(summary.failedRuns, 0);
    assert.strictEqual(summary.successfulRuns, 0);
  });

  it('leaves runs with unknown results out of the pass rate', () => {
    const session = createMockSession();
    session.runs.push({ timestamp: 100000, command: 'Debug [cppdbg]: main', output: 'ended', success: null, durationMs: 10 });
    const summary = computeSessionAnalytics(session);
    assert.strictEqual(summary.totalRuns, 3);
    assert.strictEqual(summary.passRate, 50);
    assert.strictEqual(summary.unknownRuns, 1);
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

  it('places a time on a bucket boundary in exactly one bucket', () => {
    const buckets = compute24BucketActivity(createMockSession());
    const boundary = buckets[5].endTimeMs;
    assert.strictEqual(buckets.filter((b) => isInBucket(boundary, b)).length, 1);
    assert.strictEqual(buckets.filter((b) => isInBucket(buckets[23].endTimeMs, b)).length, 1);
  });

  it('reports edits without edit data as unclassified, not as typed', () => {
    const session = createMockSession(); // these snapshots carry no edit data
    const summary = computeSessionAnalytics(session);
    assert.strictEqual(summary.typedChars, 0);
    assert.ok(summary.unclassifiedChars > 0);

    session.snapshots.forEach((s, i) => {
      if (i > 0) {
        s.edit = { typedChars: 1, bulkInsertedChars: 0, deletedChars: 0 };
      }
    });
    assert.strictEqual(computeSessionAnalytics(session).unclassifiedChars, 0);
  });

  it('counts terminals that could not be recorded', () => {
    const session = createMockSession();
    session.events.push({ type: 'terminal-unrecorded', timestamp: 1000 });
    assert.strictEqual(computeSessionAnalytics(session).unrecordedTerminals, 1);
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
