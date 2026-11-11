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
const instructorPassword = 'smoke-test-password';
const plainFetch = globalThis.fetch;
// Every request signs in as the instructor; student routes simply ignore it.
const fetch = (url, init = {}) =>
  plainFetch(url, {
    ...init,
    headers: { ...init.headers, authorization: `Basic ${Buffer.from(`instructor:${instructorPassword}`).toString('base64')}` }
  });
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
  env: { ...process.env, CODELAPSE_DATA_DIR: dataDir, CODELAPSE_INSTRUCTOR_PASSWORD: instructorPassword },
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

  // Questions are written after the upload response. Without Anthropic credentials
  // (as in CI) they end up "failed" with a reason; with credentials, "ready".
  let questions;
  for (let i = 0; i < 240; i++) {
    questions = await (await fetch(`${base}/api/submissions/${ids[0]}/questions`)).json();
    if (questions.status !== 'pending') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (questions.status === 'pending') fail('questions were still being prepared after 2 minutes');
  if (JSON.stringify(questions).includes('rationale')) fail('the student view of the questions leaked reviewer hints');
  const answerBody = { answers: questions.questions.map((q) => ({ questionId: q.id, text: 'Because it stops halfway through the string.' })) };
  const answered = await fetch(`${base}/api/submissions/${ids[0]}/answers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(answerBody)
  });
  const expected = questions.status === 'ready' ? 201 : 409;
  if (answered.status !== expected) fail(`answers with questions ${questions.status}: expected ${expected}, got ${answered.status}`);
  console.log(`ok  questions ${questions.status}; answers answered ${answered.status}`);

  // With answers in, the review runs in the background: wait for it, so it
  // finishes before this test removes its data folder, and check it worked.
  if (answered.status === 201) {
    const reviewFile = path.join(dataDir, 'submissions', ids[0], 'evaluation.json');
    let review = null;
    for (let i = 0; i < 240; i++) {
      try {
        review = JSON.parse(fs.readFileSync(reviewFile, 'utf-8'));
      } catch {
        review = null;
      }
      if (review && review.status !== 'pending') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!review || review.status !== 'ready') fail(`the answer review ended as ${review?.status ?? 'missing'}: ${review?.error ?? ''}`);
    console.log(`ok  answers reviewed (${review.model}): ${review.evaluations.map((e) => e.level).join(', ')}`);
  }

  // With answers, the review runs next; without them, retrying a review is refused.
  const retry = await fetch(`${base}/api/submissions/${ids[1]}/evaluation`, { method: 'POST' });
  if (retry.status !== 409) fail(`reviewing a submission with no answers should be refused, got ${retry.status}`);
  console.log('ok  no review without answers');

  // Phase 6 and 7: comparing students, watching a replay, ratings and the research export.
  await page('/instructor/compare', ['Student A']);
  await page(`/instructor/compare/${ids[0]}/${ids[1]}`, ['reverse.c']);
  await page(`/instructor/submissions/${ids[0]}/replay`);
  if (answered.status === 201) {
    // Before any rating is saved, the ratings card must already be there to rate with.
    await page(`/instructor/submissions/${ids[0]}`, ['Your ratings']);
  }
  const feedback = await fetch(`${base}/api/submissions/${ids[0]}/feedback`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ overall: { note: 'smoke test', followUp: true } })
  });
  if (feedback.status !== 200) fail(`saving instructor feedback answered ${feedback.status}`);
  const csv = await fetch(`${base}/api/research/export?assignment=a3-reverse&format=csv&table=submissions`);
  const csvText = await csv.text();
  if (csv.status !== 200 || !csvText.startsWith('participant,')) fail(`research export: ${csv.status} ${csvText.slice(0, 80)}`);
  if (/Student [A-E]|student-[a-e]/.test(csvText)) fail('the research export contains a student name or id');
  console.log(`ok  compare, replay, feedback and research export (${csvText.trim().split('\n').length - 1} rows)`);

  const locked = await plainFetch(`${base}/instructor`);
  if (locked.status !== 401) fail(`/instructor without the password answered ${locked.status}, expected 401`);
  const lockedExport = await plainFetch(`${base}/api/research/export?assignment=a3-reverse`);
  if (lockedExport.status !== 401) fail(`the research export without the password answered ${lockedExport.status}`);
  console.log('ok  instructor pages and research data need the password');

  await page('/courses/cs101/assignments/a3-reverse', ['Reverse a String']);
  await page('/courses/cs101/assignments/a3-reverse-py', ['Reverse a String', 'reverse.py', 'Python']);
  await page('/courses/cs101', ['(C)', '(Python)']);
  await page('/instructor?assignment=a3-reverse-py', ['Python']);

  // The PDF briefs, once they have been written into public/assignments.
  for (const file of ['assignment-3-c-reverse-a-string.pdf', 'assignment-3-python-reverse-a-string.pdf']) {
    if (!fs.existsSync(path.join(webDir, 'public', 'assignments', file))) {
      console.log(`--  skipped /assignments/${file}: not written yet`);
      continue;
    }
    const pdf = await fetch(`${base}/assignments/${file}`);
    if (pdf.status !== 200 || !/application\/pdf/.test(pdf.headers.get('content-type') ?? '')) {
      fail(`/assignments/${file} answered ${pdf.status} ${pdf.headers.get('content-type')}`);
    }
    console.log(`ok  GET /assignments/${file}`);
  }
  await page(`/submissions/${ids[0]}`, ['reverse.c']);
  await page('/instructor', ['Student A', 'Student E']);
  for (const id of ids) await page(`/instructor/submissions/${id}`, ['reverse.c']);

  const stored = fs.readdirSync(path.join(dataDir, 'submissions'));
  if (stored.length !== SUBMISSIONS.length) fail(`expected ${SUBMISSIONS.length} stored submissions, found ${stored.length}`);
  // Let every submission's questions finish before the data folder is removed.
  for (const id of ids) {
    for (let i = 0; i < 240; i++) {
      const status = (await (await fetch(`${base}/api/submissions/${id}/questions`)).json()).status;
      if (status !== 'pending') break;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  console.log('Smoke test passed.');
} finally {
  server.kill();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
