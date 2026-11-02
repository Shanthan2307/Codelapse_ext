import * as assert from 'assert';
import { blankNonCode, findCFunctions, functionAtLine, isCSource } from '../src/cFunctions';

const names = (source: string) => findCFunctions(source).map((f) => f.name);

describe('C function locator', () => {
  it('finds functions with their start and end lines', () => {
    const source = [
      '#include <stdio.h>', // 1
      '', // 2
      'int add(int a, int b) {', // 3
      '  return a + b;', // 4
      '}', // 5
      '', // 6
      'int main(void)', // 7
      '{', // 8
      '  printf("%d\\n", add(1, 2));', // 9
      '  return 0;', // 10
      '}' // 11
    ].join('\n');
    assert.deepStrictEqual(findCFunctions(source), [
      { name: 'add', startLine: 3, endLine: 5 },
      { name: 'main', startLine: 7, endLine: 11 }
    ]);
  });

  it('ignores braces inside comments, strings and character literals', () => {
    const source = [
      '/* old version: int broken() { */',
      'void show(void) {',
      '  // a stray } in a comment',
      '  printf("{ not a block }\\n");',
      "  char c = '}';",
      '}',
      'int after(void) { return 1; }'
    ].join('\n');
    assert.deepStrictEqual(findCFunctions(source), [
      { name: 'show', startLine: 2, endLine: 6 },
      { name: 'after', startLine: 7, endLine: 7 }
    ]);
  });

  it('skips prototypes, structs, initialisers and preprocessor lines', () => {
    const source = [
      '#define BLOCK { 1, 2 }',
      'int helper(int x);',
      'struct point { int x; int y; };',
      'int table[] = { 1, 2, 3 };',
      'static const char *name = "x";',
      'static int *make(size_t n)',
      '{',
      '  if (n == 0) {',
      '    return 0;',
      '  }',
      '  while (n--) { }',
      '  return 0;',
      '}'
    ].join('\n');
    assert.deepStrictEqual(findCFunctions(source), [{ name: 'make', startLine: 6, endLine: 13 }]);
  });

  it('handles return types on their own line, multi-line parameters and function-pointer parameters', () => {
    const source = [
      'static int',
      'apply(int (*op)(int, int),',
      '      int a, int b)',
      '{',
      '  return op(a, b);',
      '}'
    ].join('\n');
    assert.deepStrictEqual(findCFunctions(source), [{ name: 'apply', startLine: 1, endLine: 6 }]);
  });

  it('handles old-style (K&R) parameter declarations', () => {
    const source = ['int sum(a, b)', 'int a;', 'int b;', '{', '  return a + b;', '}'].join('\n');
    assert.deepStrictEqual(names(source), ['sum']);
  });

  it('treats a body still being typed as running to the end of the file', () => {
    const source = ['int done(void) { return 0; }', 'int typing(void) {', '  int x = 1;'].join('\n');
    assert.deepStrictEqual(findCFunctions(source), [
      { name: 'done', startLine: 1, endLine: 1 },
      { name: 'typing', startLine: 2, endLine: 3 }
    ]);
  });

  it('keeps line numbers when blanking comments', () => {
    const source = 'a /* x\ny */ b // z\n"s\\"t" c';
    const blanked = blankNonCode(source);
    assert.strictEqual(blanked.length, source.length);
    assert.strictEqual(blanked.split('\n').length, source.split('\n').length);
    assert.ok(!/[xyzs]/.test(blanked));
  });

  it('looks up the function for a line, and knows which files are C', () => {
    const spans = findCFunctions('int a(void) {\n  return 1;\n}\n\nint b(void) { return 2; }');
    assert.strictEqual(functionAtLine(spans, 2)?.name, 'a');
    assert.strictEqual(functionAtLine(spans, 4), undefined);
    assert.strictEqual(functionAtLine(spans, 5)?.name, 'b');
    assert.ok(isCSource('src/main.c') && isCSource('list.H'));
    assert.ok(!isCSource('main.py'));
  });
});
