/**
 * A small C function locator. It is not a C parser: it finds top-level function
 * definitions well enough to say which function a change touched.
 *
 * Handled: return types on their own line, braces on the next line, multi-line
 * parameter lists, pointer returns, `static`/`inline`, function-pointer
 * parameters, old-style (K&R) parameter declarations, and code that is still
 * being typed (an unclosed body runs to the end of the file).
 *
 * Ignored: comments, string and character literals, and preprocessor lines, so
 * braces inside them never count. Prototypes, struct/enum/union bodies, array
 * initialisers and control statements are not functions.
 *
 * Not handled: functions whose bodies come from macros, functions that return
 * function pointers (`int (*f(void))(int) {`), and code where unbalanced braces
 * hide behind `#if` branches.
 */

export interface FunctionSpan {
  name: string;
  /** 1-based line where the definition starts (its return type, when on an earlier line). */
  startLine: number;
  /** 1-based line of the closing brace, or the last line when the body is still open. */
  endLine: number;
}

const NOT_FUNCTION_NAMES = new Set([
  'if', 'while', 'for', 'switch', 'return', 'sizeof', 'do', 'else', 'case', '_Alignof', '_Generic', '__attribute__'
]);

const C_SOURCE_EXTENSIONS = ['.c', '.h'];

/** True for files the locator understands. */
export function isCSource(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return C_SOURCE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Replaces comments, string and character literals, and preprocessor lines with
 * spaces, keeping every newline, so offsets and line numbers stay the same.
 */
export function blankNonCode(source: string): string {
  const out = source.split('');
  let i = 0;
  let atLineStart = true;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) {
      if (out[k] !== '\n') {
        out[k] = ' ';
      }
    }
  };

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (atLineStart && ch === '#') {
      // Preprocessor line, including backslash continuations.
      let end = i;
      while (end < source.length) {
        if (source[end] === '\n' && source[end - 1] !== '\\') {
          break;
        }
        end++;
      }
      blank(i, end);
      i = end;
      continue;
    }

    if (ch === '/' && next === '/') {
      let end = source.indexOf('\n', i);
      if (end === -1) {
        end = source.length;
      }
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '/' && next === '*') {
      let end = source.indexOf('*/', i + 2);
      end = end === -1 ? source.length : end + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let end = i + 1;
      while (end < source.length && source[end] !== ch && source[end] !== '\n') {
        end += source[end] === '\\' ? 2 : 1;
      }
      end = Math.min(source.length, end + 1);
      blank(i, end);
      i = end;
      atLineStart = false;
      continue;
    }

    if (ch === '\n') {
      atLineStart = true;
    } else if (ch !== ' ' && ch !== '\t' && ch !== '\r') {
      atLineStart = false;
    }
    i++;
  }
  return out.join('');
}

/** Finds the top-level function definitions in C source. */
export function findCFunctions(source: string): FunctionSpan[] {
  const code = blankNonCode(source);
  const lineStarts = [0];
  for (let k = 0; k < code.length; k++) {
    if (code[k] === '\n') {
      lineStarts.push(k + 1);
    }
  }
  const lineOf = (offset: number): number => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return lo + 1;
  };

  const spans: FunctionSpan[] = [];
  let depth = 0;
  // Start of the text that could be the header of the next top-level brace.
  let segmentStart = 0;
  let open: { name: string; startOffset: number } | null = null;

  for (let k = 0; k < code.length; k++) {
    const ch = code[k];
    if (ch === '{') {
      if (depth === 0) {
        const name = functionHeaderName(code.slice(segmentStart, k));
        open = name ? { name: name.name, startOffset: segmentStart + name.startIndex } : null;
      }
      depth++;
    } else if (ch === '}') {
      if (depth > 0) {
        depth--;
        if (depth === 0) {
          if (open) {
            spans.push({ name: open.name, startLine: lineOf(open.startOffset), endLine: lineOf(k) });
            open = null;
          }
          segmentStart = k + 1;
        }
      }
    }
    // A top-level ';' does not reset the segment: K&R parameter declarations
    // end in ';' too, so functionHeaderName looks back past them instead.
  }

  if (open && depth > 0) {
    spans.push({ name: open.name, startLine: lineOf(open.startOffset), endLine: lineStarts.length });
  }
  return spans;
}

/**
 * Given the code between the previous top-level `}` and a top-level `{`, returns
 * the function name when that brace opens a function body.
 */
function functionHeaderName(header: string): { name: string; startIndex: number } | null {
  // Find the last ')' after which only K&R declarations (or nothing) follow.
  for (let close = header.lastIndexOf(')'); close !== -1; close = header.lastIndexOf(')', close - 1)) {
    const rest = header.slice(close + 1);
    if (!/^\s*(?:[^;{}()=]+;\s*)*$/.test(rest)) {
      // Something other than declarations follows, e.g. `= {` or `) __attribute__((x))`.
      if (rest.includes('=')) {
        return null;
      }
      continue;
    }

    const openParen = matchingOpenParen(header, close);
    if (openParen === -1) {
      return null;
    }
    const before = header.slice(0, openParen);
    const match = /([A-Za-z_]\w*)\s*$/.exec(before);
    if (!match || NOT_FUNCTION_NAMES.has(match[1])) {
      return null;
    }
    // The declaration starts after the last statement end before the name.
    const declStart = Math.max(before.lastIndexOf(';'), before.lastIndexOf('}')) + 1;
    if (/=/.test(header.slice(declStart, openParen))) {
      return null;
    }
    const leading = header.slice(declStart).search(/\S/);
    return { name: match[1], startIndex: declStart + Math.max(0, leading) };
  }
  return null;
}

function matchingOpenParen(text: string, close: number): number {
  let depth = 0;
  for (let k = close; k >= 0; k--) {
    if (text[k] === ')') {
      depth++;
    } else if (text[k] === '(') {
      depth--;
      if (depth === 0) {
        return k;
      }
    }
  }
  return -1;
}

/** The function containing a 1-based line, if any. */
export function functionAtLine(spans: FunctionSpan[], line: number): FunctionSpan | undefined {
  return spans.find((span) => line >= span.startLine && line <= span.endLine);
}
