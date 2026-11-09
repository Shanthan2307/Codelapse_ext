import * as assert from 'assert';
import { Snapshot, SessionEvent } from '@codelapse/core';
import { alignToPlayback, buildFileFlow, MIN_VIEW_MS } from '../src/flow/FileFlowModel';
import { PlaybackModel } from '../src/playback/PlaybackModel';

const snap = (timestamp: number, filePath: string, content: string, trigger?: 'focus'): Snapshot => ({
  timestamp,
  filePath,
  content,
  cursorStart: 0,
  cursorEnd: 0,
  ...(trigger ? { trigger } : {})
});
const focus = (timestamp: number, filePath: string): SessionEvent => ({ type: 'focus', timestamp, filePath });

describe('FileFlowModel Navigation Graph Tests', () => {
  it('turns edits into visits, and visits into moves and edges (with back-and-forth)', () => {
    const flow = buildFileFlow(
      [
        snap(1000, 'server/a.js', 'a1'),
        snap(2000, 'server/a.js', 'a1 a2'),
        snap(10000, 'server/a.test.js', 't1'),
        snap(20000, 'server/a.js', 'a1 a2 fix'),
        snap(30000, 'client/App.jsx', 'app')
      ],
      [],
      40000
    );

    assert.deepStrictEqual(
      flow.visits.map((v) => [v.filePath, v.start, v.end]),
      [
        ['server/a.js', 1000, 10000],
        ['server/a.test.js', 10000, 20000],
        ['server/a.js', 20000, 30000],
        ['client/App.jsx', 30000, 40000]
      ]
    );
    assert.deepStrictEqual(
      flow.moves.map((m) => `${m.from} -> ${m.to}`),
      ['server/a.js -> server/a.test.js', 'server/a.test.js -> server/a.js', 'server/a.js -> client/App.jsx']
    );
    // Both directions between a.js and its test are separate edges.
    assert.strictEqual(flow.edges.length, 3);
    assert.deepStrictEqual(flow.groups, ['server', 'client']);
    const a = flow.nodes.find((n) => n.filePath === 'server/a.js')!;
    assert.deepStrictEqual([a.group, a.label, a.visits, a.timeMs], ['server', 'a.js', 2, 19000]);
  });

  it('ignores flicking through a tab, but keeps a real read-only visit', () => {
    const flow = buildFileFlow(
      [
        snap(0, 'a.js', 'x'),
        snap(1000, 'a.js', 'xy'),
        snap(5000, 'b.js', 'b', 'focus'), // glanced at b.js for 1 s
        snap(6000, 'a.js', 'xyz'),
        snap(9000, 'c.js', 'c', 'focus'), // read c.js for 11 s without typing
        snap(20000, 'a.js', 'xyzw')
      ],
      [focus(5000, 'b.js'), focus(6000, 'a.js'), focus(9000, 'c.js'), focus(20000, 'a.js')],
      25000
    );

    assert.deepStrictEqual(
      flow.visits.map((v) => [v.filePath, v.edited]),
      [
        ['a.js', true], // the b.js glance (< MIN_VIEW_MS) is absorbed into this visit
        ['c.js', false],
        ['a.js', true]
      ]
    );
    assert.ok(20000 - 9000 >= MIN_VIEW_MS);
    assert.deepStrictEqual(flow.moves.map((m) => m.to), ['c.js', 'a.js']);
  });

  it('highlights exactly the lines typed during a visit', () => {
    const before = 'line 1\nline 2\nline 3\n';
    const after = 'line 1\nline 2 edited\nNEW A\nNEW B\nline 3\n';
    const flow = buildFileFlow(
      [snap(0, 'a.js', before), snap(4000, 'b.js', 'b'), snap(8000, 'a.js', before), snap(9000, 'a.js', after)],
      [],
      12000
    );
    const back = flow.visits[2];
    assert.strictEqual(back.filePath, 'a.js');
    assert.deepStrictEqual(back.changedLines, [2, 3, 4]);
    assert.strictEqual(back.charsTyped, ' edited\nNEW A\nNEW B'.length);
    assert.strictEqual(back.resultTime, 9000, 'result is where the typing finished');
  });

  it('does not count existing content as typing when the file was first seen on arrival', () => {
    const template = 'export default function App() {\n  return null\n}\n';
    const flow = buildFileFlow(
      [snap(0, 'App.jsx', template, 'focus'), snap(5000, 'App.jsx', template.replace('null', '<h1>Hi</h1>'))],
      [focus(0, 'App.jsx')],
      8000
    );
    assert.deepStrictEqual(flow.visits[0].changedLines, [2]);
    assert.strictEqual(flow.visits[0].charsTyped, '<h1>Hi</h1>'.length);
  });

  it('treats a brand-new file typed from scratch as all typed', () => {
    const flow = buildFileFlow([snap(0, 'new.js', ''), snap(3000, 'new.js', 'a\nb\n')], [], 4000);
    assert.deepStrictEqual(flow.visits[0].changedLines, [1, 2]);
  });

  it('does not highlight the line above when Enter starts a new line', () => {
    const flow = buildFileFlow(
      [snap(0, 'a.js', 'one\ntwo', 'focus'), snap(4000, 'a.js', 'one\ntwo\nthree')],
      [focus(0, 'a.js')],
      5000
    );
    assert.deepStrictEqual(flow.visits[0].changedLines, [3]);
  });
});

describe('FileFlowModel alignment with the replay', () => {
  it('starts each visit when its typing starts appearing on screen', () => {
    const snaps = [snap(1000, 'a.js', 'aaaa'), snap(30000, 'b.js', 'b'.repeat(100)), snap(40000, 'a.js', 'aaaa!')];
    const model = new PlaybackModel(snaps, 45000);
    const aligned = alignToPlayback(buildFileFlow(snaps, [], 45000), (ms: number) => model.windowStart(ms));

    // b.js's 100 characters are typed on screen before its 30 s snapshot...
    const b = aligned.visits[1];
    assert.ok(b.start < 30000 && b.start >= 1000, `b.js visit starts at ${b.start}`);
    // ...so the replay at that moment is already showing b.js, and so does the graph.
    assert.strictEqual(model.frameAt(b.start + 1)?.filePath, 'b.js');
    assert.strictEqual(aligned.visits[0].end, b.start);
    assert.strictEqual(aligned.moves[0].time, b.start);
    assert.deepStrictEqual(aligned.visits.map((v) => v.filePath), ['a.js', 'b.js', 'a.js']);
  });
});
