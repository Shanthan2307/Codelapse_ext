/** Longest stretch of run output kept in a recording. */
export const MAX_RUN_OUTPUT_CHARS = 4000;

/** Commands that move around or manage files rather than run the student's work. */
const NON_RUN_COMMANDS = new Set([
  'alias', 'bg', 'brew', 'cat', 'cd', 'chmod', 'chown', 'clear', 'cls', 'code', 'cp', 'curl', 'date',
  'df', 'dir', 'du', 'echo', 'env', 'exit', 'export', 'fg', 'file', 'find', 'git', 'grep', 'head',
  'history', 'jobs', 'kill', 'less', 'ln', 'ls', 'man', 'mkdir', 'more', 'mv', 'nano', 'open',
  'popd', 'ps', 'pushd', 'pwd', 'reset', 'rm', 'rmdir', 'sed', 'set', 'sleep', 'source', 'tail',
  'top', 'touch', 'tree', 'type', 'unalias', 'unset', 'vi', 'vim', 'wc', 'wget', 'whereis', 'which',
  'whoami'
]);

/**
 * True when a command line runs something worth recording, such as `gcc main.c`
 * or `./a.out`. Chained commands count if any part qualifies: `cd src && make`.
 */
export function isRunCommand(commandLine: string): boolean {
  return commandLine.split(/&&|\|\||[;|\n]/).some((segment) => {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    while (words.length > 0 && (/^\w+=/.test(words[0]) || words[0] === 'sudo')) {
      words.shift();
    }
    if (words.length === 0) {
      return false;
    }
    const program = words[0].split('/').pop() ?? '';
    return program !== '' && !NON_RUN_COMMANDS.has(program.toLowerCase());
  });
}

/** Removes terminal colour, cursor and shell-integration escape sequences. */
export function stripAnsi(text: string): string {
  return text
    .replace(/\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g, '') // OSC
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '') // CSI
    .replace(/\x1B[@-Z\\^_]/g, '');
}

/**
 * Makes terminal text safe to store: absolute paths, which would reveal the
 * student's username, become `.` or `~`, and only the newest output is kept.
 * Longer paths are replaced first so a folder inside the home directory is
 * shown relative to the folder.
 */
export function sanitizeOutput(
  text: string,
  folderPaths: string[],
  homeDir: string,
  maxChars: number = MAX_RUN_OUTPUT_CHARS
): string {
  let clean = stripAnsi(text).replace(/\r\n?/g, '\n');
  const folders = [...new Set(folderPaths)].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const folder of folders) {
    clean = clean.split(folder).join('.');
  }
  if (homeDir) {
    clean = clean.split(homeDir).join('~');
  }
  clean = clean.trim();
  return clean.length > maxChars ? `…${clean.slice(-maxChars)}` : clean;
}

/**
 * True when a terminal command belongs to a task, so that task and command are
 * recorded as one run. The terminal is named after the task, or the command line
 * is the task's own. A terminal's name can be blank until the command has ended.
 */
export function isTaskCommand(
  terminalName: string,
  commandLine: string,
  task: { name: string; commandLine?: string }
): boolean {
  const ranTaskCommand = task.commandLine !== undefined && task.commandLine === commandLine.trim();
  return ranTaskCommand || terminalName === task.name || terminalName === `Task - ${task.name}`;
}
