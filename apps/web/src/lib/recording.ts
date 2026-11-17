import { parseSessionLog, Session } from '@codelapse/core';
import { decodeBundle } from '@codelapse/core/node';
import { readRecording } from './store';

/** The recorded sessions of a submission, read back from its stored .codelapse file. */
export async function readSessions(id: string): Promise<Session[] | null> {
  try {
    const bytes = await readRecording(id);
    return bytes ? decodeBundle(bytes).sessions.map((s) => parseSessionLog(s.log)) : null;
  } catch {
    return null;
  }
}
