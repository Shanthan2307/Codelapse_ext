import * as vscode from 'vscode';
import * as fs from 'fs';
import { LogRecord, Session, parseSessionLog } from '@codelapse/core';
export { LogRecord };

export class LogStreamer {
  private writeStream: fs.WriteStream | null = null;
  private filePath: string | null = null;

  /**
   * Initializes the append-only write stream for a given session JSONL file path.
   */
  public async open(fileUri: vscode.Uri): Promise<void> {
    // Await the previous stream's flush: close() resolves asynchronously, so
    // firing it without awaiting could null out writeStream after the new one
    // has already been assigned, silently dropping every subsequent record.
    await this.close();
    this.filePath = fileUri.fsPath;

    // Ensure parent directory exists
    const parentDir = vscode.Uri.joinPath(fileUri, '..');
    await vscode.workspace.fs.createDirectory(parentDir);

    this.writeStream = fs.createWriteStream(this.filePath, {
      flags: 'a', // Append mode
      encoding: 'utf-8'
    });
  }

  /**
   * Appends an event or snapshot record to disk in O(1) non-blocking time.
   */
  public append(record: LogRecord): void {
    if (!this.writeStream) {
      return;
    }
    const line = JSON.stringify(record) + '\n';
    this.writeStream.write(line);
  }

  /**
   * Closes and flushes the underlying file stream.
   */
  public close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.writeStream) {
        this.writeStream.end(() => {
          this.writeStream = null;
          this.filePath = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /** Reads a session back from its .jsonl log file. */
  public static async readSessionFromLog(fileUri: vscode.Uri): Promise<Session | null> {
    try {
      return parseSessionLog(await fs.promises.readFile(fileUri.fsPath, 'utf-8'));
    } catch {
      return null;
    }
  }
}
