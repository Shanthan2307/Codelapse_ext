// End-to-end smoke test: starts the built site, submits the scripted
// recordings as the five demo students, and checks every page renders.
// Run `npm run build` first. Uses a throwaway data folder.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, '..');
const recordings = path.resolve(webDir, '../../fixtures/recordings');
const port = 3199;
const base = `http://localhost:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-smoke-'));

const SUBMISSIONS = [
  ['student-a', 'honest-incremental'],
  ['student-b', 'pasted-solution'],
  ['student-c', 'weak-but-honest'],
  ['student-d', 'abandoned-approach'],
  ['student-e', 'edited-after-recording']
];

function fail(message) {
  throw new Error(message);
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(base)).status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  fail('The site did not start within 30 seconds.');
}

function form(studentId, name, { codeName = 'reverse.c' } = {}) {
  const dir = path.join(recordings, name);
  const body = new FormData();
  body.set('studentId', studentId);
  body.set('assignmentId', 'a3-reverse');
  body.set('recording', new Blob([fs.readFileSync(path.join(dir, `${name}.codelapse`))]), `${name}.codelapse`);
  body.append('code', new Blob([fs.readFileSync(path.join(dir, 'submission', 'reverse.c'))]), codeName);
  return body;
}

async function page(url, mustInclude = []) {
  const response = await fetch(base + url);
  const html = await response.text();
  if (response.status !== 200) fail(`${url} answered ${response.status}`);
  for (const text of mustInclude) {
    if (!html.includes(text)) fail(`${url} does not mention "${text}"`);
  }
  console.log(`ok  GET ${url}`);
}

const server = spawn('npx', ['next', 'start', '--port', String(port)], {
  cwd: webDir,
  env: { ...process.env, CODELAPSE_DATA_DIR: dataDir },
  stdio: ['ignore', 'ignore', 'inherit']
});

try {
  await waitForServer();
  const ids = [];
  for (const [studentId, name] of SUBMISSIONS) {
    const response = await fetch(`${base}/api/submissions`, { method: 'POST', body: form(studentId, name) });
    const json = await response.json();
    if (response.status !== 201) fail(`${name}: ${response.status} ${JSON.stringify(json)}`);
    ids.push(json.id);
    console.log(`ok  submitted ${name} as ${studentId}`);
  }

  const bad = await fetch(`${base}/api/submissions`, { method: 'POST', body: form('student-a', 'honest-incremental', { codeName: 'notes.pdf' }) });
  const badJson = await bad.json();
  if (bad.status !== 400 || !/not a C source file/.test(badJson.error)) fail(`a bad upload was not refused clearly: ${JSON.stringify(badJson)}`);
  console.log('ok  a bad upload gets a clear message');

  await page('/courses/cs101/assignments/a3-reverse', ['Reverse a String']);
  await page(`/submissions/${ids[0]}`, ['reverse.c']);
  await page('/instructor', ['Student A', 'Student E']);
  for (const id of ids) await page(`/instructor/submissions/${id}`, ['reverse.c']);

  const stored = fs.readdirSync(path.join(dataDir, 'submissions'));
  if (stored.length !== SUBMISSIONS.length) fail(`expected ${SUBMISSIONS.length} stored submissions, found ${stored.length}`);
  console.log('Smoke test passed.');
} finally {
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
