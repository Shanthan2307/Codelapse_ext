import * as path from 'path';
import * as vscode from 'vscode';
import Mocha from 'mocha';
import { glob } from 'glob';

/**
 * '@codelapse/core' points at TypeScript source, which ts-node and webpack
 * compile. These tests run as plain compiled JavaScript, so send the package
 * to its compiled copy next to them.
 */
const CORE_ENTRIES: Record<string, string> = {
  '@codelapse/core': '../../../packages/core/src/index.js',
  '@codelapse/core/node': '../../../packages/core/node.js'
};
type Resolve = (request: string, ...rest: unknown[]) => string;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const NodeModule = require('module') as { _resolveFilename: Resolve };
const resolveFilename = NodeModule._resolveFilename;
NodeModule._resolveFilename = function (this: unknown, request: string, ...rest: unknown[]) {
  const compiled = CORE_ENTRIES[request];
  return resolveFilename.call(this, compiled ? path.resolve(__dirname, compiled) : request, ...rest);
};

/**
 * Do Not Disturb keeps information and warning pop-ups (CodeLapse's own
 * "Recording …" messages included) out of the test window. Errors still show.
 * Each test run starts from a fresh profile, so one toggle turns it on.
 */
export async function silenceNotifications(): Promise<void> {
  try {
    await vscode.commands.executeCommand('notifications.toggleDoNotDisturbMode');
  } catch {
    // Older VS Code without Do Not Disturb: pop-ups simply stay visible.
  }
}

export async function run(): Promise<void> {
  await silenceNotifications();
  const mocha = new Mocha({ ui: 'bdd', color: true, timeout: 60000 });
  const files = await glob('**/*.int.test.js', { cwd: __dirname });
  files.sort().forEach((f) => mocha.addFile(path.resolve(__dirname, f)));

  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures > 0 ? reject(new Error(`${failures} tests failed.`)) : resolve()));
  });
}
