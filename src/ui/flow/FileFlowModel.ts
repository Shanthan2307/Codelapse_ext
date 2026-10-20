import { Snapshot, SessionEvent } from '../../models';
import { computeEdits } from '../playback/PlaybackModel';

/**
 * File navigation model: turns a recorded session into the sequence of files
 * the student worked in (visits) and the moves between them, for the
 * file navigation graph. Pure (no React, no DOM), so it is unit tested directly.
 */

/** A continuous stretch of time spent in one file. */
export interface FileVisit {
  index: number;
  filePath: string;
  /** Session time (ms) the visit began and ended (the next visit's start, or session end). */
  start: number;
  end: number;
  /** True if the file's text changed during the visit; false for read-only visits. */
  edited: boolean;
  /** Characters inserted during the visit. */
  charsTyped: number;
  /** 1-based line numbers, in the file as it was when the visit ended, typed or changed during it. */
  changedLines: number[];
  /** Session time of the visit's last recorded change, where all its typing is visible. */
  resultTime: number;
}

/** One move from a file to another; `visitIndex` is the visit it moved into. */
export interface FileMove {
  from: string;
  to: string;
  time: number;
  visitIndex: number;
}

/** All moves between the same two files in the same direction. */
export interface FlowEdge {
  key: string;
  from: string;
  to: string;
  moves: FileMove[];
}

export interface FlowNode {
  filePath: string;
  /** Top-level folder ("server", "client"), or "" for files at the project root. */
  group: string;
  /** Path inside the group, e.g. "src/App.jsx". */
  label: string;
  visits: number;
  timeMs: number;
  charsTyped: number;
  firstSeen: number;
}

export interface FileFlow {
  visits: FileVisit[];
  moves: FileMove[];
  edges: FlowEdge[];
  nodes: FlowNode[];
  /** Groups in order of first appearance. */
  groups: string[];
}

export interface FileFlowOptions {
  /** Keep short read-only visits (e.g. flicking through tabs). Default false. */
  includeBriefViews?: boolean;
}

/** Read-only visits shorter than this are treated as flicking through tabs. */
export const MIN_VIEW_MS = 3000;

interface Signal {
  time: number;
  filePath: string;
  snapshot?: Snapshot;
}

interface RawVisit {
  filePath: string;
  start: number;
  end: number;
  /** Text before the visit (undefined: not known yet) and after it. */
  before: string;
  after: string;
  resultTime: number;
}

export function buildFileFlow(
  snapshots: Snapshot[],
  events: SessionEvent[],
  durationMs: number,
  options: FileFlowOptions = {}
): FileFlow {
  // 1. Every recorded sign of where the student was, in time order.
  //    Focus events sort before a snapshot at the same instant (the arrival snapshot).
  const signals: Signal[] = [
    ...events
      .filter((e) => e.type === 'focus' && e.filePath)
      .map((e) => ({ time: e.timestamp, filePath: e.filePath! })),
    ...snapshots.map((s) => ({ time: s.timestamp, filePath: s.filePath, snapshot: s }))
  ];
  signals.sort((a, b) => a.time - b.time || Number(!!a.snapshot) - Number(!!b.snapshot));

  // 2. Consecutive signals in the same file form one visit.
  const latest = new Map<string, string>();
  const raw: RawVisit[] = [];
  for (const signal of signals) {
    let visit = raw[raw.length - 1];
    if (!visit || visit.filePath !== signal.filePath) {
      const known = latest.get(signal.filePath);
      visit = {
        filePath: signal.filePath,
        start: signal.time,
        end: signal.time,
        before: known ?? '',
        after: known ?? '',
        resultTime: signal.time
      };
      raw.push(visit);
    }
    const snap = signal.snapshot;
    if (snap) {
      // A file's first-ever snapshot taken on arrival is its existing content, not typing.
      if (!latest.has(snap.filePath) && snap.trigger === 'focus') {
        visit.before = snap.content;
      }
      if (snap.content !== visit.after) {
        visit.resultTime = snap.timestamp;
      }
      visit.after = snap.content;
      latest.set(snap.filePath, snap.content);
    }
  }
  const sessionEnd = Math.max(durationMs, signals.length ? signals[signals.length - 1].time : 0);
  raw.forEach((v, i) => (v.end = i + 1 < raw.length ? raw[i + 1].start : sessionEnd));

  // 3. Drop flicking-through-tabs visits, then merge neighbours left in the same file.
  const kept = options.includeBriefViews
    ? raw
    : raw.filter((v) => v.before !== v.after || v.end - v.start >= MIN_VIEW_MS);
  const merged: RawVisit[] = [];
  for (const v of kept) {
    const prev = merged[merged.length - 1];
    if (prev && prev.filePath === v.filePath) {
      prev.end = v.end;
      prev.after = v.after;
      if (v.before !== v.after) {
        prev.resultTime = v.resultTime;
      }
    } else {
      merged.push({ ...v });
    }
  }
  // A dropped visit's time belongs to the visit before it.
  merged.forEach((v, i) => (v.end = i + 1 < merged.length ? merged[i + 1].start : sessionEnd));

  const visits: FileVisit[] = merged.map((v, index) => {
    const { charsTyped, changedLines } = describeChange(v.before, v.after);
    return {
      index,
      filePath: v.filePath,
      start: v.start,
      end: v.end,
      edited: v.before !== v.after,
      charsTyped,
      changedLines,
      resultTime: v.before !== v.after ? v.resultTime : v.start
    };
  });

  // 4. Moves between consecutive visits, grouped into edges.
  const moves: FileMove[] = [];
  for (let i = 1; i < visits.length; i++) {
    moves.push({ from: visits[i - 1].filePath, to: visits[i].filePath, time: visits[i].start, visitIndex: i });
  }
  const edgeMap = new Map<string, FlowEdge>();
  for (const move of moves) {
    const key = `${move.from}\u0000${move.to}`;
    let edge = edgeMap.get(key);
    if (!edge) {
      edge = { key, from: move.from, to: move.to, moves: [] };
      edgeMap.set(key, edge);
    }
    edge.moves.push(move);
  }

  // 5. One node per file, grouped by top-level folder.
  const nodeMap = new Map<string, FlowNode>();
  for (const v of visits) {
    let node = nodeMap.get(v.filePath);
    if (!node) {
      const slash = v.filePath.indexOf('/');
      node = {
        filePath: v.filePath,
        group: slash > 0 ? v.filePath.slice(0, slash) : '',
        label: slash > 0 ? v.filePath.slice(slash + 1) : v.filePath,
        visits: 0,
        timeMs: 0,
        charsTyped: 0,
        firstSeen: v.start
      };
      nodeMap.set(v.filePath, node);
    }
    node.visits++;
    node.timeMs += v.end - v.start;
    node.charsTyped += v.charsTyped;
  }
  const nodes = [...nodeMap.values()];
  const groups: string[] = [];
  for (const n of nodes) {
    if (!groups.includes(n.group)) {
      groups.push(n.group);
    }
  }

  return { visits, moves, edges: [...edgeMap.values()], nodes, groups };
}

