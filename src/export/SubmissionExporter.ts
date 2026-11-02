import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { Session } from '../models';
import { SessionManager } from '../tracker/SessionManager';
import { ReportExporter } from './ReportExporter';

export interface SubmissionOptions {
  /** Parent folder to save into, skipping the folder dialog (used by tests). */
  destination?: vscode.Uri;
  /** Include every saved session, skipping the picker (used by tests). */
  includeAll?: boolean;
}

interface SavedSession {
  /** File name without extension, e.g. "codelapse-1791194426788". */
  base: string;
  session: Session;
  /** The raw .jsonl log and .json snapshot that exist for this session. */
  files: vscode.Uri[];
}

/**
 * Copies chosen sessions' raw recordings (.jsonl + .json) and a standalone
 * HTML report for each into one new folder, so they can be zipped and shared
 * without digging through VS Code's hidden storage directory.
 */
export class SubmissionExporter {
  public static async run(
    extensionUri: vscode.Uri,
    sessionManager: SessionManager,
    currentFolderName: string | null,
    options: SubmissionOptions = {}
  ): Promise<vscode.Uri | undefined> {
    const saved = await this.loadSavedSessions(sessionManager);
    if (saved.length === 0) {
      vscode.window.showWarningMessage('CodeLapse: No recorded sessions found yet.');
      return undefined;
    }

    let chosen = saved;
    if (!options.includeAll) {
      const items = saved.map((entry) => ({
        label: `$(record) ${entry.session.workspaceName}`,
        description: describeSession(entry.session),
        // Pre-select the folder being worked on; everything else is opt-in.
        picked: currentFolderName ? entry.session.workspaceName === currentFolderName : true,
        entry
      }));
      const picks = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        title: 'CodeLapse: Which sessions should be saved?',
        placeHolder: 'Sessions of your current folder are pre-selected. Leave out anything private.'
      });
      if (!picks || picks.length === 0) {
        return undefined;
      }
      chosen = picks.map((p) => p.entry);
    }

    let parent = options.destination;
    if (!parent) {
      const result = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Save Here',
        title: 'CodeLapse: Where should the session data folder be created?',
        defaultUri: vscode.Uri.file(os.homedir())
      });
      if (!result) {
        return undefined;
      }
      parent = result[0];
    }

    const label = slug(currentFolderName ?? chosen[0].session.workspaceName);
    const target = await uniqueChild(parent, `codelapse-data-${label}-${dateStamp(new Date())}`);
    await vscode.workspace.fs.createDirectory(target);

    for (const entry of chosen) {
      for (const file of entry.files) {
        await vscode.workspace.fs.copy(file, vscode.Uri.joinPath(target, path.basename(file.fsPath)), {
          overwrite: true
        });
      }
      const html = await ReportExporter.buildStandaloneHtml(extensionUri, entry.session);
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(target, `${entry.base}-report.html`),
        new TextEncoder().encode(html)
      );
    }

    return target;
  }

  private static async loadSavedSessions(sessionManager: SessionManager): Promise<SavedSession[]> {
    const result: SavedSession[] = [];
    for (const uri of await sessionManager.listSavedSessions()) {
      const base = path.basename(uri.fsPath).replace(/\.jsonl?$/, '');
      const dir = vscode.Uri.joinPath(uri, '..');
      const files: vscode.Uri[] = [];
      for (const ext of ['.jsonl', '.json']) {
        const candidate = vscode.Uri.joinPath(dir, base + ext);
        if (await exists(candidate)) {
          files.push(candidate);
        }
      }
      const session = await sessionManager.loadSession(uri);
      if (session) {
        result.push({ base, session, files });
      }
    }
    return result;
  }
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/** parent/name, or parent/name-2, -3, … if that already exists. */
async function uniqueChild(parent: vscode.Uri, name: string): Promise<vscode.Uri> {
  let candidate = vscode.Uri.joinPath(parent, name);
  for (let n = 2; await exists(candidate); n++) {
    candidate = vscode.Uri.joinPath(parent, `${name}-${n}`);
  }
  return candidate;
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'session';
}

function dateStamp(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function describeSession(session: Session): string {
  const end = session.endTime ?? session.startTime;
  const minutes = Math.max(0, Math.round((end - session.startTime) / 60000));
  return `${new Date(session.startTime).toLocaleString()} · ${minutes} min · ${session.snapshots.length} snapshots`;
}
