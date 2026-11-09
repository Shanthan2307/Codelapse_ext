import * as assert from 'assert';
import { Snapshot, SessionEvent } from '@codelapse/core';
import { buildFileFlow } from '../src/flow/FileFlowModel';
import { describeLines, summarizeJourney } from '../src/flow/journey';

const snap = (timestamp: number, filePath: string, content: string): Snapshot => ({
  timestamp,
  filePath,
  content,
  cursorStart: 0,
  cursorEnd: 0
});
const focus = (timestamp: number, filePath: string): SessionEvent => ({ type: 'focus', timestamp, filePath });

describe('File journey summary', () => {
  it('gives one lane per file in order of first visit, with switches and the busiest pair', () => {
    // reverse.c -> test.c -> reverse.c -> test.c -> src/util.c
    const snapshots = [
      snap(1000, 'reverse.c', 'a'),
      snap(9000, 'reverse.c', 'abcdef'),
      snap(20000, 'test.c', 't'),
      snap(26000, 'test.c', 'tests'),
      snap(40000, 'reverse.c', 'abcdefgh'),
      snap(52000, 'test.c', 'tests!'),
      snap(70000, 'src/util.c', 'u'),
      snap(80000, 'src/util.c', 'util')
    ];
    const events = [focus(1000, 'reverse.c'), focus(20000, 'test.c'), focus(40000, 'reverse.c'), focus(52000, 'test.c'), focus(70000, 'src/util.c')];
    const summary = summarizeJourney(buildFileFlow(snapshots, events, 90000));

    assert.deepStrictEqual(summary.lanes.map((l) => l.filePath), ['reverse.c', 'test.c', 'src/util.c']);
    assert.strictEqual(summary.lanes[2].label, 'util.c');
    assert.strictEqual(summary.lanes[2].folder, 'src');
    assert.strictEqual(summary.switches, 4);
    assert.deepStrictEqual(summary.backAndForth, { a: 'reverse.c', b: 'test.c', times: 3 });
    assert.ok(summary.mostTime, 'several files: the busiest one is named');
    const shares = summary.lanes.reduce((t, l) => t + l.share, 0);
    assert.ok(Math.abs(shares - 1) < 1e-9, 'shares add up to the whole session');
  });

  it('keeps the folder in the label when two files share a name', () => {
    const snapshots = [snap(1000, 'a/main.c', 'x'), snap(5000, 'a/main.c', 'xy'), snap(9000, 'b/main.c', 'z'), snap(14000, 'b/main.c', 'zz')];
    const summary = summarizeJourney(buildFileFlow(snapshots, [focus(1000, 'a/main.c'), focus(9000, 'b/main.c')], 20000));
    assert.deepStrictEqual(summary.lanes.map((l) => l.label), ['a/main.c', 'b/main.c']);
  });

  it('has no busiest pair or busiest file for a single-file session', () => {
    const summary = summarizeJourney(buildFileFlow([snap(1000, 'reverse.c', 'a'), snap(5000, 'reverse.c', 'ab')], [focus(1000, 'reverse.c')], 8000));
    assert.strictEqual(summary.lanes.length, 1);
    assert.strictEqual(summary.switches, 0);
    assert.strictEqual(summary.backAndForth, null);
    assert.strictEqual(summary.mostTime, null);
  });

  it('describes changed lines briefly', () => {
    assert.strictEqual(describeLines([4]), 'line 4');
    assert.strictEqual(describeLines([3, 4, 5, 6]), 'lines 3–6');
    assert.strictEqual(describeLines([3, 4, 9]), 'lines 3–4 and 9');
  });
});
