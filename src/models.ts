/**
 * Represents a single file snapshot captured during a recording session.
 * Supports multi-file tracking across the entire workspace.
 */
export interface Snapshot {
  /** Milliseconds elapsed since the session start */
  timestamp: number;
  /** Relative workspace file path (e.g., "src/index.ts") */
  filePath: string;
  /** Full content of the file at this snapshot moment */
  content: string;
  /** Start offset of the user's cursor / selection in the file */
  cursorStart: number;
  /** End offset of the user's cursor / selection in the file */
  cursorEnd: number;
}

/**
 * Represents an execution / run event in the terminal or debugger.
 */
export interface RunEvent {
  /** Milliseconds elapsed since session start */
  timestamp: number;
  /** The executed command string if available */
  command?: string;
  /** Terminal or execution output */
  output: string;
  /** Whether the command or test exited successfully */
  success: boolean;
  /** Execution duration in milliseconds */
  durationMs: number;
}

/**
 * Key moments and milestones during a coding session.
 */
export interface SessionEvent {
  type: 'start' | 'end' | 'run-pass' | 'run-fail' | 'idle' | 'large-delete' | 'framework';
  /** Milliseconds elapsed since session start */
  timestamp: number;
  /** Associated file path if the event pertains to a specific file */
  filePath?: string;
  /** Human-readable explanation or contextual details */
  detail?: string;
}

/**
 * Full session representation containing all multi-file snapshots,
 * execution events, and lifecycle milestones.
 */
export interface Session {
  /** Unique session ID (UUID or timestamp-based) */
  id: string;
  /** Name of the active workspace folder */
  workspaceName: string;
  /** Epoch timestamp (ms) when recording began */
  startTime: number;
  /** Epoch timestamp (ms) when recording concluded */
  endTime?: number;
  /** Ordered collection of all file snapshots recorded during the session */
  snapshots: Snapshot[];
  /** Execution / test / debug runs logged during the session */
  runs: RunEvent[];
  /** Significant session lifecycle and milestone events */
  events: SessionEvent[];
}
