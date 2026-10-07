'use client';

import { useEffect, useId, useRef } from 'react';

// Fixed geometry: every example drawn with this component shares it, so the
// edge paths (computed from it) can be passed in as-is.
const LANE_W = 118;
const NODE_W = 110;
const NODE_H = 48;
const FIRST_ROW_TOP = 44;
const ROW_STEP = 62;
const BOTTOM_PAD = 14;

export type SwimLane = { label: string; color: string };
export type SwimNode = { lane: number; row: number; label: string; variant?: 'fail' | 'dim' };
export type SwimEdge = { d: string; variant?: 'fail' | 'dashed' };
export type SwimNote = { left: number; top: number; lines: string[] };

type Props = {
  lanes: SwimLane[];
  nodes: SwimNode[];
  edges: SwimEdge[];
  notes?: SwimNote[];
  label: string;
};

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
            <div className="lline" style={{ left: i * LANE_W + LANE_W / 2 }}></div>
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
              key={e.d}
              d={e.d}
              fill="none"
              stroke={e.variant === 'fail' ? '#c5221f' : '#80868b'}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeDasharray={e.variant === 'dashed' ? '6 6' : undefined}
              markerEnd={`url(#${e.variant === 'fail' ? arrowFail : arrow})`}
            />
          ))}
        </svg>
        {nodes.map((n, i) => (
          <div
            key={n.label}
            className={n.variant ? `snode ${n.variant}` : 'snode'}
            style={{ left: n.lane * LANE_W + (LANE_W - NODE_W) / 2, top: FIRST_ROW_TOP + n.row * ROW_STEP, width: NODE_W }}
          >
            <span className="k">{i + 1}</span>
            {n.label}
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
