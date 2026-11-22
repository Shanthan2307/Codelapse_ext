import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { decodeBundle } from '../src/bundleFormat';
import { parseSessionLog } from '../src/sessionLog';
import { analyzeAuthorship, styleTells } from '../src/authorship';
import { Session, Snapshot } from '../src/models';

const ROOT = path.resolve(__dirname, '../../../fixtures/recordings');

function fixture(name: string) {
  const bundle = decodeBundle(fs.readFileSync(path.join(ROOT, name, `${name}.codelapse`)));
  const dir = path.join(ROOT, name, 'submission');
  return analyzeAuthorship({
    sessions: bundle.sessions.map((s) => parseSessionLog(s.log)),
    submitted: fs.readdirSync(dir).map((f) => ({ path: f, content: fs.readFileSync(path.join(dir, f), 'utf-8') })),
    language: name.startsWith('python') ? 'python' : 'c'
  });
}

const kinds = (r: ReturnType<typeof analyzeAuthorship>) => r.signals.map((s) => s.kind);

/** A solution with a function per few lines, long enough for the line-based signals. */
const SOLUTION = Array.from({ length: 6 }, (_, f) =>
  [`int step${f}(int value) {`, `    int doubled = value * ${f + 2};`, `    int shifted = doubled + ${f};`, `    return shifted - value;`, '}', ''].join('\n')
).join('\n');

function session(snapshots: Snapshot[], runs: Session['runs'] = []): Session {
  return { id: 's1', workspaceName: 'w', startTime: 1_000_000, snapshots, runs, events: [] };
}

/** Types `text` one line per snapshot, in the order given by `order` (line indices). */
function typeLines(text: string, order: number[], msPerLine: number, deletedPerLine = 0): Snapshot[] {
  const lines = text.split('\n');
  const present = new Set<number>();
  return order.map((i, k) => {
    present.add(i);
    const content = lines.filter((_, j) => present.has(j)).join('\n');
    return {
      timestamp: (k + 1) * msPerLine,
      filePath: 'main.c',
      content,
      cursorStart: 0,
      cursorEnd: 0,
      edit: { typedChars: lines[i].length + 1 + deletedPerLine, bulkInsertedChars: 0, deletedChars: deletedPerLine }
    };
  });
}

