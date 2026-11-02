import * as assert from 'assert';
import * as path from 'path';
import {
  isInsideFolder,
  foldersOverlap,
  toProjectRelativePath,
  isIgnoredPath
} from '../../tracker/folderScope';

const root = path.resolve('/work/cs101/assignment-3');

describe('Folder-Scoped Recording Path Tests', () => {
  it('accepts the folder itself and anything beneath it', () => {
    assert.strictEqual(isInsideFolder(root, root), true);
    assert.strictEqual(isInsideFolder(root, path.join(root, 'main.py')), true);
    assert.strictEqual(isInsideFolder(root, path.join(root, 'src', 'deep', 'util.ts')), true);
  });

  it('rejects parents, siblings, and look-alike sibling names', () => {
    assert.strictEqual(isInsideFolder(root, path.resolve('/work/cs101')), false);
    assert.strictEqual(isInsideFolder(root, path.resolve('/work/cs101/assignment-2/main.py')), false);
    // A plain string-prefix check would wrongly accept this one.
    assert.strictEqual(isInsideFolder(root, path.resolve('/work/cs101/assignment-3-old/main.py')), false);
    assert.strictEqual(isInsideFolder(root, path.join(root, '..', 'assignment-2', 'x.py')), false);
  });

  it('honours case-insensitive file systems only when asked to', () => {
    const upper = path.resolve('/WORK/CS101/Assignment-3/main.py');
    assert.strictEqual(isInsideFolder(root, upper, true), true);
    assert.strictEqual(isInsideFolder(root, upper, false), false);
  });

  it('detects overlapping folders in both directions', () => {
    assert.strictEqual(foldersOverlap(root, path.resolve('/work/cs101')), true);
    assert.strictEqual(foldersOverlap(path.resolve('/work/cs101'), root), true);
    assert.strictEqual(foldersOverlap(root, path.resolve('/work/cs101/assignment-2')), false);
  });

  it('produces forward-slash paths relative to the chosen folder', () => {
    assert.strictEqual(toProjectRelativePath(root, path.join(root, 'src', 'App.tsx')), 'src/App.tsx');
    assert.strictEqual(toProjectRelativePath(root, path.join(root, 'main.py')), 'main.py');
  });

  it('ignores files inside .git and node_modules', () => {
    assert.strictEqual(isIgnoredPath('node_modules/react/index.js'), true);
    assert.strictEqual(isIgnoredPath('client/node_modules/x.js'), true);
    assert.strictEqual(isIgnoredPath('.git/config'), true);
    assert.strictEqual(isIgnoredPath('src/node_modules_helper.ts'), false);
    assert.strictEqual(isIgnoredPath('src/App.tsx'), false);
  });
});
