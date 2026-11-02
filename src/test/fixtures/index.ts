import * as path from 'path';
import Mocha from 'mocha';
// Sends '@codelapse/core' to its compiled copy, as for the integration tests.
import { silenceNotifications } from '../integration/index';

export async function run(): Promise<void> {
  await silenceNotifications();
  const mocha = new Mocha({ ui: 'bdd', color: true, timeout: 10 * 60 * 1000 });
  mocha.addFile(path.resolve(__dirname, 'generate.fixture.js'));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures > 0 ? reject(new Error(`${failures} scenarios failed.`)) : resolve()));
  });
}