describe('Authorship signals', () => {
  for (const name of ['pasted-solution', 'copied-pair-a', 'copied-pair-b']) {
    it(`${name}: every line is traced to the paste, and the level is high`, () => {
      const r = fixture(name);
      assert.strictEqual(r.level, 'high');
      assert.strictEqual(r.lines.typed, 0);
      assert.ok(r.lines.pasted > 15);
      assert.ok(kinds(r).includes('pasted-code'));
      assert.ok(!r.files[0].origins.includes('t'));
    });
  }

  for (const name of ['honest-incremental', 'weak-but-honest', 'abandoned-approach', 'python-honest']) {
    it(`${name}: no line is pasted or from outside`, () => {
      const r = fixture(name);
      assert.strictEqual(r.lines.pasted, 0);
      assert.strictEqual(r.lines.outside, 0);
      assert.ok(!kinds(r).includes('pasted-code'));
      assert.ok(!kinds(r).includes('away-then-paste'));
    });
  }

  it('weak-but-honest: failed builds and rewrites rule out the transcription pattern', () => {
    const r = fixture('weak-but-honest');
    assert.ok(!kinds(r).includes('transcribed'));
    assert.ok(!kinds(r).includes('few-corrections'));
  });

  it('edited-after-recording: lines changed outside VS Code come from outside', () => {
    const r = fixture('edited-after-recording');
    assert.ok(r.lines.outside > 0);
    assert.match(r.files[0].origins, /o/);
  });

  it('finds code typed straight through with no corrections or failures as transcribed', () => {
    const lines = SOLUTION.split('\n');
    const snaps = typeLines(SOLUTION, lines.map((_, i) => i), 15_000);
    const r = analyzeAuthorship({ sessions: [session(snaps, [{ timestamp: 9e5, output: '', success: true, durationMs: 1 }])], submitted: [{ path: 'main.c', content: SOLUTION }], language: 'c' });
    assert.ok(kinds(r).includes('transcribed'), kinds(r).join(', '));
    assert.ok(!kinds(r).includes('pasted-code'));
  });

  it('does not call out-of-order writing with corrections and a failed run transcription', () => {
    const lines = SOLUTION.split('\n');
    // Bottom function first, then the rest: going back is normal for people.
    const order = [...lines.keys()].slice(-6).concat([...lines.keys()].slice(0, -6));
    const snaps = typeLines(SOLUTION, order, 30_000, 6);
    const r = analyzeAuthorship({
      sessions: [session(snaps, [{ timestamp: 5e5, output: 'error', success: false, durationMs: 1 }])],
      submitted: [{ path: 'main.c', content: SOLUTION }],
      language: 'c'
    });
    assert.ok(!kinds(r).includes('transcribed'));
    assert.ok(!kinds(r).includes('straight-through'));
    assert.strictEqual(r.level, 'low');
  });

  it('finds a long pause followed by a paste', () => {
    const snaps: Snapshot[] = [
      { timestamp: 2_000, filePath: 'main.c', content: '#include <stdio.h>', cursorStart: 0, cursorEnd: 0, edit: { typedChars: 18, bulkInsertedChars: 0, deletedChars: 0 } },
      { timestamp: 62_000, filePath: 'main.c', content: `#include <stdio.h>\n${SOLUTION}`, cursorStart: 0, cursorEnd: 0, edit: { typedChars: 0, bulkInsertedChars: SOLUTION.length + 1, deletedChars: 0 } }
    ];
    const r = analyzeAuthorship({ sessions: [session(snaps)], submitted: [{ path: 'main.c', content: `#include <stdio.h>\n${SOLUTION}` }], language: 'c' });
    assert.ok(kinds(r).includes('away-then-paste'));
    assert.strictEqual(r.level, 'high');
  });

  it('counts code already in the file before recording as from outside', () => {
    const snaps: Snapshot[] = [{ timestamp: 1_000, filePath: 'main.c', content: SOLUTION, cursorStart: 0, cursorEnd: 0, trigger: 'focus' }];
    const r = analyzeAuthorship({ sessions: [session(snaps)], submitted: [{ path: 'main.c', content: SOLUTION }], language: 'c' });
    assert.strictEqual(r.lines.typed + r.lines.pasted, 0);
    assert.ok(kinds(r).includes('code-from-outside'));
  });

  it('ignores reindenting: a formatter run does not make typed lines pasted', () => {
    const typed = typeLines(SOLUTION, SOLUTION.split('\n').map((_, i) => i), 20_000, 5);
    const reformatted = SOLUTION.replace(/^ {4}/gm, '  ');
    typed.push({ timestamp: 9e6, filePath: 'main.c', content: reformatted, cursorStart: 0, cursorEnd: 0, edit: { typedChars: 0, bulkInsertedChars: reformatted.length, deletedChars: SOLUTION.length } });
    const r = analyzeAuthorship({ sessions: [session(typed)], submitted: [{ path: 'main.c', content: reformatted }], language: 'c' });
    assert.strictEqual(r.lines.pasted, 0);
  });

  describe('style tells', () => {
    it('spots chat leftovers and typographic characters as strong', () => {
      const tells = styleTells([{ path: 'a.py', content: '# Here\'s the solution — it works\nprint(1)\n' }], 'python');
      assert.ok(tells.filter((t) => t.strong).length >= 2);
    });

    it('spots Python docstrings and type hints on every function', () => {
      const code = 'def a(x: int) -> int:\n    """Do a.\n\n    Args:\n        x: a value\n    """\n    return x\n\ndef b(y: str) -> str:\n    """Do b."""\n    return y\n';
      const labels = styleTells([{ path: 'a.py', content: code }], 'python').map((t) => t.label);
      assert.ok(labels.some((l) => l.includes('docstring on every function')));
      assert.ok(labels.some((l) => l.includes('type hints')));
    });

    it('finds nothing in plain beginner C', () => {
      assert.deepStrictEqual(styleTells([{ path: 'r.c', content: fs.readFileSync(path.join(ROOT, 'honest-incremental/submission/reverse.c'), 'utf-8') }], 'c'), []);
    });
  });
});
