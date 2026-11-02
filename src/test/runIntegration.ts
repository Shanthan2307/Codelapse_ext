import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

/**
 * Launches a real VS Code with a throwaway profile and workspace, loads the
 * built extension from dist/, and runs src/test/integration inside it.
 *
 * Uses the locally installed VS Code when found (set VSCODE_EXECUTABLE to
 * override); otherwise @vscode/test-electron downloads one.
 */
const INSTALLED_VSCODE: Record<string, string> = {
  darwin: '/Applications/Visual Studio Code.app/Contents/MacOS/Code'
};

function createWorkspace(root: string): void {
  const files: Record<string, string> = {
    'projectA/src/a.js': '// project A\n',
    'projectA/src/App.jsx': "import { useState } from 'react';\n",
    'projectA/src/main.c': '#include <stdio.h>\n\nint main(void) {\n  return 0;\n}\n',
    'projectA/index.html': '<div id="root"></div>\n<script type="module" src="/src/main.jsx"></script>\n',
    'projectB/b.js': '// project B\n'
  };
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
}

async function main() {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'codelapse-it-'));
  const workspace = path.join(sandbox, 'workspace');
  const userDataDir = path.join(sandbox, 'user-data');
  const extensionsDir = path.join(sandbox, 'extensions');
  createWorkspace(workspace);

  const candidate = process.env.VSCODE_EXECUTABLE || INSTALLED_VSCODE[process.platform];
  const vscodeExecutablePath = candidate && fs.existsSync(candidate) ? candidate : undefined;

  try {
    await runTests({
      vscodeExecutablePath,
      // CODELAPSE_EXTENSION_PATH lets the same tests run against an unpacked .vsix.
      extensionDevelopmentPath: process.env.CODELAPSE_EXTENSION_PATH || path.resolve(__dirname, '../../'),
      extensionTestsPath: path.resolve(__dirname, './integration/index'),
      launchArgs: [
        workspace,
        '--user-data-dir', userDataDir,
        '--extensions-dir', extensionsDir,
        '--disable-extensions',
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes'
      ],
      extensionTestsEnv: {
        CODELAPSE_TEST_WORKSPACE: workspace,
        CODELAPSE_TEST_STORAGE: path.join(userDataDir, 'User', 'globalStorage', 'shanthan2307.codelapse')
      }
    });
  } catch (err) {
    console.error('Integration tests failed:', err);
    process.exitCode = 1;
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

main();
