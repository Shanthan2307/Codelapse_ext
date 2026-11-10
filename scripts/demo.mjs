#!/usr/bin/env node
// Starts the submission website for a test session: builds it, checks for an
// AI key (Featherless, OpenAI or Anthropic), makes sure the instructor pages have a password, prints
// the addresses to give testers, then serves it to the local network on port 3100.
//
//   npm run demo               build, then start
//   npm run demo -- --no-build start the existing build
//
// Uses CODELAPSE_DATA_DIR for submissions when set, otherwise apps/web/data.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webDir = path.join(root, 'apps', 'web');
const port = Number(process.env.PORT ?? 3100);
const assignmentPath = '/courses/cs101/assignments/a3-reverse';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a && (a.family === 'IPv4' || a.family === 4) && !a.internal)
    .map((a) => a.address);
}

const envFile = path.join(webDir, '.env.local');

/** A value from the environment or apps/web/.env.local (which the site also reads). */
function setting(name) {
  if (process.env[name]) return process.env[name];
  if (!fs.existsSync(envFile)) return null;
  const match = fs.readFileSync(envFile, 'utf-8').match(new RegExp(`^\\s*${name}\\s*=\\s*(\\S+)`, 'm'));
  return match ? match[1] : null;
}

/** The instructor password: the existing one, or a new one saved to .env.local (never committed). */
function instructorPassword() {
  const existing = setting('CODELAPSE_INSTRUCTOR_PASSWORD');
  if (existing) return existing;
  const created = randomBytes(9).toString('base64url');
  const before = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf-8') : '';
  const separator = before && !before.endsWith('\n') ? '\n' : '';
  fs.writeFileSync(envFile, `${before}${separator}CODELAPSE_INSTRUCTOR_PASSWORD=${created}\n`, { mode: 0o600 });
  return created;
}

// 1. Build, so the site always matches the code (skip with --no-build).
if (!process.argv.includes('--no-build') || !fs.existsSync(path.join(webDir, '.next', 'BUILD_ID'))) {
  console.log('Building the website…\n');
  const build = spawnSync('npm', ['run', 'web:build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  if (build.status !== 0) {
    console.error('\nThe build failed. Fix the errors above and run `npm run demo` again.');
    process.exit(build.status ?? 1);
  }
}

// 2. Check the key, without printing it, and make sure the instructor pages are locked.
const password = instructorPassword();
const AI_KEYS = { featherless: 'FEATHERLESS_API_KEY', openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' };
const chosenProvider = setting('CODELAPSE_AI_PROVIDER')?.toLowerCase();
const provider = AI_KEYS[chosenProvider] ? chosenProvider : Object.keys(AI_KEYS).find((p) => setting(AI_KEYS[p])) ?? 'anthropic';
if (!setting(AI_KEYS[provider])) {
  console.warn(
    `Warning: no ${AI_KEYS[provider]} found (in the environment or apps/web/.env.local).\n` +
      'Uploads will work, but questions will show as failed until a working AI key is set.\n'
  );
}

// 3. Tell the instructor what to hand out.
const addresses = lanAddresses();
const dataDir = process.env.CODELAPSE_DATA_DIR ?? path.join(webDir, 'data');
console.log('CodeLapse demo site');
if (addresses.length === 0) {
  console.log('  No network address found: only this computer can reach the site.');
  console.log(`  Assignment page: http://localhost:${port}${assignmentPath}`);
  console.log(`  Instructor view: http://localhost:${port}/instructor`);
} else {
  console.log('Give testers this submission page address (VS Code asks for it the first time they open the submission page):');
  for (const address of addresses) console.log(`  http://${address}:${port}${assignmentPath}`);
  console.log('Instructor view (on this computer use localhost):');
  for (const address of addresses) console.log(`  http://${address}:${port}/instructor`);
}
console.log(`AI provider: ${provider}`);
console.log(`Instructor password: ${password}   (any user name; saved in apps/web/.env.local)`);
console.log(`Submissions are saved in: ${dataDir}`);
console.log('Students pick their name from a list, so run this only on a network you trust. Stop with Ctrl+C.\n');

// 4. Serve to the whole network.
const server = spawn(npx, ['next', 'start', '-H', '0.0.0.0', '-p', String(port)], {
  cwd: webDir,
  stdio: 'inherit',
  env: { ...process.env, CODELAPSE_INSTRUCTOR_PASSWORD: password }
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}
server.on('exit', (code, signal) => process.exit(signal ? 0 : (code ?? 0)));
