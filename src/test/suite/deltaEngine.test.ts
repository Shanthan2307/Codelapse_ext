import * as assert from 'assert';
import { BULK_INSERT_MIN_CHARS, DeltaEngine, DeltaSnapshot, TextChange, summarizeEdits } from '../../tracker/DeltaEngine';

describe('DeltaEngine Keyframe & Delta Patching Tests', () => {
  it('applies simple atomic insertions and deletions correctly', () => {
    const base = 'Hello World';

    // Insert ' Beautiful' at offset 5
    const insertChange: TextChange = {
      rangeOffset: 5,
      rangeLength: 0,
      text: ' Beautiful'
    };
    const result1 = DeltaEngine.applyChange(base, insertChange);
    assert.strictEqual(result1, 'Hello Beautiful World');

    // Delete ' World' (length 6 at offset 15)
    const deleteChange: TextChange = {
      rangeOffset: 15,
      rangeLength: 6,
      text: '!'
    };
    const result2 = DeltaEngine.applyChange(result1, deleteChange);
    assert.strictEqual(result2, 'Hello Beautiful!');
  });

  it('reconstructs file text accurately from a Keyframe + Delta sequence', () => {
    const snapshots: DeltaSnapshot[] = [
      {
        timestamp: 0,
        filePath: 'test.ts',
        isKeyframe: true,
        content: 'const a = 1;',
        cursorStart: 12,
        cursorEnd: 12
      },
      {
        timestamp: 1000,
        filePath: 'test.ts',
        isKeyframe: false,
        changes: [
          {
            rangeOffset: 12,
            rangeLength: 0,
            text: '\nconst b = 2;'
          }
        ],
        cursorStart: 25,
        cursorEnd: 25
      },
      {
        timestamp: 2000,
        filePath: 'test.ts',
        isKeyframe: false,
        changes: [
          {
            rangeOffset: 25,
            rangeLength: 0,
            text: '\nconsole.log(a + b);'
          }
        ],
        cursorStart: 44,
        cursorEnd: 44
      }
    ];

    // Reconstruct at step 0 (Keyframe)
    const text0 = DeltaEngine.reconstructContent(snapshots, 0);
    assert.strictEqual(text0, 'const a = 1;');

    // Reconstruct at step 1
    const text1 = DeltaEngine.reconstructContent(snapshots, 1);
    assert.strictEqual(text1, 'const a = 1;\nconst b = 2;');

    // Reconstruct at step 2
    const text2 = DeltaEngine.reconstructContent(snapshots, 2);
    assert.strictEqual(text2, 'const a = 1;\nconst b = 2;\nconsole.log(a + b);');
  });

  it('folds a live delta stream onto per-file baselines, not onto empty text', () => {
    // Mirrors SessionManager.addDeltaSnapshot: frames arrive one at a time and
    // each must be folded onto the running content of its own file.
    const stream: DeltaSnapshot[] = [
      {
        timestamp: 0,
        filePath: 'a.ts',
        isKeyframe: true,
        content: 'const a = 1;',
        cursorStart: 12,
        cursorEnd: 12
      },
      {
        timestamp: 100,
        filePath: 'b.ts',
        isKeyframe: true,
        content: 'const b = 2;',
        cursorStart: 12,
        cursorEnd: 12
      },
      {
        timestamp: 200,
        filePath: 'a.ts',
        isKeyframe: false,
        changes: [{ rangeOffset: 12, rangeLength: 0, text: '\nconst c = 3;' }],
        cursorStart: 25,
        cursorEnd: 25
      },
      {
        // Cursor-only frame: no changes, content must survive untouched.
        timestamp: 300,
        filePath: 'a.ts',
        isKeyframe: false,
        changes: [],
        cursorStart: 4,
        cursorEnd: 9
      },
      {
        timestamp: 400,
        filePath: 'b.ts',
        isKeyframe: false,
        changes: [{ rangeOffset: 12, rangeLength: 0, text: '\nexport { b };' }],
        cursorStart: 26,
        cursorEnd: 26
      }
    ];

    const live = new Map<string, string>();
    const materialized: Array<{ filePath: string; content: string }> = [];

    for (const frame of stream) {
      const baseline = live.get(frame.filePath) ?? '';
      const content = DeltaEngine.foldDelta(baseline, frame);
      live.set(frame.filePath, content);
      materialized.push({ filePath: frame.filePath, content });
    }

    // The delta frame must yield the WHOLE file, not just the inserted text.
    assert.strictEqual(materialized[2].content, 'const a = 1;\nconst c = 3;');
    assert.notStrictEqual(materialized[2].content, '\nconst c = 3;');

    // A cursor-only frame leaves content identical.
    assert.strictEqual(materialized[3].content, 'const a = 1;\nconst c = 3;');

    // Interleaved files keep independent baselines.
    assert.strictEqual(materialized[4].content, 'const b = 2;\nexport { b };');

    // The streaming fold must agree with the batch reconstruction path.
    const aFrames = stream.filter((f) => f.filePath === 'a.ts');
    assert.strictEqual(
      DeltaEngine.reconstructContent(aFrames, aFrames.length - 1),
      live.get('a.ts')
    );
  });

  it('materializes multi-file DeltaSnapshots into chronological full Snapshots', () => {
    const snapshots: DeltaSnapshot[] = [
      {
        timestamp: 100,
        filePath: 'fileA.ts',
        isKeyframe: true,
        content: 'A1',
        cursorStart: 2,
        cursorEnd: 2
      },
      {
        timestamp: 200,
        filePath: 'fileB.ts',
        isKeyframe: true,
        content: 'B1',
        cursorStart: 2,
        cursorEnd: 2
      },
      {
        timestamp: 300,
        filePath: 'fileA.ts',
        isKeyframe: false,
        changes: [{ rangeOffset: 2, rangeLength: 0, text: ' A2' }],
        cursorStart: 5,
        cursorEnd: 5
      }
    ];

    const materialized = DeltaEngine.materializeSnapshots(snapshots);
    assert.strictEqual(materialized.length, 3);
    assert.strictEqual(materialized[0].content, 'A1');
    assert.strictEqual(materialized[1].content, 'B1');
    assert.strictEqual(materialized[2].content, 'A1 A2');
  });
});

