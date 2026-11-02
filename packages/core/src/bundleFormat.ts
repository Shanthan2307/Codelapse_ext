import { createHash } from 'crypto';
import { gunzipSync, gzipSync } from 'zlib';

/**
 * The .codelapse file: everything recorded for one assignment folder, in one
 * file a server can read. It is gzip-compressed JSON, so it needs no extra
 * libraries to write or read.
 *
 * The hashes detect damaged or partly edited files. They do not prove a
 * recording is genuine, since anyone can recompute them.
 */
export const BUNDLE_FORMAT = 'codelapse-bundle';
export const BUNDLE_VERSION = 1;
export const BUNDLE_EXTENSION = '.codelapse';

export interface BundleSession {
  id: string;
  startTime: number;
  endTime?: number;
  /** The session's raw append-only log (.jsonl), exactly as recorded. */
  log: string;
  logSha256: string;
}

/** A file in the folder when the bundle was made: lets a server match it to the submitted code. */
export interface BundleFile {
  path: string;
  size: number;
  sha256: string;
}

export interface Bundle {
  format: typeof BUNDLE_FORMAT;
  version: number;
  createdAt: number;
  extensionVersion: string;
  folderName: string;
  /** Same for every session of one folder on one computer, without revealing its path. */
  folderKey: string | null;
  sessions: BundleSession[];
  files: BundleFile[];
}

export function sha256(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function encodeBundle(bundle: Bundle): Uint8Array {
  return gzipSync(Buffer.from(JSON.stringify(bundle), 'utf-8'));
}

/** Reads a .codelapse file, rejecting anything that is not a complete, undamaged bundle. */
export function decodeBundle(data: Uint8Array): Bundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(gunzipSync(data).toString('utf-8'));
  } catch {
    throw new Error('Not a CodeLapse bundle: the file is not readable.');
  }

  const bundle = parsed as Partial<Bundle>;
  if (bundle.format !== BUNDLE_FORMAT) {
    throw new Error('Not a CodeLapse bundle.');
  }
  if (bundle.version !== BUNDLE_VERSION) {
    throw new Error(`Unsupported CodeLapse bundle version ${bundle.version}.`);
  }
  if (!Array.isArray(bundle.sessions) || !Array.isArray(bundle.files)) {
    throw new Error('CodeLapse bundle is incomplete.');
  }
  for (const session of bundle.sessions) {
    if (typeof session.log !== 'string' || sha256(session.log) !== session.logSha256) {
      throw new Error(`Session ${session.id} in the bundle is damaged or was changed.`);
    }
  }
  return bundle as Bundle;
}
