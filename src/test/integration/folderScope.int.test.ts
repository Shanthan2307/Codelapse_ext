import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { computeSessionAnalytics } from '@codelapse/core';
import { Session } from '@codelapse/core';
import { LogStreamer } from '../../storage/LogStreamer';
import { buildFileFlow } from '@codelapse/replay/model';
import { decodeBundle, sha256 } from '@codelapse/core/node';

/**
 * End-to-end checks of folder-scoped recording inside a real VS Code.
 * The workspace (created by runIntegration.ts) contains two projects:
 *   projectA/src/a.js   projectB/b.js
 */
const workspace = process.env.CODELAPSE_TEST_WORKSPACE!;
const storageDir = process.env.CODELAPSE_TEST_STORAGE!;
const projectA = vscode.Uri.file(path.join(workspace, 'projectA'));
const projectB = vscode.Uri.file(path.join(workspace, 'projectB'));
const fileA = path.join(workspace, 'projectA', 'src', 'a.js');
const fileB = path.join(workspace, 'projectB', 'b.js');
const mainC = path.join(workspace, 'projectA', 'src', 'main.c');

/** Longer than the tracker's 500ms debounce, so each burst becomes its own snapshot. */
const AFTER_DEBOUNCE_MS = 750;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Types `text` at the end of a file one character at a time, like keystrokes. */
async function typeInto(filePath: string, text: string): Promise<vscode.TextDocument> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  const editor = await vscode.window.showTextDocument(doc);
  for (const ch of text) {
    await editor.edit((eb) => eb.insert(doc.positionAt(doc.getText().length), ch));
  }
  await sleep(AFTER_DEBOUNCE_MS);
  return doc;
}

/** Shell integration of a terminal, or undefined if it does not activate in time. */
async function shellIntegrationOf(terminal: vscode.Terminal): Promise<vscode.TerminalShellIntegration | undefined> {
  for (let waited = 0; waited < 10000 && !terminal.shellIntegration; waited += 200) {
    await sleep(200);
  }
  return terminal.shellIntegration;
}

function sessionLogs(): string[] {
  if (!fs.existsSync(storageDir)) {
    return [];
  }
  return fs
    .readdirSync(storageDir)
    .filter((f) => /^codelapse-\d+\.jsonl$/.test(f))
    .sort()
    .map((f) => path.join(storageDir, f));
}

