import React, { useMemo, useRef, useState } from 'react';
import { FileFlow, FileVisit, FlowEdge } from '../flow/FileFlowModel';

interface FileFlowGraphProps {
  flow: FileFlow;
  playheadMs: number;
  /** Jump to the end of a visit and highlight what was typed during it. */
  onShowVisit: (visit: FileVisit) => void;
  /** Play a visit from start to end. */
  onReplayVisit: (visit: FileVisit) => void;
}

type Selection = { kind: 'edge'; key: string; move: number } | { kind: 'node'; filePath: string } | null;

const NODE_W = 190;
const NODE_H = 32;
const ROW_GAP = 14;
const GROUP_PAD = 16;
const GROUP_LABEL_H = 22;
const COL_GAP = 120;
const SIDE = 70; // room for arcs between files in the same folder
const TOP = 10;
/** Session time an arrow's moving dot takes to travel from one file to the next. */
const MOVE_ANIM_MS = 1500;

interface NodeBox {
  x: number;
  y: number;
  column: number;
}

/**
 * File navigation graph: files grouped by top-level folder, arrows for every
 * move between files. It replays in sync with the timelapse: the current file
 * is outlined, arrows appear once taken, and a dot travels along each move.
 */
export const FileFlowGraph: React.FC<FileFlowGraphProps> = ({ flow, playheadMs, onShowVisit, onReplayVisit }) => {
  const [selection, setSelection] = useState<Selection>(null);
  const pathRefs = useRef<Record<string, SVGPathElement | null>>({});

  const layout = useMemo(() => {
    const boxes = new Map<string, NodeBox>();
    const columns = flow.groups.map((group, column) => {
      const files = flow.nodes.filter((n) => n.group === group).sort((a, b) => a.firstSeen - b.firstSeen);
      const x = SIDE + column * (NODE_W + 2 * GROUP_PAD + COL_GAP) + GROUP_PAD;
      files.forEach((n, row) => {
        boxes.set(n.filePath, { x, y: TOP + GROUP_LABEL_H + GROUP_PAD / 2 + row * (NODE_H + ROW_GAP), column });
      });
      return { group, x, rows: files.length };
    });
    const maxRows = Math.max(1, ...columns.map((c) => c.rows));
    const groupHeight = GROUP_LABEL_H + GROUP_PAD + maxRows * (NODE_H + ROW_GAP) - ROW_GAP;
    const width = 2 * SIDE + columns.length * (NODE_W + 2 * GROUP_PAD) + Math.max(0, columns.length - 1) * COL_GAP;
    const height = TOP + groupHeight + TOP;

    // File name only, unless two files in the same folder group share it.
    const labels = new Map<string, string>();
    for (const n of flow.nodes) {
      const twins = flow.nodes.filter((o) => o.group === n.group && baseName(o.filePath) === baseName(n.filePath));
      labels.set(n.filePath, twins.length > 1 ? n.label.split('/').slice(-2).join('/') : baseName(n.filePath));
    }

    const reverse = new Set(flow.edges.map((e) => `${e.to}\u0000${e.from}`));
    const paths = new Map<string, string>();
    for (const edge of flow.edges) {
      paths.set(edge.key, edgePath(boxes.get(edge.from)!, boxes.get(edge.to)!, reverse.has(edge.key) && edge.from > edge.to));
    }
    return { boxes, columns, width, height, groupHeight, paths, labels };
  }, [flow]);

  const current = currentVisit(flow.visits, playheadMs);

  // The move currently in flight, if any, for the travelling dot.
  let dot: { x: number; y: number } | null = null;
  const inFlight = [...flow.moves].reverse().find((m) => m.time <= playheadMs && playheadMs - m.time < MOVE_ANIM_MS);
  if (inFlight) {
    const el = pathRefs.current[`${inFlight.from}\u0000${inFlight.to}`];
    if (el) {
      const p = el.getPointAtLength(el.getTotalLength() * ((playheadMs - inFlight.time) / MOVE_ANIM_MS));
      dot = { x: p.x, y: p.y };
    }
  }

  const selectedEdge = selection?.kind === 'edge' ? flow.edges.find((e) => e.key === selection.key) : undefined;

  const showMove = (edge: FlowEdge, move: number) => {
    setSelection({ kind: 'edge', key: edge.key, move });
    onShowVisit(flow.visits[edge.moves[move].visitIndex]);
  };

  return (
    <div className="section-card flow-card">
      <div className="section-header">
        <div>
          <h2 className="section-title">
            <span>🧭</span> File Navigation Graph
          </h2>
          <span className="section-subtitle">
            How the work moved between files. Click an arrow to see what was typed after that move.
          </span>
        </div>
      </div>

      <div className="flow-canvas">
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label="File navigation graph">
          <defs>
            {(['muted', 'done', 'selected'] as const).map((tone) => (
              <marker key={tone} id={`flow-arrow-${tone}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M1 1 L9 5 L1 9 z" className={`flow-arrowhead ${tone}`} />
              </marker>
            ))}
          </defs>

          {layout.columns.map((c) => (
            <g key={c.group}>
              <rect className="flow-group-box" x={c.x - GROUP_PAD} y={TOP} width={NODE_W + 2 * GROUP_PAD} height={layout.groupHeight} rx="8" />
              <text className="flow-group-label" x={c.x - GROUP_PAD + 10} y={TOP + 15}>
                {c.group ? `${c.group}/` : './'}
              </text>
            </g>
          ))}

          {flow.edges.map((edge) => {
            const taken = edge.moves.some((m) => m.time <= playheadMs);
            const isSelected = selectedEdge?.key === edge.key;
            const tone = isSelected ? 'selected' : taken ? 'done' : 'muted';
            const d = layout.paths.get(edge.key)!;
            return (
              <g key={edge.key}>
                <path
                  ref={(el) => (pathRefs.current[edge.key] = el)}
                  d={d}
                  className={`flow-edge ${tone}`}
                  strokeWidth={1.2 + Math.min(4, edge.moves.length - 1) * 0.8}
                  markerEnd={`url(#flow-arrow-${tone})`}
                />
                <path d={d} className="flow-edge-hit" onClick={() => showMove(edge, 0)}>
                  <title>
                    {`${baseName(edge.from)} → ${baseName(edge.to)}: ${edge.moves.length} ${edge.moves.length === 1 ? 'time' : 'times'}`}
                  </title>
                </path>
              </g>
            );
          })}

          {flow.nodes.map((node) => {
            const box = layout.boxes.get(node.filePath)!;
            const seen = node.firstSeen <= playheadMs;
            const isCurrent = current?.filePath === node.filePath;
            const isSelected = selection?.kind === 'node' && selection.filePath === node.filePath;
            return (
              <g
                key={node.filePath}
                className={`flow-node g${box.column % 3} ${isCurrent ? 'current' : ''} ${seen ? '' : 'unseen'} ${isSelected ? 'selected' : ''}`}
                onClick={() => setSelection({ kind: 'node', filePath: node.filePath })}
              >
                <title>{`${node.filePath}\n${node.visits} ${node.visits === 1 ? 'visit' : 'visits'} · ${formatTime(node.timeMs)} · ${node.charsTyped} characters typed`}</title>
                <rect x={box.x} y={box.y} width={NODE_W} height={NODE_H} rx="6" />
                <text x={box.x + NODE_W / 2} y={box.y + NODE_H / 2} textAnchor="middle" dominantBaseline="central">
                  {shorten(layout.labels.get(node.filePath)!, 24)}
                </text>
              </g>
            );
          })}

          {dot && <circle className="flow-dot" cx={dot.x} cy={dot.y} r="5" />}
        </svg>
      </div>

      <div className="flow-strip" aria-label="Visits in order">
        {flow.visits.map((v) => (
          <button
            key={v.index}
            className={`flow-chip ${current?.index === v.index ? 'current' : ''} ${v.edited ? '' : 'read-only'}`}
            onClick={() => {
              setSelection(null);
              onShowVisit(v);
            }}
            title={`${v.filePath} from ${formatTime(v.start)} to ${formatTime(v.end)}${v.edited ? '' : ' (read only)'}`}
          >
            {baseName(v.filePath)} <span className="flow-chip-time">{formatTime(v.end - v.start)}</span>
          </button>
        ))}
      </div>

      <div className="flow-panel">
        {selectedEdge && selection?.kind === 'edge' ? (
          <EdgeDetail
            edge={selectedEdge}
            moveIndex={selection.move}
            visit={flow.visits[selectedEdge.moves[selection.move].visitIndex]}
            onPick={(i) => showMove(selectedEdge, i)}
            onReplay={onReplayVisit}
          />
        ) : selection?.kind === 'node' ? (
          <NodeDetail
            filePath={selection.filePath}
            visits={flow.visits.filter((v) => v.filePath === selection.filePath)}
            onShow={onShowVisit}
          />
        ) : (
          <span className="flow-hint">
            Arrows appear as the replay reaches each move; thicker arrows were taken more often. Dashed visits are
            read-only (the file was opened but not changed).
          </span>
        )}
      </div>
    </div>
  );
};

const EdgeDetail: React.FC<{
  edge: FlowEdge;
  moveIndex: number;
  visit: FileVisit;
  onPick: (i: number) => void;
  onReplay: (v: FileVisit) => void;
}> = ({ edge, moveIndex, visit, onPick, onReplay }) => (
  <>
    <div className="flow-panel-title">
      {baseName(edge.from)} → {baseName(edge.to)}
      <span className="flow-panel-meta">
        {' '}
        · {edge.moves.length} {edge.moves.length === 1 ? 'time' : 'times'}
      </span>
    </div>
    <div className="flow-occurrences">
      {edge.moves.map((m, i) => (
        <button key={i} className={`flow-chip ${i === moveIndex ? 'current' : ''}`} onClick={() => onPick(i)}>
          {formatTime(m.time)}
        </button>
      ))}
    </div>
    <div className="flow-panel-body">
      {visit.edited ? (
        <>
          Typed <b>{visit.charsTyped}</b> characters in <code>{baseName(visit.filePath)}</code>
          {visit.changedLines.length > 0 && <> on {describeLines(visit.changedLines)}</>} during this{' '}
          {formatTime(visit.end - visit.start)} visit. They're highlighted in green in the code above.
        </>
      ) : (
        <>
          Read <code>{baseName(visit.filePath)}</code> for {formatTime(visit.end - visit.start)} without changing it.
        </>
      )}
    </div>
    <button className="btn btn-secondary flow-replay" onClick={() => onReplay(visit)}>
      ▶ Replay this visit
    </button>
  </>
);

const NodeDetail: React.FC<{ filePath: string; visits: FileVisit[]; onShow: (v: FileVisit) => void }> = ({
  filePath,
  visits,
  onShow
}) => {
  const time = visits.reduce((t, v) => t + v.end - v.start, 0);
  const typed = visits.reduce((t, v) => t + v.charsTyped, 0);
  return (
    <>
      <div className="flow-panel-title">
        <code>{filePath}</code>
        <span className="flow-panel-meta">
          {' '}
          · {visits.length} {visits.length === 1 ? 'visit' : 'visits'} · {formatTime(time)} · {typed} characters typed
        </span>
      </div>
      <div className="flow-occurrences">
        {visits.map((v) => (
          <button key={v.index} className={`flow-chip ${v.edited ? '' : 'read-only'}`} onClick={() => onShow(v)}>
            {formatTime(v.start)}
          </button>
        ))}
      </div>
    </>
  );
};

/** Cubic curve between two files; same-folder moves bulge out to the side. */
function edgePath(a: NodeBox, b: NodeBox, isReverse: boolean): string {
  const offset = isReverse ? 6 : -6;
  if (a.column === b.column) {
    // The first column's arcs bulge left (into the margin), all others right.
    const left = a.column === 0;
    const x = left ? a.x : a.x + NODE_W;
    const bulge = (left ? -1 : 1) * (isReverse ? 56 : 32);
    const y1 = a.y + NODE_H / 2 + offset;
    const y2 = b.y + NODE_H / 2 + offset;
    return `M${x} ${y1} C${x + bulge} ${y1}, ${x + bulge} ${y2}, ${x} ${y2}`;
  }
  const rightward = a.column < b.column;
  const x1 = rightward ? a.x + NODE_W : a.x;
  const x2 = rightward ? b.x : b.x + NODE_W;
  const y1 = a.y + NODE_H / 2 + offset;
  const y2 = b.y + NODE_H / 2 + offset;
  const mid = (x1 + x2) / 2;
  return `M${x1} ${y1} C${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

function currentVisit(visits: FileVisit[], ms: number): FileVisit | undefined {
  if (visits.length === 0 || ms < visits[0].start) {
    return undefined;
  }
  return visits.find((v) => ms >= v.start && ms < v.end) ?? visits[visits.length - 1];
}

function baseName(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}

function shorten(text: string, max: number): string {
  return text.length <= max ? text : '…' + text.slice(text.length - max + 1);
}

/** "line 4", "lines 3–8", "lines 3–8 and 12". */
function describeLines(lines: number[]): string {
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

function formatTime(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(totalSec / 60).toString().padStart(2, '0')}:${(totalSec % 60).toString().padStart(2, '0')}`;
}
