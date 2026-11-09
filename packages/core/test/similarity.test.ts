import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { decodeBundle } from '../src/bundleFormat';
import { parseSessionLog } from '../src/sessionLog';
import { Session } from '../src/models';
import { bulkInsertedBlocks, compareCode, compareInsertedBlocks, compareText, tokenizeC } from '../src/similarity';

const ROOT = path.resolve(__dirname, '../../../fixtures/recordings');
const NAMES = [
  'honest-incremental',
  'pasted-solution',
  'copied-pair-a',
  'copied-pair-b',
  'weak-but-honest',
  'abandoned-approach',
  'edited-after-recording'
];

const code = (name: string): string => fs.readFileSync(path.join(ROOT, name, 'submission', 'reverse.c'), 'utf-8');
const sessions = (name: string): Session[] =>
  decodeBundle(fs.readFileSync(path.join(ROOT, name, `${name}.codelapse`))).sessions.map((s) => parseSessionLog(s.log));

describe('Code similarity', () => {
  it('sees through renamed variables in the copied pair', () => {
    const result = compareCode(code('copied-pair-a'), code('copied-pair-b'));
    assert.ok(result.structural >= 0.9, `structural ${result.structural}`);
    assert.ok(result.exact < result.structural, `exact ${result.exact} should be below structural ${result.structural}`);
    assert.ok(result.matchedLinesA.length > 10 && result.matchedLinesB.length > 10);
  });

  it('scores an identical file as exact, and two different pasted solutions well below', () => {
    assert.strictEqual(compareCode(code('copied-pair-a'), code('copied-pair-a')).exact, 1);
    const different = compareCode(code('pasted-solution'), code('copied-pair-a'));
    assert.ok(different.structural < 0.6, `structural ${different.structural}`);
  });

  // One more independent solution, written here: the same assignment, solved differently.
  const independent = `#include <stdio.h>
#include <string.h>

void reverse(char *s) {
    char *left = s;
    char *right = s + strlen(s) - 1;
    while (left < right) {
        char c = *left;
        *left++ = *right;
        *right-- = c;
    }
}

int count_vowels(const char *s) {
    int n = 0;
    while (*s != '\\0') {
        switch (*s) {
            case 'a': case 'e': case 'i': case 'o': case 'u':
                n++;
                break;
            default:
                break;
        }
        s++;
    }
    return n;
}

int main(void) {
    char text[] = "hello";
    reverse(text);
    printf("%s %d\\n", text, count_vowels("hello"));
    return 0;
}
`;

  it('scores an independent solution of the same assignment below the copied pair', () => {
    const copied = compareCode(code('copied-pair-a'), code('copied-pair-b')).structural;
    const result = compareCode(code('honest-incremental'), independent);
    console.log(`      honest-incremental vs independent solution: exact ${result.exact}, structural ${result.structural}`);
    assert.ok(result.structural < 0.5, `structural ${result.structural}`);
    assert.ok(result.structural < copied);
  });

  it('ignores starter code given to everyone', () => {
    // Both students were given count_vowels; each wrote reverse their own way.
    const starter = code('honest-incremental').slice(code('honest-incremental').indexOf('int count_vowels'), code('honest-incremental').indexOf('int main'));
    const a = code('honest-incremental');
    const b = independent.replace(/int count_vowels[\s\S]*?\n}\n/, starter);
    const without = compareCode(a, b);
    const withStarter = compareCode(a, b, { starterCode: starter });
    console.log(`      with shared count_vowels: structural ${without.structural}; with it as starter code: ${withStarter.structural}`);
    assert.ok(withStarter.structural < without.structural);
    assert.ok(withStarter.structural < 0.5, `structural ${withStarter.structural}`);
  });

  it('gives 0 for empty or very short code, and ignores comments and includes', () => {
    assert.deepStrictEqual(compareCode('', 'int main(void) { return 0; }'), { exact: 0, structural: 0, matchedLinesA: [], matchedLinesB: [] });
    assert.deepStrictEqual(
      tokenizeC('#include <stdio.h>\n// note\nint /* x */ a = 1;').map((t) => t.text),
      ['int', 'a', '=', '1', ';']
    );
  });

  it('is deterministic and symmetric in its scores', () => {
    const a = code('honest-incremental');
    const b = code('abandoned-approach');
    assert.deepStrictEqual(compareCode(a, b), compareCode(a, b));
    const ab = compareCode(a, b);
    const ba = compareCode(b, a);
    assert.strictEqual(ab.exact, ba.exact);
    assert.strictEqual(ab.structural, ba.structural);
  });

  it('prints the scores between every pair of scripted submissions', () => {
    const rows: string[] = [];
    for (let i = 0; i < NAMES.length; i++) {
      for (let j = i + 1; j < NAMES.length; j++) {
        const r = compareCode(code(NAMES[i]), code(NAMES[j]));
        rows.push(`${NAMES[i]} | ${NAMES[j]} | ${r.exact} | ${r.structural}`);
      }
    }
    console.log(`      a | b | exact | structural\n      ${rows.join('\n      ')}`);
    assert.strictEqual(rows.length, 21);
  });
});

