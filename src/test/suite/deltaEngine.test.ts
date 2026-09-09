import * as assert from 'assert';
import { DeltaEngine, DeltaSnapshot, TextChange } from '../../tracker/DeltaEngine';

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
