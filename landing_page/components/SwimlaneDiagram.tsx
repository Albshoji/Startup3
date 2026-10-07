'use client';

import { useEffect, useId, useRef } from 'react';

// Fixed geometry: every example drawn with this component shares it. Arrows are
// routed from it, so the data only says which step connects to which.
const LANE_W = 122;
const NODE_W = 114;
const NODE_H = 50;
const FIRST_ROW_TOP = 44;
const ROW_STEP = 62;
const BOTTOM_PAD = 14;
const CORNER = 8;
const HEAD_GAP = 7;

export type SwimLane = { label: string; color: string };
export type SwimNode = { lane: number; row: number; title: string; code: string; variant?: 'fail' | 'dim' };
// 'hv': leaves from the side and goes down into the top of the next step (a call).
// 'vh': leaves from the bottom and comes in from the side (a return).
export type SwimEdge = { from: number; to: number; route?: 'hv' | 'vh'; fail?: boolean; dashed?: boolean };
export type SwimNote = { left: number; top: number; lines: string[] };

type Props = {
  lanes: SwimLane[];
  nodes: SwimNode[];
  edges: SwimEdge[];
  notes?: SwimNote[];
  label: string;
};

const nodeLeft = (n: SwimNode) => n.lane * LANE_W + (LANE_W - NODE_W) / 2;
const nodeTop = (n: SwimNode) => FIRST_ROW_TOP + n.row * ROW_STEP;
const laneCenter = (lane: number) => lane * LANE_W + LANE_W / 2;

function edgePath(a: SwimNode, b: SwimNode, route: 'hv' | 'vh'): string {
  const dir = b.lane > a.lane ? 1 : -1;
  if (a.lane === b.lane) {
    return `M${laneCenter(a.lane)} ${nodeTop(a) + NODE_H} V${nodeTop(b) - HEAD_GAP}`;
  }
  if (route === 'hv') {
    const y = nodeTop(a) + NODE_H / 2;
    const x0 = dir > 0 ? nodeLeft(a) + NODE_W : nodeLeft(a);
    const x1 = laneCenter(b.lane);
    return `M${x0} ${y} H${x1 - dir * CORNER} Q${x1} ${y} ${x1} ${y + CORNER} V${nodeTop(b) - HEAD_GAP}`;
  }
  const x = laneCenter(a.lane);
  const y = nodeTop(b) + NODE_H / 2;
  const x1 = dir > 0 ? nodeLeft(b) - HEAD_GAP : nodeLeft(b) + NODE_W + HEAD_GAP;
  return `M${x} ${nodeTop(a) + NODE_H} V${y - CORNER} Q${x} ${y} ${x + dir * CORNER} ${y} H${x1}`;
}

export default function SwimlaneDiagram({ lanes, nodes, edges, notes = [], label }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const swimRef = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const arrow = `sw-ah-${uid}`;
  const arrowFail = `sw-ahr-${uid}`;

  const width = lanes.length * LANE_W;
  const lastRow = Math.max(...nodes.map((n) => n.row));
  const height = FIRST_ROW_TOP + lastRow * ROW_STEP + NODE_H + BOTTOM_PAD;

  // Scale the whole diagram down to fit narrow windows; it never scrolls sideways.
  useEffect(() => {
    const wrap = wrapRef.current, swim = swimRef.current;
    if (!wrap || !swim) return;
    const fit = () => {
      const k = Math.min(1, wrap.clientWidth / width);
      swim.style.transform = k < 1 ? `scale(${k})` : 'none';
      swim.style.margin = k < 1 ? '0' : '0 auto';
      wrap.style.height = height * k + 'px';
    };
    const ro = new ResizeObserver(fit);
    ro.observe(wrap);
    fit();
    return () => ro.disconnect();
  }, [width, height]);

  return (
    <div className="swim-scroll" ref={wrapRef}>
      <div className="swim" ref={swimRef} style={{ width, height }} role="img" aria-label={label}>
        {lanes.map((l, i) => (
          <div key={l.label} style={{ display: 'contents' }}>
            <div className="lhd" style={{ left: i * LANE_W, width: LANE_W }}>
              <span style={{ background: l.color }}>{l.label}</span>
            </div>
            <div className="lline" style={{ left: laneCenter(i) }}></div>
          </div>
        ))}
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ position: 'absolute', left: 0, top: 0 }} aria-hidden="true">
          <defs>
            <marker id={arrow} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill="#80868b" />
            </marker>
            <marker id={arrowFail} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" fill="#c5221f" />
            </marker>
          </defs>
          {edges.map((e) => (
            <path
              key={`${e.from}-${e.to}`}
              d={edgePath(nodes[e.from], nodes[e.to], e.route ?? 'hv')}
              fill="none"
              stroke={e.fail ? '#c5221f' : '#80868b'}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeDasharray={e.dashed ? '6 6' : undefined}
              markerEnd={`url(#${e.fail ? arrowFail : arrow})`}
            />
          ))}
        </svg>
        {nodes.map((n, i) => (
          <div
            key={`${n.title}-${i}`}
            className={n.variant ? `snode ${n.variant}` : 'snode'}
            style={{ left: nodeLeft(n), top: nodeTop(n), width: NODE_W, height: NODE_H }}
          >
            <span className="k">{i + 1}</span>
            <span className="t">{n.title}</span>
            <span className="c">{n.code}</span>
          </div>
        ))}
        {notes.map((note) => (
          <div key={note.lines.join(' ')} className="sanno" style={{ left: note.left, top: note.top }}>
            {note.lines.map((line, i) => (
              <span key={line}>
                {i > 0 && <br />}
                {line}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
