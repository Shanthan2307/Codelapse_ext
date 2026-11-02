import { RunEvent, Session, SessionEvent } from './models';
import { DeltaEngine, DeltaSnapshot } from './deltaEngine';

/** One line of a session's append-only .jsonl log. */
export type LogRecord = { timestamp: number } & (
  | { type: 'session_start'; data: Pick<Session, 'id' | 'workspaceName' | 'startTime' | 'folderKey'> }
  | { type: 'keyframe' | 'delta'; data: DeltaSnapshot }
  | { type: 'run'; data: RunEvent }
  | { type: 'event'; data: SessionEvent }
  | { type: 'session_end'; data: { endTime: number } }
);

/**
 * Rebuilds a session from the text of its .jsonl log. Unreadable lines are
 * skipped, so a log cut short by a crash still yields everything before it.
 */
export function parseSessionLog(text: string): Session {
  const session: Session = { id: '', workspaceName: '', startTime: 0, snapshots: [], runs: [], events: [] };
  const deltaSnapshots: DeltaSnapshot[] = [];

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    let record: LogRecord;
    try {
      record = JSON.parse(line) as LogRecord;
    } catch {
      continue;
    }
    switch (record.type) {
      case 'session_start':
        session.id = record.data.id;
        session.workspaceName = record.data.workspaceName;
        session.startTime = record.data.startTime;
        if (record.data.folderKey) {
          session.folderKey = record.data.folderKey;
        }
        break;
      case 'keyframe':
      case 'delta':
        deltaSnapshots.push(record.data);
        break;
      case 'run':
        session.runs.push(record.data);
        break;
      case 'event':
        session.events.push(record.data);
        break;
      case 'session_end':
        session.endTime = record.data.endTime;
        break;
    }
  }

  session.snapshots = DeltaEngine.materializeSnapshots(deltaSnapshots);
  return session;
}