/** Rebuilds the newest session purely from its on-disk append-only log. */
async function newestSessionFromDisk(): Promise<{ session: Session; records: any[] }> {
  const logs = sessionLogs();
  assert.ok(logs.length > 0, 'expected a session log on disk');
  const newest = logs[logs.length - 1];
  const records = fs
    .readFileSync(newest, 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  const session = await LogStreamer.readSessionFromLog(vscode.Uri.file(newest));
  assert.ok(session, 'log should parse into a session');
  return { session: session!, records };
}

function lastContentOf(session: Session, filePath: string): string | undefined {
  const snaps = session.snapshots.filter((s) => s.filePath === filePath);
  return snaps[snaps.length - 1]?.content;
}

describe('Folder-scoped recording (real VS Code)', () => {
  before(async () => {
    const ext = vscode.extensions.getExtension('shanthan2307.codelapse');
    assert.ok(ext, 'extension should be installed in the test host');
    await ext!.activate();
    await sleep(500);
  });

  it('records nothing until a folder is chosen', async () => {
    await typeInto(fileA, 'ignored();');
    const stopped = await vscode.commands.executeCommand<Session | undefined>('codelapse.stopSession');
    assert.strictEqual(stopped, undefined, 'no session should be running yet');
    assert.strictEqual(sessionLogs().length, 0, 'no log should have been written');
  });

  it('records only files inside the chosen folder, with folder-relative paths', async () => {
    const started = await vscode.commands.executeCommand<Session>('codelapse.selectFolder', projectA);
    assert.strictEqual(started?.workspaceName, 'projectA');

    await typeInto(fileA, '\nconst a = 1;');
    await typeInto(fileB, '\nconst outside = true;');
    const docA = await typeInto(fileA, '\nconst b = 2;');

    const session = await vscode.commands.executeCommand<Session>('codelapse.stopSession');
    assert.ok(session, 'stop should return the finished session');
    assert.strictEqual(session!.workspaceName, 'projectA');

    const files = new Set(session!.snapshots.map((s) => s.filePath));
    assert.deepStrictEqual([...files], ['src/a.js'], 'only project A files, relative to project A');

    // In-memory (live) view and the on-disk log must both hold the real file text.
    assert.strictEqual(lastContentOf(session!, 'src/a.js'), docA.getText());
    const { session: fromDisk } = await newestSessionFromDisk();
    assert.strictEqual(lastContentOf(fromDisk, 'src/a.js'), docA.getText());
  });

  it('starts every new session with a keyframe so it replays from disk', async () => {
    // Folder is remembered, so Start needs no picker. The file was already
    // edited in the previous session in this same window.
    const started = await vscode.commands.executeCommand<Session>('codelapse.startSession');
    assert.strictEqual(started?.workspaceName, 'projectA');

    await typeInto(fileA, '\nconst c = 3;');
    const docA = await typeInto(fileA, '\nconst d = 4;');
    await vscode.commands.executeCommand('codelapse.stopSession');

    const { session, records } = await newestSessionFromDisk();
    const firstFrame = records.find((r) => (r.type === 'keyframe' || r.type === 'delta') && r.data.filePath === 'src/a.js');
    assert.strictEqual(firstFrame?.type, 'keyframe', 'first frame of a file in a new session must be a keyframe');
    assert.strictEqual(lastContentOf(session, 'src/a.js'), docA.getText());
  });

  it('switching folders saves the old session and records only the new folder', async () => {
    await vscode.commands.executeCommand('codelapse.selectFolder', projectA);
    await typeInto(fileA, '\n// before switching');
    const logsBefore = sessionLogs();

    const switched = await vscode.commands.executeCommand<Session>('codelapse.selectFolder', projectB);
    assert.strictEqual(switched?.workspaceName, 'projectB');

    // The project A session was closed off on disk before B started.
    const previousLog = fs.readFileSync(logsBefore[logsBefore.length - 1], 'utf-8');
    assert.ok(previousLog.includes('"type":"session_end"'), 'previous session should be ended');

    await typeInto(fileA, '\n// not recorded');
    const docB = await typeInto(fileB, '\nconst inB = 1;');
    const session = await vscode.commands.executeCommand<Session>('codelapse.stopSession');

    const files = new Set(session!.snapshots.map((s) => s.filePath));
    assert.deepStrictEqual([...files], ['b.js']);
    assert.strictEqual(lastContentOf(session!, 'b.js'), docB.getText());
  });

  it('records moves between files, including files that were only read', async () => {
    await vscode.commands.executeCommand('codelapse.selectFolder', projectA);
    await typeInto(fileA, '\n// visit 1');
    // Open App.jsx and only read it for a few seconds.
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(path.join(workspace, 'projectA', 'src', 'App.jsx'))));
    await sleep(3500);
    await typeInto(fileA, '\n// visit 3');
    const session = await vscode.commands.executeCommand<Session>('codelapse.stopSession');

    const focusPaths = session!.events.filter((e) => e.type === 'focus').map((e) => e.filePath);
    assert.deepStrictEqual(focusPaths.slice(-3), ['src/a.js', 'src/App.jsx', 'src/a.js']);
    // The arrival snapshot holds App.jsx exactly as it was, marked as a focus capture.
    const arrival = session!.snapshots.find((s) => s.filePath === 'src/App.jsx');
    assert.strictEqual(arrival?.trigger, 'focus');

    // Rebuilt from disk, the navigation graph shows a.js → App.jsx (read only) → a.js.
    const { session: fromDisk } = await newestSessionFromDisk();
    const flow = buildFileFlow(fromDisk.snapshots, fromDisk.events, (fromDisk.endTime ?? 0) - fromDisk.startTime);
    assert.deepStrictEqual(flow.visits.map((v) => [v.filePath, v.edited]).slice(-3), [
      ['src/a.js', true],
      ['src/App.jsx', false],
      ['src/a.js', true]
    ]);
    assert.ok(flow.visits[flow.visits.length - 1].changedLines.length > 0, 'typing on the return visit is highlighted');
  });

  it('batches rapid typing into one snapshot', async () => {
    await vscode.commands.executeCommand('codelapse.selectFolder', projectA);
    await typeInto(fileA, '\nint rapid = 1;');
    const session = await vscode.commands.executeCommand<Session>('codelapse.stopSession');

    const edited = session!.snapshots.filter((s) => s.edit);
    assert.strictEqual(edited.length, 1, 'all the keystrokes land in one debounced snapshot');
    assert.strictEqual(edited[0].edit!.typedChars, '\nint rapid = 1;'.length);
    assert.strictEqual(edited[0].edit!.bulkInsertedChars, 0);
  });

  it('records a large deletion as a milestone', async () => {
    await vscode.commands.executeCommand('codelapse.selectFolder', projectA);
    const doc = await typeInto(fileA, `\n// ${'to be deleted '.repeat(5)}`);
    const editor = await vscode.window.showTextDocument(doc);
    const end = doc.getText().length;
    await editor.edit((eb) => eb.delete(new vscode.Range(doc.positionAt(end - 60), doc.positionAt(end))));
    await sleep(AFTER_DEBOUNCE_MS);
    const session = await vscode.commands.executeCommand<Session>('codelapse.stopSession');

    const deletion = session!.events.find((e) => e.type === 'large-delete');
    assert.ok(deletion, 'a 60 character deletion should be a milestone');
    assert.strictEqual(deletion!.filePath, 'src/a.js');
  });

  it('counts one large insertion as bulk inserted, and it survives a reload from disk', async () => {
    await vscode.commands.executeCommand('codelapse.selectFolder', projectA);
    const pasted = '\nint sum(int a, int b) { return a + b; }';
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(mainC));
    const editor = await vscode.window.showTextDocument(doc);
    await editor.edit((eb) => eb.insert(doc.positionAt(doc.getText().length), pasted));
    await sleep(AFTER_DEBOUNCE_MS);
    await vscode.commands.executeCommand('codelapse.stopSession');

    const { session } = await newestSessionFromDisk();
    const analytics = computeSessionAnalytics(session);
    assert.strictEqual(analytics.bulkInsertedChars, pasted.length);
    assert.strictEqual(analytics.typedChars, 0);
    assert.ok(analytics.preExistingChars > 0, 'the file content on arrival is pre-existing');
  });

  it('records a real terminal command with its exit code, and without absolute paths', async function () {
    await vscode.commands.executeCommand('codelapse.selectFolder', projectA);
    const terminal = vscode.window.createTerminal({ name: 'CodeLapse test', cwd: projectA });
    terminal.show();
    const integration = await shellIntegrationOf(terminal);
    if (!integration) {
      terminal.dispose();
      this.skip();
      return;
    }

    const finished = (commandPart: string) =>
      new Promise<void>((resolve) => {
        const sub = vscode.window.onDidEndTerminalShellExecution((e) => {
          if (e.execution.commandLine.value.includes(commandPart)) {
            sub.dispose();
            resolve();
          }
        });
      });

    // Not a run: must be ignored.
    let done = finished('ls');
    integration.executeCommand('ls');
    await done;

    done = finished('nonexistent-codelapse-tool');
    integration.executeCommand(`node -e "console.log(process.cwd()); process.exit(3)" # nonexistent-codelapse-tool`);
    await done;
    await sleep(1500); // output drain

    const session = await vscode.commands.executeCommand<Session>('codelapse.stopSession');
    terminal.dispose();

    assert.strictEqual(session!.runs.length, 1, 'only the real run is recorded');
    assert.strictEqual(session!.runs[0].success, false, 'exit code 3 is a failure');
    assert.ok(session!.events.some((e) => e.type === 'run-fail'));
    assert.ok(!session!.runs[0].output.includes(path.basename(workspace)), 'output must not expose the folder path');
  });

  it('records a task as one run, with its real output', async () => {
    await vscode.commands.executeCommand('codelapse.selectFolder', projectA);
    const task = new vscode.Task(
      { type: 'shell' },
      vscode.workspace.workspaceFolders![0],
      'codelapse-build',
      'codelapse-test',
      new vscode.ShellExecution(`node -e "console.log('task-output'); process.exit(2)"`, { cwd: projectA.fsPath })
    );
    const ended = new Promise<void>((resolve) => {
      const sub = vscode.tasks.onDidEndTaskProcess(() => {
        sub.dispose();
        resolve();
      });
    });
    await vscode.tasks.executeTask(task);
    await ended;
    await sleep(2000); // the task waits for its command, then for the output

    const session = await vscode.commands.executeCommand<Session>('codelapse.stopSession');
    assert.strictEqual(session!.runs.length, 1, 'a task and its terminal command are one run');
    assert.strictEqual(session!.runs[0].command, 'codelapse-build');
    assert.strictEqual(session!.runs[0].success, false);
    assert.ok(session!.runs[0].output.includes('task-output'), `got: ${session!.runs[0].output}`);
  });

  it('notes a terminal whose commands cannot be recorded', async () => {
    await vscode.commands.executeCommand('codelapse.selectFolder', projectA);
    // Plain sh is not a shell VS Code can integrate with.
    const terminal = vscode.window.createTerminal({ name: 'No integration', shellPath: '/bin/sh', cwd: projectA });
    terminal.show();
    await sleep(16000);
    const session = await vscode.commands.executeCommand<Session>('codelapse.stopSession');
    terminal.dispose();
    assert.strictEqual(computeSessionAnalytics(session!).unrecordedTerminals, 1);
  });

  it('never writes absolute paths (or the username in them) into recordings', async () => {
    await vscode.commands.executeCommand('codelapse.selectFolder', projectA);
    await typeInto(path.join(workspace, 'projectA', 'src', 'App.jsx'), '\nconst n = 0;');
    await sleep(300);
    await vscode.commands.executeCommand('codelapse.stopSession');

    for (const file of fs.readdirSync(storageDir)) {
      const text = fs.readFileSync(path.join(storageDir, file), 'utf-8');
      assert.ok(!text.includes(workspace), `${file} must not contain the absolute workspace path`);
    }
  });

  it('saves chosen sessions as raw logs plus a working HTML report', async () => {
    // Record while a session is still running: the command must end it first.
    await vscode.commands.executeCommand('codelapse.selectFolder', projectA);
    const html = path.join(workspace, 'projectA', 'index.html');
    const docHtml = await typeInto(html, '<!-- edited -->');

    const destination = vscode.Uri.file(path.join(workspace, '..', 'exports'));
    fs.mkdirSync(destination.fsPath, { recursive: true });
    const target = await vscode.commands.executeCommand<vscode.Uri>('codelapse.exportForSubmission', {
      destination,
      includeAll: true
    });
    assert.ok(target, 'should return the created folder');

    const saved = fs.readdirSync(target!.fsPath).sort();
    const logs = sessionLogs();
    // Every session: identical raw log, its .json snapshot, and an HTML report.
    for (const log of logs) {
      const base = path.basename(log, '.jsonl');
      assert.ok(saved.includes(`${base}.jsonl`), `${base}.jsonl copied`);
      assert.ok(saved.includes(`${base}.json`), `${base}.json copied`);
      assert.ok(saved.includes(`${base}-report.html`), `${base}-report.html written`);
      assert.strictEqual(
        fs.readFileSync(path.join(target!.fsPath, `${base}.jsonl`), 'utf-8'),
        fs.readFileSync(log, 'utf-8')
      );
    }

    // The running session was ended before copying, so its log is complete.
    const newestLog = fs.readFileSync(logs[logs.length - 1], 'utf-8');
    assert.ok(newestLog.includes('"type":"session_end"'));

    // The report for that session embeds code containing "</script>" and must
    // still parse: the data script has to run to its own closing tag.
    const newestBase = path.basename(logs[logs.length - 1], '.jsonl');
    const report = fs.readFileSync(path.join(target!.fsPath, `${newestBase}-report.html`), 'utf-8');
    const marker = 'window.__CODELAPSE_STANDALONE_DATA__ = ';
    const start = report.indexOf(marker);
    const dataScript = report.slice(start, report.indexOf('</script>', start));
    const fakeWindow: any = {};
    new Function('window', dataScript)(fakeWindow);
    const embedded = fakeWindow.__CODELAPSE_STANDALONE_DATA__.session as Session;
    assert.strictEqual(lastContentOf(embedded, 'index.html'), docHtml.getText());
  });

  it('exports one bundle with every session of the folder, and only that folder', async () => {
    await vscode.commands.executeCommand('codelapse.selectFolder', projectB);
    await typeInto(fileB, '\n// session in B');
    await vscode.commands.executeCommand('codelapse.selectFolder', projectA);
    const docA = await typeInto(fileA, '\n// last session in A');
    await docA.save();

    const target = vscode.Uri.file(path.join(workspace, '..', 'projectA.codelapse'));
    const written = await vscode.commands.executeCommand<vscode.Uri>('codelapse.exportBundle', { destination: target });
    assert.ok(written, 'should return the bundle file');
    const bundle = decodeBundle(fs.readFileSync(target.fsPath));

    const logsOfA = sessionLogs().filter((log) => fs.readFileSync(log, 'utf-8').includes('"workspaceName":"projectA"'));
    assert.strictEqual(bundle.folderName, 'projectA');
    assert.ok(bundle.folderKey, 'sessions carry a folder key');
    assert.strictEqual(bundle.sessions.length, logsOfA.length, 'every project A session, nothing from B');
    assert.ok(bundle.sessions.every((s) => s.log.includes('"workspaceName":"projectA"')));
    assert.ok(bundle.sessions[bundle.sessions.length - 1].log.includes('"type":"session_end"'), 'running session ended first');

    const a = bundle.files.find((f) => f.path === 'src/a.js');
    assert.strictEqual(a?.sha256, sha256(fs.readFileSync(fileA)), 'file hashes match the folder');
    assert.ok(!JSON.stringify(bundle).includes(workspace), 'no absolute paths in the bundle');
  });

  it('offers the tester commands, and refuses a submission page that is not a web address', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['codelapse.getStarted', 'codelapse.openSubmissionPage', 'codelapse.exportBundle', 'codelapse.statusMenu']) {
      assert.ok(commands.includes(id), `${id} should be registered`);
    }

    const config = vscode.workspace.getConfiguration('codelapse');
    await config.update('submissionUrl', 'file:///etc/passwd', vscode.ConfigurationTarget.Global);
    try {
      const opened = await vscode.commands.executeCommand<boolean>('codelapse.openSubmissionPage');
      assert.strictEqual(opened, false, 'a file: address must not be opened');
    } finally {
      await config.update('submissionUrl', undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
