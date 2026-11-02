import * as assert from 'assert';
import { EditStats, RunEvent, Session, Snapshot } from '../src/models';
import { diffLines, excerpt, extractMoments, Moment } from '../src/moments';

const MIN = 60 * 1000;

const typed = (chars: number): EditStats => ({ typedChars: chars, bulkInsertedChars: 0, deletedChars: 0 });
const bulk = (chars: number): EditStats => ({ typedChars: 0, bulkInsertedChars: chars, deletedChars: 0 });
const deleted = (chars: number): EditStats => ({ typedChars: 0, bulkInsertedChars: 0, deletedChars: chars });

function snap(timestamp: number, content: string, edit?: EditStats, filePath = 'main.c'): Snapshot {
  return {
    timestamp,
    filePath,
    content,
    cursorStart: 0,
    cursorEnd: 0,
    ...(edit ? { edit } : { trigger: 'focus' as const })
  };
}

function run(timestamp: number, success: boolean | null, command = 'gcc main.c', output = ''): RunEvent {
  return { timestamp, command, output, success, durationMs: 100 };
}

function session(id: string, startTime: number, snapshots: Snapshot[], runs: RunEvent[] = []): Session {
  return { id, workspaceName: 'hw1', startTime, snapshots, runs, events: [] };
}

const ofKind = (moments: Moment[], kind: Moment['kind']) => moments.filter((m) => m.kind === kind);

const STARTER = ['#include <stdio.h>', '', 'int main(void) {', '  return 0;', '}'].join('\n');

describe('Line diff', () => {
  it('finds replaced, inserted and deleted blocks', () => {
    assert.deepStrictEqual(diffLines(['a', 'b', 'c'], ['a', 'x', 'c']), [
      { oldStart: 1, oldLines: ['b'], newStart: 1, newLines: ['x'] }
    ]);
    assert.deepStrictEqual(diffLines(['a', 'c'], ['a', 'b', 'c']), [
      { oldStart: 1, oldLines: [], newStart: 1, newLines: ['b'] }
    ]);
    assert.deepStrictEqual(diffLines(['a', 'b', 'c', 'd'], ['a', 'd']), [
      { oldStart: 1, oldLines: ['b', 'c'], newStart: 1, newLines: [] }
    ]);
    assert.deepStrictEqual(diffLines(['same'], ['same']), []);
  });

  it('caps excerpts at 20 lines', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const text = excerpt(lines);
    assert.strictEqual(text.split('\n').length, 21);
    assert.ok(text.endsWith('…'));
  });
});

