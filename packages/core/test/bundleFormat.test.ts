import * as assert from 'assert';
import { gzipSync } from 'zlib';
import { BUNDLE_FORMAT, BUNDLE_VERSION, Bundle, decodeBundle, encodeBundle, sha256 } from '../src/bundleFormat';

const log = '{"type":"session_start","timestamp":1,"data":{"id":"s1","workspaceName":"hw1","startTime":1}}\n';
const bundle = (): Bundle => ({
  format: BUNDLE_FORMAT,
  version: BUNDLE_VERSION,
  createdAt: 2,
  extensionVersion: '0.0.1',
  folderName: 'hw1',
  folderKey: 'k',
  sessions: [{ id: 's1', startTime: 1, log, logSha256: sha256(log) }],
  files: [{ path: 'main.c', size: 3, sha256: sha256('abc') }]
});

describe('CodeLapse bundle format', () => {
  it('reads back exactly what was written', () => {
    assert.deepStrictEqual(decodeBundle(encodeBundle(bundle())), bundle());
  });

  it('rejects a session log that was changed after export', () => {
    const tampered = bundle();
    tampered.sessions[0].log = log.replace('hw1', 'hw2');
    assert.throws(() => decodeBundle(encodeBundle(tampered)), /damaged or was changed/);
  });

  it('rejects files that are not bundles, and unknown versions', () => {
    assert.throws(() => decodeBundle(Buffer.from('plain text')), /not readable/);
    assert.throws(() => decodeBundle(gzipSync(Buffer.from('{"format":"other"}'))), /Not a CodeLapse bundle/);
    assert.throws(() => decodeBundle(encodeBundle({ ...bundle(), version: 99 })), /Unsupported/);
  });
});
