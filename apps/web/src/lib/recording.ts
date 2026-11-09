import { promises as fs } from 'fs';
import path from 'path';
import { parseSessionLog, Session } from '@codelapse/core';
import { decodeBundle } from '@codelapse/core/node';
import { dataDir } from './store';

const SAFE_ID = /^[a-z0-9-]+$/;

/** The recorded sessions of a submission, read back from its stored .codelapse file. */
export async function readSessions(id: string): Promise<Session[] | null> {
  if (!SAFE_ID.test(id)) {
    return null;
  }
  try {
    const bytes = await fs.readFile(path.join(dataDir(), 'submissions', id, 'recording.codelapse'));
    return decodeBundle(bytes).sessions.map((s) => parseSessionLog(s.log));
  } catch {
    return null;
  }
}
