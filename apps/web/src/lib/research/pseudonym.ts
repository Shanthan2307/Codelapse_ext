import { createHash, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { dataDir } from '../store';

/**
 * Participant codes for research exports: "P" plus the first 8 hex digits of
 * sha256(salt + studentId). The same salt always gives the same code, so
 * exports from one pilot can be joined; without the salt the codes cannot be
 * turned back into students.
 */
export function participantId(salt: string, studentId: string): string {
  return `P${createHash('sha256').update(salt + studentId).digest('hex').slice(0, 8)}`;
}

/**
 * The salt: CODELAPSE_RESEARCH_SALT if set, otherwise a random one kept in
 * <data>/research-salt.txt (created on first use). Keep that file private:
 * anyone with it and the roster can recompute the codes.
 */
export async function researchSalt(): Promise<string> {
  const fromEnv = process.env.CODELAPSE_RESEARCH_SALT;
  if (fromEnv) return fromEnv;
  const file = path.join(dataDir(), 'research-salt.txt');
  try {
    const saved = (await fs.readFile(file, 'utf-8')).trim();
    if (saved) return saved;
  } catch {
    // Not created yet.
  }
  const salt = randomBytes(16).toString('hex');
  await fs.mkdir(dataDir(), { recursive: true });
  try {
    await fs.writeFile(file, `${salt}\n`, { flag: 'wx', mode: 0o600 });
    return salt;
  } catch {
    // Another request created it first: use theirs.
    return (await fs.readFile(file, 'utf-8')).trim();
  }
}
