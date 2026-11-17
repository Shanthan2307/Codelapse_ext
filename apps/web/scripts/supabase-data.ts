/**
 * Moves data between the local data folder and Supabase.
 *
 *   npm run data:migrate                        copy apps/web/data into Supabase (skips submissions already there)
 *   npm run data:migrate -- --include-archives  also copy apps/web/data-archive-* (earlier runs)
 *   npm run data:pull -- --out <folder>         copy everything in Supabase into a local folder
 *
 * Reads SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY)
 * from the environment or apps/web/.env.local. The local folder is
 * CODELAPSE_DATA_DIR, or apps/web/data.
 */
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { LocalBackend } from '../src/lib/storage/local';
import { SupabaseBackend, supabaseConfigFromEnv } from '../src/lib/storage/supabase';
import { Backend, DOC_KINDS } from '../src/lib/storage/types';
import { SALT_SETTING } from '../src/lib/research/pseudonym';
import type { SubmissionRecord } from '../src/lib/types';

const webDir = path.resolve(__dirname, '..');

/** Copies one submission's files and records; the submission row comes before its records (they reference it). */
export async function copySubmission(from: Backend, to: Backend, record: SubmissionRecord): Promise<void> {
  const files = ['recording.codelapse', ...record.files.map((f) => `code/${path.basename(f.name)}`)];
  for (const name of files) {
    const bytes = await from.getFile(`submissions/${record.id}/${name}`);
    if (bytes) await to.putFile(`submissions/${record.id}/${name}`, bytes);
  }
  await to.saveSubmission(record);
  for (const kind of DOC_KINDS) {
    const doc = await from.getDoc(record.id, kind);
    if (doc) await to.putDoc(record.id, kind, doc.data);
  }
}

/** Runs `task` with the local backend reading `dir`. */
async function inFolder<T>(dir: string, task: () => Promise<T>): Promise<T> {
  const before = process.env.CODELAPSE_DATA_DIR;
  process.env.CODELAPSE_DATA_DIR = dir;
  try {
    return await task();
  } finally {
    if (before === undefined) delete process.env.CODELAPSE_DATA_DIR;
    else process.env.CODELAPSE_DATA_DIR = before;
  }
}

async function migrate(dataDir: string, includeArchives: boolean): Promise<void> {
  const cloud = new SupabaseBackend(supabaseConfigFromEnv());
  const local = new LocalBackend();
  const dirs = [dataDir];
  if (includeArchives) {
    const parent = path.dirname(dataDir);
    const names = (await fs.readdir(parent).catch(() => [] as string[])).filter((n) => n.startsWith(`${path.basename(dataDir)}-archive-`));
    dirs.push(...names.sort().map((n) => path.join(parent, n)));
  }

  // The salt goes first, so participant codes online match the ones in earlier exports.
  const salt = process.env.CODELAPSE_RESEARCH_SALT || (await inFolder(dataDir, () => local.getSetting(SALT_SETTING)));
  if (salt) {
    const stored = await cloud.setSettingOnce(SALT_SETTING, salt);
    if (stored !== salt) {
      console.warn('Warning: Supabase already has a different research salt; participant codes will not match earlier exports.');
    }
  }

  const existing = new Set((await cloud.listSubmissions()).map((r) => r.id));
  let copied = 0;
  for (const dir of dirs) {
    const records = await inFolder(dir, () => local.listSubmissions());
    for (const record of records) {
      if (existing.has(record.id)) continue;
      await inFolder(dir, () => copySubmission(local, cloud, record));
      existing.add(record.id);
      copied++;
      console.log(`  copied ${record.id} (${record.studentName ?? record.studentId}, ${record.assignmentId}) from ${path.relative(webDir, dir)}`);
    }
  }
  console.log(`Copied ${copied} submission(s) to Supabase; ${existing.size} are there now.`);
}

export async function pull(outDir: string): Promise<number> {
  const cloud = new SupabaseBackend(supabaseConfigFromEnv());
  const local = new LocalBackend();
  const records = await cloud.listSubmissions();
  await inFolder(outDir, async () => {
    for (const record of records) await copySubmission(cloud, local, record);
    const salt = await cloud.getSetting(SALT_SETTING);
    if (salt) await local.setSettingOnce(SALT_SETTING, salt);
  });
  return records.length;
}

function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const envFile = path.join(webDir, '.env.local');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const command = process.argv[2];
  const dataDir = path.resolve(process.env.CODELAPSE_DATA_DIR ?? path.join(webDir, 'data'));
  if (command === 'migrate') {
    await migrate(dataDir, process.argv.includes('--include-archives'));
  } else if (command === 'pull') {
    const out = path.resolve(option('--out') ?? path.join(webDir, 'data-supabase'));
    const n = await pull(out);
    console.log(`Copied ${n} submission(s) from Supabase into ${out}. It holds student code and answers: keep it private.`);
  } else {
    console.error('Usage: supabase-data.ts migrate [--include-archives] | pull [--out <folder>]');
    process.exit(2);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
