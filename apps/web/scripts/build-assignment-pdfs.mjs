#!/usr/bin/env node
// Renders the assignment briefs in apps/web/assignments/*.html to PDF in
// apps/web/public/assignments/, where the site serves them for download.
// Uses headless Chrome; set CHROME_PATH if Chrome is installed elsewhere.
//
//   node apps/web/scripts/build-assignment-pdfs.mjs
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(webDir, 'assignments');
const outDir = path.join(webDir, 'public', 'assignments');

const BRIEFS = [
  { source: 'c.html', pdf: 'assignment-3-c-reverse-a-string.pdf' },
  { source: 'python.html', pdf: 'assignment-3-python-reverse-a-string.pdf' }
];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);

const chrome = CHROME_CANDIDATES.find((candidate) => fs.existsSync(candidate));
if (!chrome) {
  console.error(
    'Google Chrome was not found. Install Chrome, or set CHROME_PATH to its executable, then run this again.\n' +
      `Looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}`
  );
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
// A throwaway profile, so the run doesn't touch the user's Chrome.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-pdf-'));

let failed = false;
try {
  for (const brief of BRIEFS) {
    const source = path.join(sourceDir, brief.source);
    const target = path.join(outDir, brief.pdf);
    fs.rmSync(target, { force: true });
    const result = spawnSync(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        `--user-data-dir=${profile}`,
        '--no-pdf-header-footer',
        '--virtual-time-budget=3000',
        `--print-to-pdf=${target}`,
        pathToFileURL(source).href
      ],
      { encoding: 'utf-8' }
    );
    if (!fs.existsSync(target) || fs.statSync(target).size === 0) {
      console.error(`Could not render ${brief.source}:\n${result.stderr || result.error || 'no output'}`);
      failed = true;
      continue;
    }
    console.log(`${path.relative(webDir, target)}  ${(fs.statSync(target).size / 1024).toFixed(0)} KB`);
  }
} finally {
  fs.rmSync(profile, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
