#!/usr/bin/env node
// Starts the next test session with no submissions, without losing the last
// one: moves the data folder aside to data-archive-<date-time>. Never deletes.
//
//   npm run demo:reset
//
// Uses CODELAPSE_DATA_DIR when set, otherwise apps/web/data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.CODELAPSE_DATA_DIR ?? path.join(root, 'apps', 'web', 'data'));

if (!fs.existsSync(dataDir)) {
  console.log(`Nothing to reset: ${dataDir} does not exist.`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
let archive = `${dataDir.replace(/[\\/]+$/, '')}-archive-${stamp}`;
for (let n = 2; fs.existsSync(archive); n++) archive = `${dataDir}-archive-${stamp}-${n}`;

const count = fs.existsSync(path.join(dataDir, 'submissions')) ? fs.readdirSync(path.join(dataDir, 'submissions')).length : 0;
fs.renameSync(dataDir, archive);
console.log(`Moved ${count} submission folder(s) from:\n  ${dataDir}\nto:\n  ${archive}`);
console.log('The next run starts with no submissions.');
