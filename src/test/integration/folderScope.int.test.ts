import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Session } from '../../models';
import { LogStreamer } from '../../storage/LogStreamer';
import { buildFileFlow } from '../../ui/flow/FileFlowModel';

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

  it('never writes absolute paths (or the username in them) into recordings', async () => {
    await vscode.commands.executeCommand('codelapse.selectFolder', projectA);
    // Saving a file that uses hooks triggers the React watcher's milestone.
    const app = await typeInto(path.join(workspace, 'projectA', 'src', 'App.jsx'), '\nconst [n, setN] = useState(0);');
    await app.save();
    await sleep(300);
    const session = await vscode.commands.executeCommand<Session>('codelapse.stopSession');

    const hookEvent = session!.events.find((e) => e.type === 'framework' && e.detail?.includes('useState'));
    assert.ok(hookEvent, 'saving a hook file should record a framework milestone');
    assert.strictEqual(hookEvent!.filePath, 'src/App.jsx');

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
});
