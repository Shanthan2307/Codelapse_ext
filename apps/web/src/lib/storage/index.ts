import { LocalBackend } from './local';
import { SupabaseBackend, supabaseConfigFromEnv } from './supabase';
import type { Backend } from './types';

let override: Backend | null = null;
let cached: { key: string; backend: Backend } | null = null;

/**
 * The storage in use: Supabase when CODELAPSE_STORAGE=supabase (the hosted
 * site), otherwise the local data folder (npm run demo, development, tests).
 */
export function backend(): Backend {
  if (override) return override;
  const mode = process.env.CODELAPSE_STORAGE?.trim().toLowerCase() === 'supabase' ? 'supabase' : 'local';
  const key = mode === 'supabase' ? `supabase:${process.env.SUPABASE_URL}` : 'local';
  if (mode === 'local' && process.env.VERCEL) {
    // Vercel's disk is wiped between requests: local storage there would lose submissions.
    throw new Error('On Vercel, set CODELAPSE_STORAGE=supabase (and SUPABASE_URL, SUPABASE_SECRET_KEY); local storage would lose data.');
  }
  if (cached?.key !== key) {
    cached = { key, backend: mode === 'supabase' ? new SupabaseBackend(supabaseConfigFromEnv()) : new LocalBackend() };
  }
  return cached.backend;
}

/** For tests and scripts: use this backend until reset with null. */
export function useBackend(next: Backend | null): void {
  override = next;
}

export type { Backend, DocKind, StoredDoc } from './types';
