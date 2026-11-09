import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { computeSessionAnalytics, parseSessionLog } from '@codelapse/core';
import { decodeBundle } from '@codelapse/core/node';
import {
  COUNT_VOWELS,
  HEADER,
  MAIN_REVERSE_ONLY,
  PASTED_SOLUTION,
  ONLINE_SOLUTION,
  RENAMED_PASTED_SOLUTION,
  WEAK_HEADER,
  WEAK_REVERSE,
  WEAK_COUNT_VOWELS,
  WEAK_MAIN_REVERSE_ONLY,
  WEAK_COUNT_LINE,
  WEAK_SOLUTION,
  POINTER_REVERSE,
  POINTER_COUNT_VOWELS,
  POINTER_MAIN,
  POINTER_SOLUTION,
  EDITED_SOLUTION,
  REVERSE_LOOP,
  REVERSE_RECURSIVE,
  SOLUTION
} from './solutions';

/**
 * Records the scripted test recordings in fixtures/recordings by driving the
 * real extension: typing into real files, building with real gcc tasks and
 * exporting real .codelapse bundles. Run with `npm run fixtures`.
 */
const workspace = process.env.CODELAPSE_TEST_WORKSPACE!;
const outDir = process.env.CODELAPSE_FIXTURES_OUT!;
/** Longer than the tracker's 500ms debounce, so each typed line becomes a snapshot. */
const LINE_PAUSE_MS = 650;
/** Task end, then the recorder's wait for the task's terminal output. */
const AFTER_BUILD_MS = 1800;
const BUILD_COMMAND = 'gcc -Wall -o reverse reverse.c && ./reverse';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type RunResult = 'pass' | 'fail';

interface Expected {
  name: string;
  scripted: true;
  description: string;
  runs: RunResult[];
  traits: Record<string, string | boolean>;
}

interface TypeOptions {
  /** Extra delay per character, for slow typists. */
  charMs?: number;
}

/** Edits one open file the way a student would, one change at a time. */
class Writer {
  constructor(
    private readonly editor: vscode.TextEditor,
    readonly folder: vscode.Uri
  ) {}

  get text(): string {
    return this.editor.document.getText();
  }

  offsetOf(search: string, after = 0): number {
    const offset = this.text.indexOf(search, after);
    assert.ok(offset >= 0, `"${search}" not found in the file`);
    return offset;
  }

  /** Types character by character from `offset`, pausing after each line. */
  async typeAt(offset: number, text: string, options: TypeOptions = {}): Promise<void> {
    let at = offset;
    for (const ch of text) {
      const position = this.editor.document.positionAt(at);
      await this.editor.edit((eb) => eb.insert(position, ch), { undoStopBefore: false, undoStopAfter: false });
      at += ch.length;
      if (options.charMs) {
        await sleep(options.charMs);
      }
      if (ch === '\n') {
        await sleep(LINE_PAUSE_MS);
      }
    }
    await sleep(LINE_PAUSE_MS);
  }

  async type(text: string, options: TypeOptions = {}): Promise<void> {
    await this.typeAt(this.text.length, text, options);
  }

  /** One edit that inserts everything at once, as a paste does. */
  async paste(offset: number, text: string): Promise<void> {
    const position = this.editor.document.positionAt(offset);
    await this.editor.edit((eb) => eb.insert(position, text));
    await sleep(LINE_PAUSE_MS);
  }

  /** One edit that removes a range, as selecting and deleting does. */
  async delete(start: number, end: number): Promise<void> {
    const doc = this.editor.document;
    await this.editor.edit((eb) => eb.delete(new vscode.Range(doc.positionAt(start), doc.positionAt(end))));
    await sleep(LINE_PAUSE_MS);
  }

  /** Saves, then builds and runs with gcc as a VS Code task. */
  async build(): Promise<RunResult> {
    await this.editor.document.save();
    const task = new vscode.Task(
      { type: 'shell' },
      vscode.workspace.workspaceFolders![0],
      'build',
      'codelapse-fixtures',
      new vscode.ShellExecution(BUILD_COMMAND, { cwd: this.folder.fsPath }),
      []
    );
    const ended = new Promise<number | undefined>((resolve) => {
      const sub = vscode.tasks.onDidEndTaskProcess((e) => {
        if (e.execution.task.name === 'build') {
          sub.dispose();
          resolve(e.exitCode);
        }
      });
    });
    await vscode.tasks.executeTask(task);
    const exitCode = await ended;
    await sleep(AFTER_BUILD_MS);
    return exitCode === 0 ? 'pass' : 'fail';
  }
}

async function startScenario(name: string): Promise<Writer> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const folder = vscode.Uri.file(path.join(workspace, name));
  await vscode.commands.executeCommand('codelapse.selectFolder', folder);
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(folder, 'reverse.c'));
  const editor = await vscode.window.showTextDocument(doc);
  await sleep(LINE_PAUSE_MS);
  return new Writer(editor, folder);
}

