import * as assert from 'assert';
import { EditStats, Session, Snapshot } from '../src/models';
import { checkReplay } from '../src/replayCheck';

const typed = (n: number): EditStats => ({ typedChars: n, bulkInsertedChars: 0, deletedChars: 0 });

function snap(timestamp: number, filePath: string, content: string, edit?: EditStats, focus = false): Snapshot {
  return {
    timestamp,
    filePath,
    content,
    cursorStart: 0,
    cursorEnd: 0,
    ...(focus ? { trigger: 'focus' as const } : {}),
    ...(edit ? { edit } : {})
  };
}

function session(id: string, startTime: number, snapshots: Snapshot[]): Session {
  return { id, workspaceName: 'hw1', startTime, snapshots, runs: [], events: [] };
}

const MAIN_V1 = 'int main(void) {\n  return 0;\n}\n';
const MAIN_V2 = 'int main(void) {\n  return 1;\n}\n';

describe('Replay check', () => {
  it('finds a match when the recording ends with the submitted file', () => {
    const result = checkReplay(
      [session('s1', 1000, [snap(0, 'main.c', '', undefined, true), snap(5000, 'main.c', MAIN_V1, typed(MAIN_V1.length))])],
      [{ path: 'main.c', content: MAIN_V1 }]
    );
    assert.strictEqual(result.verdict, 'consistent');
    assert.strictEqual(result.files[0].status, 'match');
    assert.strictEqual(result.files[0].authorship?.typedChars, MAIN_V1.length);
    assert.strictEqual(result.files[0].authorship?.unedited, false);
    assert.strictEqual(result.counts.match, 1);
  });

  it('uses the last version across sessions, by time rather than by array order', () => {
    const later = session('s2', 100000, [snap(1000, 'main.c', MAIN_V2, typed(1))]);
    const earlier = session('s1', 1000, [snap(1000, 'main.c', MAIN_V1, typed(MAIN_V1.length))]);
    const result = checkReplay([later, earlier], [{ path: 'main.c', content: MAIN_V2 }]);
    assert.strictEqual(result.files[0].status, 'match');

    const stale = checkReplay([later, earlier], [{ path: 'main.c', content: MAIN_V1 }]);
    assert.strictEqual(stale.verdict, 'inconsistent');
    assert.strictEqual(stale.files[0].status, 'differs');
    assert.strictEqual(stale.files[0].firstDifferentLine, 2);
    assert.strictEqual(stale.files[0].recordedLines, 3);
    assert.strictEqual(stale.files[0].submittedLines, 3);
    assert.match(stale.files[0].reason, /line 2/);
  });

  it('treats line endings and trailing spaces as whitespace-only differences', () => {
    const recorded = session('s1', 1000, [snap(1000, 'main.c', MAIN_V1, typed(10))]);
    const crlf = MAIN_V1.replace(/\n/g, '\r\n').replace('{', '{   ');
    const result = checkReplay([recorded], [{ path: 'main.c', content: crlf.replace(/\r\n$/, '') }]);
    assert.strictEqual(result.files[0].status, 'whitespace-only');
    assert.strictEqual(result.verdict, 'consistent');
  });

  it('reports submitted files the recording never saw', () => {
    const result = checkReplay(
      [session('s1', 1000, [snap(1000, 'main.c', MAIN_V1, typed(10))])],
      [
        { path: 'main.c', content: MAIN_V1 },
        { path: 'helper.c', content: 'int helper(void) { return 2; }\n' }
      ]
    );
    assert.strictEqual(result.verdict, 'inconsistent');
    const helper = result.files.find((f) => f.path === 'helper.c');
    assert.strictEqual(helper?.status, 'not-recorded');
    assert.strictEqual(helper?.authorship, undefined);
    assert.strictEqual(result.counts['not-recorded'], 1);
  });

  it('lists recorded files that were not submitted, without making the result inconsistent', () => {
    const result = checkReplay(
      [session('s1', 1000, [snap(1000, 'main.c', MAIN_V1, typed(10)), snap(2000, 'notes.txt', 'todo\n', typed(5))])],
      [{ path: 'main.c', content: MAIN_V1 }]
    );
    assert.strictEqual(result.verdict, 'consistent');
    assert.deepStrictEqual(
      result.files.map((f) => [f.path, f.status]),
      [
        ['main.c', 'match'],
        ['notes.txt', 'not-submitted']
      ]
    );
  });

  it('marks a file that was only ever opened, never edited', () => {
    const result = checkReplay(
      [session('s1', 1000, [snap(1000, 'given.h', '#define N 10\n', undefined, true)])],
      [{ path: 'given.h', content: '#define N 10\n' }]
    );
    const given = result.files[0];
    assert.strictEqual(given.status, 'match');
    assert.strictEqual(given.authorship?.unedited, true);
    assert.strictEqual(given.authorship?.typedChars, 0);
    assert.strictEqual(given.authorship?.preExistingChars, '#define N 10\n'.length);
  });

  it('separates typed, bulk inserted and pre-existing text, counting pre-existing once', () => {
    const start = 'int x;\n';
    const result = checkReplay(
      [
        session('s1', 1000, [
          snap(0, 'main.c', start, undefined, true),
          snap(1000, 'main.c', start + 'int y;\n', typed(7)),
          snap(2000, 'main.c', start + 'int y;\n' + 'int z = 1234567890123456789;\n', {
            typedChars: 0,
            bulkInsertedChars: 29,
            deletedChars: 0
          })
        ]),
        // The next session opens the file as the previous one left it.
        session('s2', 100000, [snap(0, 'main.c', start + 'int y;\n' + 'int z = 1234567890123456789;\n', undefined, true)])
      ],
      [{ path: 'main.c', content: start + 'int y;\n' + 'int z = 1234567890123456789;\n' }]
    );
    const a = result.files[0].authorship!;
    assert.strictEqual(a.typedChars, 7);
    assert.strictEqual(a.bulkInsertedChars, 29);
    assert.strictEqual(a.preExistingChars, start.length, 'the second session does not add pre-existing text');
    assert.strictEqual(a.changedBetweenSessions, 0);
  });

  it('notices when a file changed while nothing was being recorded', () => {
    const result = checkReplay(
      [
        session('s1', 1000, [snap(1000, 'main.c', MAIN_V1, typed(MAIN_V1.length))]),
        session('s2', 100000, [snap(0, 'main.c', MAIN_V2, undefined, true)])
      ],
      [{ path: 'main.c', content: MAIN_V2 }]
    );
    assert.strictEqual(result.files[0].status, 'match');
    assert.strictEqual(result.files[0].authorship?.changedBetweenSessions, 1);
  });

  it('leaves out ignored files on both sides', () => {
    const result = checkReplay(
      [session('s1', 1000, [snap(1000, 'main.c', MAIN_V1, typed(10)), snap(2000, 'a.out', 'binary', typed(6))])],
      [
        { path: 'main.c', content: MAIN_V1 },
        { path: 'README.md', content: '# hw1\n' }
      ],
      { ignore: (p) => p === 'a.out' || p.endsWith('.md') }
    );
    assert.deepStrictEqual(
      result.files.map((f) => f.path),
      ['main.c']
    );
    assert.strictEqual(result.verdict, 'consistent');
  });

  it('is consistent when there is nothing to compare', () => {
    const result = checkReplay([], []);
    assert.strictEqual(result.verdict, 'consistent');
    assert.strictEqual(result.files.length, 0);
  });
});
