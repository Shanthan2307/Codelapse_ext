import * as assert from 'assert';
import { Snapshot } from '../../models';
import {
  computeEdits,
  editUnits,
  renderPartial,
  PlaybackModel
} from '../../ui/playback/PlaybackModel';

/** Applies every edit in full. */
function applyAll(oldText: string, newText: string): string {
  const edits = computeEdits(oldText, newText);
  return renderPartial(oldText, edits, editUnits(edits)).text;
}

/** Small deterministic PRNG (mulberry32) so the fuzz test is reproducible. */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function snap(timestamp: number, filePath: string, content: string): Snapshot {
  return { timestamp, filePath, content, cursorStart: content.length, cursorEnd: content.length };
}

describe('PlaybackModel Smooth Typing Interpolation Tests', () => {
  it('reproduces the target text exactly once all edits are applied', () => {
    const cases: Array<[string, string]> = [
      ['', 'const a = 1;\n'],
      ['const a = 1;\n', ''],
      ['a\nb\nc\n', 'a\nNEW\nb\nc\n'],
      ['foo(a);\n', 'foo(a, b);\n'],
      ['top\nmid\nbottom', 'TOP\nmid\nBOTTOM'],
      ['x\r\ny\r\n', 'x\r\nz\r\ny\r\n'],
      ['no newline', 'no newline at end\n'],
      ['one\ntwo\nthree\n', 'three\none\n']
    ];
    for (const [before, after] of cases) {
      assert.strictEqual(applyAll(before, after), after, `diff ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    }
  });

  it('survives randomized edit sequences (fuzz)', () => {
    const random = prng(42);
    const alphabet = ['a', 'b', ' ', '\n', '{', '}', 'x'];
    let text = 'function demo() {\n  return 1;\n}\n';

    for (let round = 0; round < 300; round++) {
      let next = text;
      const ops = 1 + Math.floor(random() * 3);
      for (let k = 0; k < ops; k++) {
        const at = Math.floor(random() * (next.length + 1));
        const del = Math.floor(random() * 6);
        let ins = '';
        const insLen = Math.floor(random() * 8);
        for (let c = 0; c < insLen; c++) {
          ins += alphabet[Math.floor(random() * alphabet.length)];
        }
        next = next.slice(0, at) + ins + next.slice(at + del);
      }
      assert.strictEqual(applyAll(text, next), next, `round ${round}`);
      text = next;
    }
  });

  it('only retypes the changed parts when two distant lines are edited', () => {
    const before = 'line1\nline2\nline3\nline4\nline5\n';
    const after = 'line1!\nline2\nline3\nline4\nline5!\n';
    const edits = computeEdits(before, after);

    assert.strictEqual(edits.length, 2);
    assert.deepStrictEqual(
      edits.map((e) => [e.removed, e.inserted]),
      [['', '!'], ['', '!']]
    );
  });

  it('never glues following code onto a line that is still being typed', () => {
    const before = 'a();\nb();\n';
    const after = 'a();\n  inserted();\nb();\n';
    const edits = computeEdits(before, after);
    const total = editUnits(edits);

    for (let u = 0; u <= total; u++) {
      const { text } = renderPartial(before, edits, u);
      const lines = text.split('\n');
      assert.ok(lines.includes('b();'), `"b();" must stay on its own line at unit ${u}: ${JSON.stringify(text)}`);
      assert.strictEqual(lines[0], 'a();');
    }
  });

  it('places the caret at the end of the text typed so far', () => {
    const edits = computeEdits('', 'hello');
    const { text, cursor } = renderPartial('', edits, 3);
    assert.strictEqual(text, 'hel');
    assert.strictEqual(cursor, 3);
  });

  it('shows exact snapshots at their timestamps and typing in between', () => {
    const model = new PlaybackModel([
      snap(10_000, 'a.ts', 'const a = 1;\n'),
      snap(20_000, 'a.ts', 'const a = 1;\nconst b = 2;\n')
    ]);

    // Before the first typing window: empty pre-state of the first file.
    const start = model.frameAt(0)!;
    assert.strictEqual(start.snapshotIndex, -1);
    assert.strictEqual(start.content, '');
    assert.strictEqual(start.isTyping, false);

    // Exactly on a snapshot: its recorded content, not an interpolation.
    const first = model.frameAt(10_000)!;
    assert.strictEqual(first.snapshotIndex, 0);
    assert.strictEqual(first.content, 'const a = 1;\n');
    assert.strictEqual(first.isTyping, false);

    // Just before the second snapshot: mid-typing, already containing the old line.
    const typing = model.frameAt(19_500)!;
    assert.strictEqual(typing.isTyping, true);
    assert.ok(typing.content.startsWith('const a = 1;\n'));
    assert.ok(typing.content.length < 'const a = 1;\nconst b = 2;\n'.length);

    // After the end: the final snapshot.
    assert.strictEqual(model.frameAt(99_999)!.content, 'const a = 1;\nconst b = 2;\n');
  });

  it('keeps typing windows inside the gap before each snapshot', () => {
    const model = new PlaybackModel([
      snap(1_000, 'a.ts', 'x'.repeat(2_000)),
      snap(1_200, 'b.ts', 'y'.repeat(2_000))
    ]);

    // The second file's 2,000 chars must be typed within its 200ms gap, so
    // at the first snapshot's timestamp the first file is shown exactly.
    const frame = model.frameAt(1_000)!;
    assert.strictEqual(frame.filePath, 'a.ts');
    assert.strictEqual(frame.isTyping, false);
    assert.strictEqual(frame.content.length, 2_000);
  });

  it('reports idle spans so the player can skip them', () => {
    const model = new PlaybackModel([
      snap(1_000, 'a.ts', 'a'),
      snap(300_000, 'a.ts', 'ab')
    ]);

    assert.ok(model.idleSpanAt(5_000) > 200_000, 'long pause between edits is idle');
    assert.strictEqual(model.idleSpanAt(299_999), 0, 'typing window right before a snapshot is not idle');
  });

  it('steps between snapshot boundaries', () => {
    const model = new PlaybackModel(
      [snap(1_000, 'a.ts', 'a'), snap(2_000, 'a.ts', 'ab'), snap(3_000, 'b.ts', 'c')],
      5_000
    );

    assert.strictEqual(model.nextBoundary(0), 1_000);
    assert.strictEqual(model.nextBoundary(1_000), 2_000);
    assert.strictEqual(model.nextBoundary(3_000), 5_000);
    assert.strictEqual(model.previousBoundary(2_000), 1_000);
    assert.strictEqual(model.previousBoundary(1_500), 1_000);
    assert.strictEqual(model.previousBoundary(500), 0);
    assert.strictEqual(model.firstTimeOf('b.ts'), 3_000);
  });
});