/**
 * Exports the scenario's bundle, copies the code that would be submitted, writes
 * what the recording is expected to show, and checks the bundle really shows it.
 */
async function finish(writer: Writer, expected: Expected, results: RunResult[], afterExport?: () => void) {
  const target = path.join(outDir, expected.name);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.join(target, 'submission'), { recursive: true });

  const bundlePath = path.join(target, `${expected.name}.codelapse`);
  const written = await vscode.commands.executeCommand<vscode.Uri>('codelapse.exportBundle', {
    destination: vscode.Uri.file(bundlePath)
  });
  assert.ok(written, 'bundle exported');
  afterExport?.();
  fs.copyFileSync(path.join(writer.folder.fsPath, 'reverse.c'), path.join(target, 'submission', 'reverse.c'));
  fs.writeFileSync(path.join(target, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');

  assert.deepStrictEqual(results, expected.runs, 'builds behaved as scripted');
  const raw = fs.readFileSync(bundlePath);
  const bundle = decodeBundle(raw);
  assert.strictEqual(bundle.sessions.length, 1);
  const session = parseSessionLog(bundle.sessions[0].log);
  const analytics = computeSessionAnalytics(session);
  const recorded = session.runs.map((r) => (r.success ? 'pass' : 'fail'));
  assert.deepStrictEqual(recorded, expected.runs, 'the bundle holds every build with its result');
  assert.ok(session.runs.every((r) => r.output && !r.output.startsWith('Task "')), 'builds carry their real output');
  const json = JSON.stringify(bundle);
  assert.ok(!json.includes(workspace) && !json.includes(os.homedir()), 'no absolute paths or home folder');

  console.log(
    `FIXTURE ${expected.name}: ${raw.length} bytes, ${session.snapshots.length} snapshots, runs ${recorded.join(',')}, ` +
      `typed ${analytics.typedChars}, bulk ${analytics.bulkInsertedChars}, deleted ${analytics.deletedChars}, ` +
      `pre-existing ${analytics.preExistingChars}, ${Math.round(analytics.durationMs / 1000)}s`
  );
  return analytics;
}

describe('Scripted test recordings', () => {
  before(async () => {
    const ext = vscode.extensions.getExtension('shanthan2307.codelapse');
    await ext!.activate();
    await sleep(500);
    fs.mkdirSync(outDir, { recursive: true });
  });

  it('honest-incremental', async () => {
    const w = await startScenario('honest-incremental');
    const results: RunResult[] = [];
    await w.type(HEADER + REVERSE_LOOP.replace('strlen(s);', 'strlen(s)') + MAIN_REVERSE_ONLY);
    results.push(await w.build());
    await w.typeAt(w.offsetOf('strlen(s)') + 'strlen(s)'.length, ';');
    results.push(await w.build());
    await w.typeAt(w.offsetOf('int main'), COUNT_VOWELS);
    await w.typeAt(w.offsetOf('    return 0;'), '    printf("%d\\n", count_vowels("codelapse"));\n');
    results.push(await w.build());
    assert.strictEqual(w.text, SOLUTION);

    const analytics = await finish(
      w,
      {
        name: 'honest-incremental',
        scripted: true,
        description:
          'Types reverse() and main() line by line, forgets a semicolon (build fails), fixes it, then adds count_vowels().',
        runs: ['fail', 'pass', 'pass'],
        traits: { fixAfterFailedBuild: true, bulkInsert: false }
      },
      results
    );
    assert.strictEqual(analytics.bulkInsertedChars, 0);
  });

  it('pasted-solution', async () => {
    const w = await startScenario('pasted-solution');
    await w.paste(0, ONLINE_SOLUTION);
    const results = [await w.build()];
    const analytics = await finish(
      w,
      {
        name: 'pasted-solution',
        scripted: true,
        description: 'Inserts a whole solution from elsewhere in one edit, then builds once. It is not the one the copied pair shares.',
        runs: ['pass'],
        traits: { bulkInsert: true }
      },
      results
    );
    assert.strictEqual(analytics.bulkInsertedChars, ONLINE_SOLUTION.length);
    assert.strictEqual(analytics.typedChars, 0);
  });

  it('copied-pair-a', async () => {
    const w = await startScenario('copied-pair-a');
    await w.paste(0, PASTED_SOLUTION);
    const results = [await w.build()];
    await finish(
      w,
      {
        name: 'copied-pair-a',
        scripted: true,
        description: 'Pastes the same solution as copied-pair-b.',
        runs: ['pass'],
        traits: { bulkInsert: true, copiedWith: 'copied-pair-b' }
      },
      results
    );
  });

  it('copied-pair-b', async () => {
    const w = await startScenario('copied-pair-b');
    await w.paste(0, RENAMED_PASTED_SOLUTION);
    const results = [await w.build()];
    await finish(
      w,
      {
        name: 'copied-pair-b',
        scripted: true,
        description: 'Pastes the copied-pair-a solution with tmp, count and word renamed to swap, total and text.',
        runs: ['pass'],
        traits: { bulkInsert: true, copiedWith: 'copied-pair-a', renamedVariables: true }
      },
      results
    );
  });

  it('weak-but-honest', async () => {
    const w = await startScenario('weak-but-honest');
    const slow = { charMs: 20 };
    const results: RunResult[] = [];
    // Two mistakes: a missing semicolon and a misspelt variable.
    const firstTry = WEAK_REVERSE.replace('int left = 0;', 'int left = 0').replace('while (left < right)', 'while (left < rigth)');
    await w.type(WEAK_HEADER + firstTry + WEAK_MAIN_REVERSE_ONLY, slow);
    results.push(await w.build());
    await w.typeAt(w.offsetOf('int left = 0') + 'int left = 0'.length, ';', slow);
    results.push(await w.build());

    // Gives up on the loop: deletes it and writes it again, forgetting a parenthesis.
    const loopStart = w.offsetOf('    while (');
    const loopEnd = w.offsetOf('    }\n', loopStart) + '    }\n'.length;
    await w.delete(loopStart, loopEnd);
    const loop = WEAK_REVERSE.slice(WEAK_REVERSE.indexOf('    while ('), WEAK_REVERSE.indexOf('    }\n') + '    }\n'.length);
    await w.typeAt(loopStart, loop.replace('while (left < right)', 'while (left < right'), slow);
    results.push(await w.build());
    await w.typeAt(w.offsetOf('left < right') + 'left < right'.length, ')', slow);
    results.push(await w.build());

    await w.typeAt(w.offsetOf('int main'), WEAK_COUNT_VOWELS, slow);
    await w.typeAt(w.offsetOf('    return 0;'), WEAK_COUNT_LINE, slow);
    results.push(await w.build());
    assert.strictEqual(w.text, WEAK_SOLUTION);

    const analytics = await finish(
      w,
      {
        name: 'weak-but-honest',
        scripted: true,
        description:
          'Types its own two-index while loop slowly with real mistakes: missing semicolon, misspelt variable, then deletes and rewrites the loop with a missing parenthesis. Three failed builds before it passes.',
        runs: ['fail', 'fail', 'fail', 'pass', 'pass'],
        traits: { repeatedFailures: true, rewroteLoop: true, bulkInsert: false }
      },
      results
    );
    assert.strictEqual(analytics.bulkInsertedChars, 0);
  });

  it('abandoned-approach', async () => {
    const w = await startScenario('abandoned-approach');
    const results: RunResult[] = [];
    await w.type(WEAK_HEADER + REVERSE_RECURSIVE + POINTER_COUNT_VOWELS + POINTER_MAIN);
    results.push(await w.build());
    // Keeps the recursive version for a while before replacing it.
    await sleep(10000);
    const start = w.offsetOf('void reverse_range');
    await w.delete(start, start + REVERSE_RECURSIVE.length);
    await w.typeAt(start, POINTER_REVERSE);
    results.push(await w.build());
    assert.strictEqual(w.text, POINTER_SOLUTION);

    await finish(
      w,
      {
        name: 'abandoned-approach',
        scripted: true,
        description:
          'Writes a working recursive reverse(), keeps it about 10 seconds, deletes it and writes a two-pointer loop instead.',
        runs: ['pass', 'pass'],
        traits: { abandonedApproach: 'recursive reverse_range()', keptForSeconds: '10', bulkInsert: false }
      },
      results
    );
  });

  it('edited-after-recording', async () => {
    const w = await startScenario('edited-after-recording');
    await w.type(EDITED_SOLUTION);
    const results = [await w.build()];
    const file = path.join(w.folder.fsPath, 'reverse.c');
    await finish(
      w,
      {
        name: 'edited-after-recording',
        scripted: true,
        description:
          'Types the solution honestly, then after the bundle is exported reverse.c is changed outside VS Code, so the submission no longer matches the recording.',
        runs: ['pass'],
        traits: { editedAfterRecording: true, change: 'word "codelapse" becomes "research"; a comment is added' }
      },
      results,
      () =>
        fs.writeFileSync(
          file,
          fs.readFileSync(file, 'utf-8').replace('char word[] = "codelapse";', '/* final tweak */\n    char word[] = "research";')
        )
    );
    const submitted = fs.readFileSync(path.join(outDir, 'edited-after-recording', 'submission', 'reverse.c'), 'utf-8');
    assert.ok(submitted.includes('research') && submitted !== EDITED_SOLUTION);
  });
});
