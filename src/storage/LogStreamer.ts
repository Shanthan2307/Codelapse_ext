import * as vscode from 'vscode';
import * as fs from 'fs';
import * as readline from 'readline';
import { Session, Snapshot, RunEvent, SessionEvent } from '../models';
import { DeltaSnapshot, DeltaEngine } from '../tracker/DeltaEngine';

export type LogRecordType = 'session_start' | 'keyframe' | 'delta' | 'run' | 'event' | 'session_end';

export interface LogRecord {
  type: LogRecordType;
  timestamp: number;
  data: any;
}

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

  /**
   * Parses an append-only .jsonl log file and reconstructs the full Session object.
   */
  public static async readSessionFromLog(fileUri: vscode.Uri): Promise<Session | null> {
    const fsPath = fileUri.fsPath;
    if (!fs.existsSync(fsPath)) {
      return null;
    }

    const fileStream = fs.createReadStream(fsPath, { encoding: 'utf-8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let session: Session = {
      id: '',
      workspaceName: '',
      startTime: 0,
      snapshots: [],
      runs: [],
      events: []
    };

    const deltaSnapshots: DeltaSnapshot[] = [];

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const record: LogRecord = JSON.parse(line);

        switch (record.type) {
          case 'session_start':
            session.id = record.data.id;
            session.workspaceName = record.data.workspaceName;
            session.startTime = record.data.startTime;
            break;

          case 'keyframe':
          case 'delta':
            deltaSnapshots.push(record.data as DeltaSnapshot);
            break;

          case 'run':
            session.runs.push(record.data as RunEvent);
            break;

          case 'event':
            session.events.push(record.data as SessionEvent);
            break;

          case 'session_end':
            session.endTime = record.data.endTime;
            break;
        }
      } catch (err) {
        console.warn('Failed to parse log line:', line, err);
      }
    }

    // Materialize delta stream into full snapshots for backward compatibility with analytics and UI
    session.snapshots = DeltaEngine.materializeSnapshots(deltaSnapshots);

    return session;
  }
}