/**
 * Shifts visit start times to when their first change starts appearing in the
 * replay (see PlaybackModel.windowStart), so the graph's current file always
 * matches the file on screen. Typing windows never reach back past the previous
 * snapshot, so visit order is preserved.
 */
export function alignToPlayback(flow: FileFlow, windowStart: (ms: number) => number): FileFlow {
  const visits = flow.visits.map((v) => ({ ...v, start: Math.min(v.start, windowStart(v.start)) }));
  visits.forEach((v, i) => {
    if (i + 1 < visits.length) {
      v.end = visits[i + 1].start;
    }
  });
  const moves = flow.moves.map((m) => ({ ...m, time: visits[m.visitIndex].start }));
  const edges = flow.edges.map((e) => ({ ...e, moves: e.moves.map((m) => moves.find((x) => x.visitIndex === m.visitIndex)!) }));
  const nodes = flow.nodes.map((n) => {
    const own = visits.filter((v) => v.filePath === n.filePath);
    return { ...n, firstSeen: own[0].start, timeMs: own.reduce((t, v) => t + v.end - v.start, 0) };
  });
  return { ...flow, visits, moves, edges, nodes };
}

/** Characters inserted, and which lines of the new text hold inserted characters. */
function describeChange(before: string, after: string): { charsTyped: number; changedLines: number[] } {
  if (before === after) {
    return { charsTyped: 0, changedLines: [] };
  }
  const lineStarts = [0];
  for (let i = 0; i < after.length; i++) {
    if (after.charCodeAt(i) === 10) {
      lineStarts.push(i + 1);
    }
  }
  const lineOf = (offset: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const lines = new Set<number>();
  let charsTyped = 0;
  let shift = 0; // edits are positioned in `before`; shift maps them into `after`
  for (const edit of computeEdits(before, after)) {
    const start = edit.offset + shift;
    if (edit.inserted.length > 0) {
      charsTyped += edit.inserted.length;
      // A leading newline (Enter at the end of a line) doesn't change that line,
      // and a trailing one belongs to the line it ends, not the next.
      let first = start;
      const last = start + edit.inserted.length - 1;
      while (first <= last && after.charCodeAt(first) === 10) {
        first++;
      }
      if (first <= last) {
        for (let line = lineOf(first); line <= lineOf(last); line++) {
          lines.add(line);
        }
      }
    }
    shift += edit.inserted.length - edit.removed.length;
  }
  return { charsTyped, changedLines: [...lines].sort((a, b) => a - b) };
}
