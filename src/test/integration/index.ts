import * as path from 'path';
import Mocha from 'mocha';
import { glob } from 'glob';

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'bdd', color: true, timeout: 60000 });
  const files = await glob('**/*.int.test.js', { cwd: __dirname });
  files.sort().forEach((f) => mocha.addFile(path.resolve(__dirname, f)));

  return new Promise((resolve, reject) => {
    mocha.run((failures) => (failures > 0 ? reject(new Error(`${failures} tests failed.`)) : resolve()));
  });
}