describe('summarizeEdits', () => {
  const insert = (text: string, rangeLength = 0): TextChange => ({ rangeOffset: 0, rangeLength, text });

  it('counts small edits as typed and sums deletions', () => {
    assert.deepStrictEqual(summarizeEdits([insert('a'), insert('b'), insert('', 3), insert('c', 1)]), {
      typedChars: 3,
      bulkInsertedChars: 0,
      deletedChars: 4
    });
  });

  it('counts one large insertion as bulk, at exactly the threshold', () => {
    const atThreshold = 'x'.repeat(BULK_INSERT_MIN_CHARS);
    assert.strictEqual(summarizeEdits([insert(atThreshold)]).bulkInsertedChars, BULK_INSERT_MIN_CHARS);
    assert.strictEqual(summarizeEdits([insert(atThreshold.slice(1))]).bulkInsertedChars, 0);
  });

  it('does not treat auto-indentation as bulk', () => {
    const newline = `\n${' '.repeat(40)}`;
    assert.deepStrictEqual(summarizeEdits([insert(newline)]), {
      typedChars: newline.length,
      bulkInsertedChars: 0,
      deletedChars: 0
    });
  });

  it('keeps edit stats on keyframes while replaying from their content', () => {
    const changes = [insert('y'.repeat(30))];
    const frame: DeltaSnapshot = {
      timestamp: 1,
      filePath: 'a.c',
      isKeyframe: true,
      content: 'y'.repeat(30),
      changes,
      cursorStart: 0,
      cursorEnd: 0
    };
    const [snapshot] = DeltaEngine.materializeSnapshots([frame]);
    assert.strictEqual(snapshot.content, 'y'.repeat(30));
    assert.strictEqual(snapshot.edit?.bulkInsertedChars, 30);
    assert.strictEqual(DeltaEngine.foldDelta('old text', frame), 'y'.repeat(30));
  });

  it('leaves edit stats off frames with no edits', () => {
    const [snapshot] = DeltaEngine.materializeSnapshots([
      { timestamp: 1, filePath: 'a.c', isKeyframe: true, content: 'text', cursorStart: 0, cursorEnd: 0 }
    ]);
    assert.strictEqual(snapshot.edit, undefined);
  });
});
