/**
 * Builds the research database: one SQLite file with everything recorded in
 * the pilot. See docs/RESEARCH_PILOT.md for the tables.
 *
 *   npm run research:db
 *   npm run research:db -- --out research/pilot.sqlite --include-archives --names
 *
 * --out <file>          where to write it (default research/codelapse-research-<date>.sqlite)
 * --include-archives    also read apps/web/data-archive-* (earlier runs, kept by demo:reset)
 * --names               include student names (otherwise participant codes only)
 *
 * Reads CODELAPSE_DATA_DIR, or apps/web/data.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { buildResearchDatabase, DataSource } from '../src/lib/research/database';
import { researchSalt } from '../src/lib/research/pseudonym';

const repoRoot = path.resolve(__dirname, '../../..');

function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main(): Promise<void> {
  const dataDir = path.resolve(process.env.CODELAPSE_DATA_DIR ?? path.join(repoRoot, 'apps/web/data'));
  // The salt lives with the current data, so participant codes match the CSV exports.
  process.env.CODELAPSE_DATA_DIR = dataDir;

  const sources: DataSource[] = [{ dir: dataDir, run: 'current' }];
  if (process.argv.includes('--include-archives')) {
    const parent = path.dirname(dataDir);
    const archives = (await fs.readdir(parent).catch(() => [] as string[]))
      .filter((name) => name.startsWith(`${path.basename(dataDir)}-archive-`))
      .sort();
    for (const name of archives) sources.push({ dir: path.join(parent, name), run: name });
  }

  const date = new Date().toISOString().slice(0, 10);
  const outFile = path.resolve(option('--out') ?? path.join(repoRoot, 'research', `codelapse-research-${date}.sqlite`));
  const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf-8')) as { version?: string };
  const saltSource = process.env.CODELAPSE_RESEARCH_SALT ? 'CODELAPSE_RESEARCH_SALT' : 'research-salt.txt in the data folder';

  const counts = await buildResearchDatabase({
    sources,
    outFile,
    salt: await researchSalt(),
    saltSource,
    includeNames: process.argv.includes('--names'),
    appVersion: pkg.version ?? 'unknown'
  });

  console.log(`Research database written to ${path.relative(process.cwd(), outFile) || outFile}`);
  console.log(`Read from: ${sources.map((s) => s.dir).join(', ')}`);
  for (const [table, n] of Object.entries(counts)) console.log(`  ${table.padEnd(20)} ${n}`);
  console.log(
    process.argv.includes('--names')
      ? 'Includes student names: keep this file private.'
      : 'Participants are codes, not names. It still holds student code and answers: keep it private.'
  );
}

main().catch((err) => {
  console.error('Building the research database failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
