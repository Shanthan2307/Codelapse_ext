import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { decodeBundle } from '../src/bundleFormat';
import { parseSessionLog } from '../src/sessionLog';
import { checkReplay } from '../src/replayCheck';
import { Moment, MomentKind, extractMoments } from '../src/moments';
import { Session } from '../src/models';

/**
 * Runs the analysis on the scripted recordings in fixtures/recordings, which
 * were made by driving the real extension (see that folder's README). They
 * check behaviour, not exact values: timestamps change on every regeneration.
 */
const ROOT = path.resolve(__dirname, '../../../fixtures/recordings');

function load(name: string): { sessions: Session[]; submitted: { path: string; content: string }[] } {
  const bundle = decodeBundle(fs.readFileSync(path.join(ROOT, name, `${name}.codelapse`)));
  const submissionDir = path.join(ROOT, name, 'submission');
  return {
    sessions: bundle.sessions.map((s) => parseSessionLog(s.log)),
    submitted: fs.readdirSync(submissionDir).map((file) => ({
      path: file,
      content: fs.readFileSync(path.join(submissionDir, file), 'utf-8')
    }))
  };
}

/** The scripted abandoned approach lives ~10 s, so the 2-minute default is lowered here. */
const momentsOf = (name: string): Moment[] => extractMoments(load(name).sessions, { abandonedMinLifetimeMs: 5000 });
const kinds = (moments: Moment[]): Set<MomentKind> => new Set(moments.map((m) => m.kind));

describe('Analysis of the scripted recordings', () => {
  const consistent = ['honest-incremental', 'pasted-solution', 'copied-pair-a', 'copied-pair-b', 'weak-but-honest', 'abandoned-approach', 'python-honest'];

  for (const name of consistent) {
    it(`${name}: the recording ends at the submitted code`, () => {
      const { sessions, submitted } = load(name);
      const result = checkReplay(sessions, submitted);
      assert.strictEqual(result.verdict, 'consistent', JSON.stringify(result.files));
    });
  }

  it('edited-after-recording: the submitted code differs from the recording', () => {
    const { sessions, submitted } = load('edited-after-recording');
    const result = checkReplay(sessions, submitted);
    assert.strictEqual(result.verdict, 'inconsistent');
    assert.strictEqual(result.files.find((f) => f.path === 'reverse.c')?.status, 'differs');
  });

  it('honest-incremental: finds the fix after the failed build, and no bulk insert', () => {
    const found = kinds(momentsOf('honest-incremental'));
    assert.ok(found.has('fix-after-failed-run'), [...found].join(', '));
    assert.ok(!found.has('bulk-insert'));
  });

  for (const name of ['pasted-solution', 'copied-pair-a', 'copied-pair-b']) {
    it(`${name}: finds the bulk insert, and no fix after a failed build`, () => {
      const moments = momentsOf(name);
      assert.ok(kinds(moments).has('bulk-insert'), [...kinds(moments)].join(', '));
      assert.ok(!kinds(moments).has('fix-after-failed-run'));
      assert.ok(moments.some((m) => m.kind === 'function-written' && m.functionName === 'reverse'));
    });
  }

  it('python-honest: finds the fix after the failed Python run, and no bulk insert', () => {
    const found = kinds(momentsOf('python-honest'));
    assert.ok(found.has('fix-after-failed-run'), [...found].join(', '));
    assert.ok(!found.has('bulk-insert'));
  });

  it('weak-but-honest: finds the repeated failed builds and the fix', () => {
    const found = kinds(momentsOf('weak-but-honest'));
    assert.ok(found.has('repeated-failures'), [...found].join(', '));
    assert.ok(found.has('fix-after-failed-run'));
    assert.ok(!found.has('bulk-insert'));
  });

  it('abandoned-approach: shows the recursive version that was replaced by a loop', () => {
    // The recursive code was replaced in place, which the extractor calls a rewrite;
    // "abandoned-approach" is kept for code removed with nothing in its place.
    const moments = momentsOf('abandoned-approach');
    const replaced = moments.find(
      (m) => (m.kind === 'rewrite' || m.kind === 'abandoned-approach') && m.before?.includes('reverse_range')
    );
    assert.ok(replaced, [...kinds(moments)].join(', '));
  });

  it('every moment cites a real session and has a plain summary', () => {
    for (const name of [...consistent, 'edited-after-recording']) {
      const { sessions } = load(name);
      const ids = new Set(sessions.map((s) => s.id));
      for (const moment of extractMoments(sessions)) {
        assert.ok(ids.has(moment.sessionId), `${name}: ${moment.id}`);
        assert.ok(moment.summary.length > 0 && !/cheat|plagiar/i.test(moment.summary), moment.summary);
      }
    }
  });
});
