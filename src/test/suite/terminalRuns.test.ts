import * as assert from 'assert';
import { isRunCommand, isTaskCommand, sanitizeOutput, stripAnsi } from '../../events/terminalRuns';

describe('Terminal run helpers', () => {
  it('recognises commands that compile or run code', () => {
    for (const command of ['gcc main.c -o main', './a.out', 'make test', 'python3 main.py', 'valgrind ./main']) {
      assert.ok(isRunCommand(command), command);
    }
  });

  it('ignores navigation and file management', () => {
    for (const command of ['cd src', 'ls -la', 'git status', 'clear', 'rm a.out', '/bin/ls', '', '   ']) {
      assert.ok(!isRunCommand(command), JSON.stringify(command));
    }
  });

  it('looks through chains, env assignments and sudo', () => {
    assert.ok(isRunCommand('cd src && make'));
    assert.ok(isRunCommand('DEBUG=1 ./main'));
    assert.ok(isRunCommand('sudo ./main'));
    assert.ok(!isRunCommand('cd src && ls | grep main'));
    assert.ok(!isRunCommand('FOO=1'));
  });

  it('strips colour and shell-integration sequences', () => {
    const raw = '\x1B]633;C\x07\x1B[31mfailed\x1B[0m\x1B]0;title\x1B\\ now';
    assert.strictEqual(stripAnsi(raw), 'failed now');
  });

  it('replaces absolute paths so usernames are never stored', () => {
    const output = 'error in /home/ana/course/hw1/main.c\nsee /home/ana/notes.txt';
    assert.strictEqual(
      sanitizeOutput(output, ['/home/ana/course/hw1'], '/home/ana'),
      'error in ./main.c\nsee ~/notes.txt'
    );
  });

  it('replaces the longest folder path first', () => {
    assert.strictEqual(sanitizeOutput('/private/tmp/w/a.c', ['/tmp/w', '/private/tmp/w'], ''), './a.c');
  });

  it('keeps only the newest output', () => {
    const clean = sanitizeOutput(`old${'x'.repeat(10)}`, [], '', 5);
    assert.strictEqual(clean, '…xxxxx');
  });

  it('matches a terminal command to its task by terminal name or command line', () => {
    const task = { name: 'build', commandLine: 'gcc main.c' };
    assert.ok(isTaskCommand('build', 'anything', task));
    assert.ok(isTaskCommand('Task - build', 'anything', task));
    assert.ok(isTaskCommand('', 'gcc main.c ', task), 'the name can still be blank');
    assert.ok(!isTaskCommand('zsh', './a.out', task));
    assert.ok(!isTaskCommand('', 'gcc main.c', { name: 'build' }));
  });
});
