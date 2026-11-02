import * as vscode from 'vscode';
import * as path from 'path';
import { isInsideFolder, foldersOverlap, toProjectRelativePath, isIgnoredPath } from './folderScope';

/** workspaceState key: the chosen folder is remembered per VS Code workspace. */
const STATE_KEY = 'codelapse.recordedFolder';

interface FolderPickItem extends vscode.QuickPickItem {
  uri?: vscode.Uri;
}

/**
 * The single folder a recording is limited to. Only files inside it are
 * recorded, and every recorded path is stored relative to it, so a replay
 * shows the project's own structure and nothing else the user had open.
 */
export class RecordingScope implements vscode.Disposable {
  private folder: vscode.Uri | null = null;

  private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri | null>();
  public readonly onDidChange = this._onDidChange.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** Restores the folder chosen earlier in this workspace, if it still exists. */
  public async restore(): Promise<vscode.Uri | null> {
    const saved = this.context.workspaceState.get<string>(STATE_KEY);
    if (!saved) {
      return null;
    }

    const uri = vscode.Uri.parse(saved);
    try {
      const stat = await vscode.workspace.fs.stat(uri);
      if (stat.type & vscode.FileType.Directory) {
        this.folder = uri;
        this._onDidChange.fire(uri);
        return uri;
      }
    } catch {
      // The folder was moved or deleted since it was chosen.
    }

    await this.context.workspaceState.update(STATE_KEY, undefined);
    return null;
  }

  /** Sets and remembers the folder to record. */
  public async setFolder(uri: vscode.Uri): Promise<void> {
    this.folder = uri;
    await this.context.workspaceState.update(STATE_KEY, uri.toString());
    this._onDidChange.fire(uri);
  }

  public getFolder(): vscode.Uri | null {
    return this.folder;
  }

  public getFolderName(): string | null {
    return this.folder ? path.basename(this.folder.fsPath) : null;
  }

  /** True for files inside the chosen folder, excluding .git and node_modules. */
  public contains(uri: vscode.Uri): boolean {
    if (!this.folder || uri.scheme !== 'file') {
      return false;
    }
    if (!isInsideFolder(this.folder.fsPath, uri.fsPath)) {
      return false;
    }
    return !isIgnoredPath(this.relativePath(uri));
  }

  /** Path of a file relative to the chosen folder, e.g. "src/App.tsx". */
  public relativePath(uri: vscode.Uri): string {
    return this.folder ? toProjectRelativePath(this.folder.fsPath, uri.fsPath) : uri.fsPath;
  }

  /** True when `uri` contains the chosen folder or lies inside it. */
  public overlaps(uri: vscode.Uri): boolean {
    return !!this.folder && uri.scheme === 'file' && foldersOverlap(this.folder.fsPath, uri.fsPath);
  }

  /**
   * Asks which folder to record: one of the open workspace folders, or any
   * folder via a dialog (e.g. a single assignment inside a course folder).
   * Resolves to undefined if the user cancels.
   */
  public async pickFolder(): Promise<vscode.Uri | undefined> {
    const items: FolderPickItem[] = (vscode.workspace.workspaceFolders ?? []).map((f) => ({
      label: `$(folder) ${f.name}`,
      description: f.uri.fsPath,
      uri: f.uri
    }));
    const browseItem: FolderPickItem = {
      label: '$(folder-opened) Browse for a folder…',
      description: 'e.g. one assignment inside a bigger course folder'
    };
    items.push(browseItem);

    // With no folder open there is nothing to list: go straight to the dialog.
    const picked =
      items.length === 1
        ? browseItem
        : await vscode.window.showQuickPick(items, {
            title: 'CodeLapse: Which folder are you working in?',
            placeHolder: this.folder
              ? `Currently recording "${this.getFolderName()}". Only files inside the chosen folder are recorded.`
              : 'Only files inside the chosen folder are recorded.'
          });

    if (!picked) {
      return undefined;
    }
    if (picked.uri) {
      return picked.uri;
    }

    const result = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Record This Folder',
      title: 'CodeLapse: Choose the folder to record',
      defaultUri: this.folder ?? vscode.workspace.workspaceFolders?.[0]?.uri
    });
    return result?.[0];
  }

  public dispose(): void {
    this._onDidChange.dispose();
  }
}