describe('Decision moments', () => {
  it('finds a fix after a failed run, with the code before and after', () => {
    const broken = STARTER.replace('  return 0;', '  int total = 0\n  return total;');
    const fixed = STARTER.replace('  return 0;', '  int total = 0;\n  return total;');
    const moments = extractMoments([
      session(
        's1',
        1000,
        [snap(0, STARTER), snap(5000, broken, typed(30)), snap(20000, fixed, typed(1))],
        [run(10000, false, 'gcc main.c', "main.c:4: error: expected ';'"), run(30000, true)]
      )
    ]);
    const [fix] = ofKind(moments, 'fix-after-failed-run');
    assert.ok(fix, 'expected a fix moment');
    assert.strictEqual(fix.at, 30000);
    assert.strictEqual(fix.filePath, 'main.c');
    assert.strictEqual(fix.functionName, 'main');
    assert.ok(fix.before?.includes('int total = 0') && !fix.before.includes('int total = 0;'));
    assert.ok(fix.after?.includes('int total = 0;'));
    assert.ok(String(fix.evidence.failedOutput).includes("expected ';'"));
    assert.strictEqual(fix.absoluteTime, 31000);
  });

  it('pairs only the last failure of a command with its pass, and needs a change in between', () => {
    const v2 = STARTER.replace('return 0', 'return 1');
    const moments = extractMoments([
      session(
        's1',
        0,
        [snap(0, STARTER), snap(15000, v2, typed(1))],
        [run(1000, false), run(10000, false), run(20000, true), run(25000, false, './a.out'), run(26000, true, './a.out')]
      )
    ]);
    const fixes = ofKind(moments, 'fix-after-failed-run');
    assert.strictEqual(fixes.length, 1, 'the ./a.out pass had no change before it');
    assert.strictEqual(fixes[0].evidence.failedAt, 10000);
  });

  it('finds repeated failures, ignoring runs with an unknown result', () => {
    const moments = extractMoments([
      session('s1', 0, [snap(0, STARTER)], [run(1000, false), run(2000, null), run(3000, false), run(4000, false)])
    ]);
    const [streak] = ofKind(moments, 'repeated-failures');
    assert.ok(streak);
    assert.strictEqual(streak.evidence.count, 3);
    assert.strictEqual(streak.at, 4000);
  });

  it('finds a bulk insert, names the function, and uses neutral wording', () => {
    const pasted = STARTER.replace(
      '  return 0;',
      '  int values[5] = {1, 2, 3, 4, 5};\n  int sum = 0;\n  for (int i = 0; i < 5; i++) {\n    sum += values[i];\n  }\n  return sum;'
    );
    const moments = extractMoments([session('s1', 0, [snap(0, STARTER), snap(4000, pasted, bulk(120))])]);
    const [insert] = ofKind(moments, 'bulk-insert');
    assert.ok(insert);
    assert.strictEqual(insert.functionName, 'main');
    assert.ok(insert.after?.includes('sum += values[i];'));
    assert.ok(insert.summary.includes('paste, autocomplete or formatting'));
    assert.ok(!/cheat|copied|plagiar/i.test(insert.summary));
  });

  it('ignores inserts below the threshold, and snapshots without edit data', () => {
    const small = STARTER.replace('return 0', 'return 10');
    const moments = extractMoments([
      session('s1', 0, [snap(0, STARTER), snap(1000, small, bulk(20)), snap(2000, small + '\n// legacy', undefined)])
    ]);
    assert.strictEqual(ofKind(moments, 'bulk-insert').length, 0);
  });

  it('finds a rewrite: a block replaced by different code within the window', () => {
    const loop = ['int sum(int n) {', '  int s = 0;', '  for (int i = 1; i <= n; i++) {', '    s += i;', '  }', '  return s;', '}'];
    const formula = ['int sum(int n) {', '  return n * (n + 1) / 2;', '}'];
    const halfway = ['int sum(int n) {', '}'];
    const v1 = [...loop, '', STARTER].join('\n');
    const v2 = [...halfway, '', STARTER].join('\n');
    const v3 = [...formula, '', STARTER].join('\n');
    const moments = extractMoments([
      session('s1', 0, [snap(0, v1), snap(3 * MIN, v2, deleted(60)), snap(4 * MIN, v3, typed(26))])
    ]);
    const [rewrite] = ofKind(moments, 'rewrite');
    assert.ok(rewrite, 'expected a rewrite');
    assert.strictEqual(rewrite.functionName, 'sum');
    assert.ok(rewrite.before?.includes('s += i;'));
    assert.ok(rewrite.after?.includes('n * (n + 1) / 2'));
    assert.strictEqual(ofKind(moments, 'abandoned-approach').length, 0, 'a rewrite is not also abandoned');
  });

  it('finds an abandoned approach only when the code lived a while and never came back', () => {
    const helper = ['int debug_print(int x) {', '  printf("x=%d\\n", x);', '  fflush(stdout);', '  return x;', '}'];
    const withHelper = [...helper, '', STARTER].join('\n');
    const build = (deletedAt: number, restoreAt?: number) => {
      const snaps = [snap(0, STARTER), snap(10000, withHelper, typed(80)), snap(deletedAt, STARTER, deleted(80))];
      if (restoreAt) {
        snaps.push(snap(restoreAt, withHelper, bulk(80)));
      }
      return extractMoments([session('s1', 0, snaps)]);
    };

    const [abandoned] = ofKind(build(5 * MIN), 'abandoned-approach');
    assert.ok(abandoned, 'expected an abandoned approach');
    assert.strictEqual(abandoned.functionName, 'debug_print');
    assert.ok(abandoned.before?.includes('fflush(stdout);'));
    assert.ok(Number(abandoned.evidence.existedForMs) >= 4 * MIN);

    assert.strictEqual(ofKind(build(60000), 'abandoned-approach').length, 0, 'lived under 2 minutes');
    assert.strictEqual(ofKind(build(5 * MIN, 30 * MIN), 'abandoned-approach').length, 0, 'it came back');
  });

  it('notes when each function was written, skipping starter code', () => {
    const withTyped = `${STARTER}\n\nint square(int x) {\n  return x * x;\n}`;
    const withPasted = `${withTyped}\n\nint cube(int x) {\n  return x * x * x;\n}`;
    const moments = extractMoments([
      session('s1', 0, [snap(0, STARTER), snap(5000, withTyped, typed(40)), snap(9000, withPasted, bulk(40))])
    ]);
    const written = ofKind(moments, 'function-written');
    assert.deepStrictEqual(
      written.map((m) => [m.functionName, m.evidence.classification]),
      [
        ['square', 'mostly typed'],
        ['cube', 'mostly bulk inserted']
      ],
      'main was in the file before any edit, so it is starter code'
    );
  });

  it('gives the same moments and ids every time, whatever order sessions arrive in', () => {
    const a = session('a', 0, [snap(0, STARTER), snap(1000, `${STARTER}\nint f(void) { return 1; }`, typed(30))]);
    const b = session('b', 50 * MIN, [snap(0, STARTER), snap(2000, `${STARTER}\nint g(void) { return 2; }`, bulk(200))]);
    const first = extractMoments([a, b]);
    const second = extractMoments([b, a]);
    assert.deepStrictEqual(first, second);
    assert.ok(first.length > 0);
    assert.strictEqual(new Set(first.map((m) => m.id)).size, first.length, 'ids are unique');
    assert.ok(first.some((m) => m.id === 'bulk-insert-s1-t2000'));
  });

  it('keeps the highest-scoring moments when capped, still in time order', () => {
    const snaps: Snapshot[] = [snap(0, STARTER)];
    let content = STARTER;
    for (let i = 0; i < 5; i++) {
      content += `\nint f${i}(void) { return ${i}; }`;
      snaps.push(snap((i + 1) * 1000, content, typed(30)));
    }
    const fixed = content.replace('return 0;\n}', 'return 7;\n}');
    snaps.push(snap(20000, fixed, typed(1)));
    const all = extractMoments([session('s1', 0, snaps, [run(10000, false), run(30000, true)])]);
    const capped = extractMoments([session('s1', 0, snaps, [run(10000, false), run(30000, true)])], { maxMoments: 2 });

    assert.ok(all.length > 2);
    assert.strictEqual(capped.length, 2);
    assert.strictEqual(capped[capped.length - 1].kind, 'fix-after-failed-run', 'the fix outranks function-written');
    assert.ok(capped[0].absoluteTime <= capped[1].absoluteTime);
  });
});