describe('Pasted blocks', () => {
  it('finds the same pasted block, and does not match two different pastes', () => {
    const a = bulkInsertedBlocks(sessions('copied-pair-a'));
    const other = bulkInsertedBlocks(sessions('pasted-solution'));
    assert.ok(a.length >= 1 && other.length >= 1, `${a.length} and ${other.length} blocks`);
    assert.ok(a[0].chars >= 500);
    const same = compareInsertedBlocks(a, a);
    assert.deepStrictEqual(same.matches[0], { a: 0, b: 0, score: 1, renamed: false });
    assert.strictEqual(compareInsertedBlocks(a, other).score, 0, 'two different pasted solutions are not the same block');
  });

  it('still finds a pasted block whose variables were renamed', () => {
    const a = bulkInsertedBlocks(sessions('copied-pair-a'));
    const b = bulkInsertedBlocks(sessions('copied-pair-b'));
    const result = compareInsertedBlocks(a, b);
    assert.ok(result.score >= 0.9, `score ${result.score}`);
    assert.strictEqual(result.matches[0].renamed, true);
  });

  it('finds no pasted blocks in a recording that was typed', () => {
    assert.deepStrictEqual(bulkInsertedBlocks(sessions('honest-incremental')), []);
    assert.deepStrictEqual(compareInsertedBlocks([], bulkInsertedBlocks(sessions('pasted-solution'))), { score: 0, matches: [] });
  });
});

describe('Answer similarity', () => {
  const answer = 'The loop only goes to len / 2 because each swap moves two characters, so going further would swap them back.';

  it('scores identical answers as the same', () => {
    assert.ok(compareText(answer, answer).score >= 0.99);
    assert.ok(compareText(answer, answer).sharedPhrases.length >= 1);
  });

  it('scores a paraphrase moderately and an unrelated answer low', () => {
    const paraphrase = 'Each swap handles two characters at once, so I stop at half of len, otherwise characters would be swapped back.';
    const unrelated = 'I used const because count_vowels should not change the string it is given.';
    const p = compareText(answer, paraphrase).score;
    const u = compareText(answer, unrelated).score;
    console.log(`      paraphrase ${p}, unrelated ${u}`);
    assert.ok(p > u, `${p} vs ${u}`);
    assert.ok(p >= 0.25 && p < 0.95, `paraphrase ${p}`);
    assert.ok(u < 0.2, `unrelated ${u}`);
  });

  it('does not treat two short stock answers as copied', () => {
    assert.ok(compareText("I don't know.", 'I dont know').score < 0.5);
  });

  it('reports shared word runs in the first answer as written', () => {
    const b = 'Honestly, because each swap moves two characters, so going further would undo it.';
    assert.deepStrictEqual(compareText(answer, b).sharedPhrases, ['because each swap moves two characters, so going further would']);
  });
});
