import * as path from 'path';

/**
 * Pure path helpers for folder-scoped recording. Kept free of the `vscode`
 * module so they can be unit tested directly.
 */

/** macOS and Windows file systems are case-insensitive by default. */
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

function normalize(fsPath: string, caseInsensitive: boolean): string {
  const resolved = path.resolve(fsPath);
  return caseInsensitive ? resolved.toLowerCase() : resolved;
}

/**
 * True when `fsPath` is the folder itself or anything beneath it.
 * Uses path.relative rather than a string prefix check, so a sibling such as
 * "/work/app-old" is not mistaken for being inside "/work/app".
 */
export function isInsideFolder(
  folderFsPath: string,
  fsPath: string,
  caseInsensitive: boolean = CASE_INSENSITIVE
): boolean {
  const rel = path.relative(normalize(folderFsPath, caseInsensitive), normalize(fsPath, caseInsensitive));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** True when either folder contains the other (or they are the same folder). */
export function foldersOverlap(
  a: string,
  b: string,
  caseInsensitive: boolean = CASE_INSENSITIVE
): boolean {
  return isInsideFolder(a, b, caseInsensitive) || isInsideFolder(b, a, caseInsensitive);
}

/**
 * Path of `fsPath` relative to the recorded folder, always with "/" separators
 * so recordings look identical on every OS (e.g. "src/components/App.tsx").
 */
export function toProjectRelativePath(folderFsPath: string, fsPath: string): string {
  return path.relative(path.resolve(folderFsPath), path.resolve(fsPath)).split(path.sep).join('/');
}

/** Directory names whose contents are never recorded, even inside the chosen folder. */
const IGNORED_SEGMENTS = new Set(['.git', 'node_modules']);

/** True when the file sits inside an ignored directory such as node_modules. */
export function isIgnoredPath(projectRelativePath: string): boolean {
  return projectRelativePath.split('/').some((segment) => IGNORED_SEGMENTS.has(segment));
}
