import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Session } from '@codelapse/core';
import { SessionManager } from '../tracker/SessionManager';
import { RecordingScope } from '../tracker/RecordingScope';
import { isIgnoredPath, toProjectRelativePath } from '../tracker/folderScope';
import { BUNDLE_EXTENSION, BUNDLE_FORMAT, BUNDLE_VERSION, Bundle, BundleFile, encodeBundle, sha256 } from '@codelapse/core/node';

export interface BundleOptions {
  /** File to write, skipping the save dialog (used by tests). */
  destination?: vscode.Uri;
}

/** Folders this large are almost certainly not one assignment; stop listing files. */
const MAX_LISTED_FILES = 2000;

/**
 * Writes one .codelapse file holding every recorded session of the chosen
 * folder, plus a hash of each file in it, ready to upload with the code.
 */
export class BundleExporter {
  public static async run(
    sessionManager: SessionManager,
    scope: RecordingScope,
    extensionVersion: string,
    options: BundleOptions = {}
  ): Promise<vscode.Uri | undefined> {
    const folder = scope.getFolder();
    const folderName = scope.getFolderName();
    if (!folder || !folderName) {
      vscode.window.showWarningMessage('CodeLapse: Choose the assignment folder first.');
      return undefined;
    }

    const folderKey = scope.getFolderKey();
    const sessions: Bundle['sessions'] = [];
    for (const uri of await sessionManager.listSavedSessions()) {
      if (!uri.fsPath.endsWith('.jsonl')) {
        continue;
      }
      const session = await sessionManager.loadSession(uri);
      if (session && belongsToFolder(session, folderKey, folderName)) {
        const log = await fs.promises.readFile(uri.fsPath, 'utf-8');
        sessions.push({ id: session.id, startTime: session.startTime, endTime: session.endTime, log, logSha256: sha256(log) });
      }
    }
    if (sessions.length === 0) {
      vscode.window.showWarningMessage(`CodeLapse: No recorded sessions for "${folderName}" yet.`);
      return undefined;
    }
    sessions.sort((a, b) => a.startTime - b.startTime);

    let target = options.destination;
    if (!target) {
      target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.joinPath(folder, '..', `${folderName}${BUNDLE_EXTENSION}`),
        filters: { 'CodeLapse bundle': [BUNDLE_EXTENSION.slice(1)] },
        title: 'CodeLapse: Save the assignment bundle'
      });
      if (!target) {
        return undefined;
      }
    }

    const bundle: Bundle = {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      createdAt: Date.now(),
      extensionVersion,
      folderName,
      folderKey,
      sessions,
      files: await listFiles(folder.fsPath)
    };
    await vscode.workspace.fs.writeFile(target, encodeBundle(bundle));
    return target;
  }
}

/** Sessions from before folder keys existed are matched by folder name. */
function belongsToFolder(session: Session, folderKey: string | null, folderName: string): boolean {
  return session.folderKey ? session.folderKey === folderKey : session.workspaceName === folderName;
}

async function listFiles(root: string): Promise<BundleFile[]> {
  const files: BundleFile[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
      if (files.length >= MAX_LISTED_FILES) {
        return;
      }
      const full = path.join(dir, entry.name);
      const rel = toProjectRelativePath(root, full);
      if (isIgnoredPath(rel)) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const data = await fs.promises.readFile(full);
        files.push({ path: rel, size: data.length, sha256: sha256(data) });
      }
    }
  };
  await walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
