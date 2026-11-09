import { FileFlow, FileVisit } from './FileFlowModel';

/** One row of the file journey: a file and the time spent in it. */
export interface JourneyLane {
  filePath: string;
  /** File name, plus enough of the path to tell same-named files apart. */
  label: string;
  /** Folder shown under the name, or "" for files at the project root. */
  folder: string;
  timeMs: number;
  share: number;
  charsTyped: number;
  visits: FileVisit[];
}

export interface JourneySummary {
  lanes: JourneyLane[];
  durationMs: number;
  switches: number;
  /** The pair of files switched between most often, if any pair was switched between twice or more. */
  backAndForth: { a: string; b: string; times: number } | null;
  /** File with the most time, if there is more than one file. */
  mostTime: JourneyLane | null;
}

/**
 * Summarises the file navigation model for the journey view: one lane per
 * file in order of first visit, how often the student switched files, and
 * which pair of files they went back and forth between most.
 */
export function summarizeJourney(flow: FileFlow): JourneySummary {
  const durationMs = Math.max(1, ...flow.visits.map((v) => v.end));
  const order: string[] = [];
  for (const v of flow.visits) {
    if (!order.includes(v.filePath)) order.push(v.filePath);
  }
  const total = flow.visits.reduce((t, v) => t + (v.end - v.start), 0) || 1;
  const lanes = order.map((filePath): JourneyLane => {
    const visits = flow.visits.filter((v) => v.filePath === filePath);
    const timeMs = visits.reduce((t, v) => t + (v.end - v.start), 0);
    const parts = filePath.split('/');
    const name = parts[parts.length - 1];
    const sameName = order.filter((p) => p.split('/').pop() === name).length > 1;
    return {
      filePath,
      label: sameName && parts.length > 1 ? parts.slice(-2).join('/') : name,
      folder: parts.slice(0, -1).join('/'),
      timeMs,
      share: timeMs / total,
      charsTyped: visits.reduce((t, v) => t + v.charsTyped, 0),
      visits
    };
  });

  const pairCounts = new Map<string, { a: string; b: string; times: number }>();
  for (const move of flow.moves) {
    const [a, b] = [move.from, move.to].sort();
    const key = `${a}\u0000${b}`;
    const entry = pairCounts.get(key) ?? { a, b, times: 0 };
    entry.times++;
    pairCounts.set(key, entry);
  }
  const top = [...pairCounts.values()].sort((x, y) => y.times - x.times)[0];

  return {
    lanes,
    durationMs,
    switches: flow.moves.length,
    backAndForth: top && top.times >= 2 ? top : null,
    mostTime: lanes.length > 1 ? [...lanes].sort((x, y) => y.timeMs - x.timeMs)[0] : null
  };
}

/** "line 4", "lines 3–8", "lines 3–8 and 12". */
export function describeLines(lines: number[]): string {
  if (lines.length === 0) return '';
  const ranges: string[] = [];
  let start = lines[0];
  let prev = lines[0];
  for (const line of [...lines.slice(1), Infinity]) {
    if (line !== prev + 1) {
      ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
      start = line;
    }
    prev = line;
  }
  const label = lines.length === 1 ? 'line' : 'lines';
  return ranges.length <= 1 ? `${label} ${ranges[0]}` : `${label} ${ranges.slice(0, -1).join(', ')} and ${ranges[ranges.length - 1]}`;
}
