import { createHash, randomBytes } from 'crypto';
import { backend } from '../storage';

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
 * the storage's research-salt setting (created on first use: research-salt.txt
 * in the local data folder, or the settings table in Supabase). Keep that file private:
 * anyone with it and the roster can recompute the codes.
 */
export async function researchSalt(): Promise<string> {
  const fromEnv = process.env.CODELAPSE_RESEARCH_SALT;
  if (fromEnv) return fromEnv;
  const saved = await backend().getSetting(SALT_SETTING);
  if (saved) return saved;
  // If another request saved one first, setSettingOnce returns theirs.
  return backend().setSettingOnce(SALT_SETTING, randomBytes(16).toString('hex'));
}

/** Stored as research-salt.txt in the local data folder, or a row in Supabase's settings table. */
export const SALT_SETTING = 'research-salt';
