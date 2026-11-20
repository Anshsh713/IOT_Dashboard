import { useState, useMemo, useId } from "react";

// A gap longer than this between samples (ms) breaks the curve instead of drawing a false slope.
const MIN_GAP_MS = 7000;

function fmt(ts, long) {
  const d = new Date(ts);
  return long
    ? d.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

/** Smooth Catmull-Rom spline, clamped to the chart's vertical bounds. */
function splinePath(seg, yMin, yMax) {
  if (seg.length === 1) return `M${seg[0].x.toFixed(1)} ${seg[0].y.toFixed(1)}`;
  const clamp = (v) => Math.min(yMax, Math.max(yMin, v));
  let d = `M${seg[0].x.toFixed(1)} ${seg[0].y.toFixed(1)}`;
  for (let i = 0; i < seg.length - 1; i++) {
    const p0 = seg[i === 0 ? 0 : i - 1];
    const p1 = seg[i];
    const p2 = seg[i + 1];
    const p3 = seg[i + 2 < seg.length ? i + 2 : i + 1];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = clamp(p1.y + (p2.y - p0.y) / 6);
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = clamp(p2.y - (p3.y - p1.y) / 6);
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export default function InteractiveChart({ data, cfg }) {
  const [hover, setHover] = useState(null);
  const uid = useId().replace(/:/g, "");

  const { pts, gapMs, long } = useMemo(() => {
    const rows = data
      .filter(
        (d) => typeof d[cfg.key] === "number" && typeof d.timestamp === "number",
      )
      .map((d) => ({ ts: d.timestamp, v: d[cfg.key] }));
    const isLong =
      rows.length > 1 &&
      rows[rows.length - 1].ts - rows[0].ts > 6 * 3600 * 1000;
    const gaps = rows
      .slice(1)
      .map((r, i) => r.ts - rows[i].ts)
      .sort((a, b) => a - b);
    const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    return {
      pts: rows.map((r) => ({ ...r, t: fmt(r.ts, isLong) })),
      gapMs: Math.max(MIN_GAP_MS, median * 4),
      long: isLong,
    };
  }, [data, cfg.key]);

  if (pts.length < 2) {
    return (
      <div className="chart-empty">
        <div className="chart-empty-wave" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <p>Collecting data (need at least 2 readings)...</p>
      </div>
    );
  }

  const W = 800;
  const H = 260;
  const pl = 52;
  const pr = 20;
  const pt = 24;
  const pb = 30;
  const cw = W - pl - pr;
  const ch = H - pt - pb;
  const base = pt + ch;

  const vals = pts.map((p) => p.v);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals, cfg.threshold);
  const pad = (hi - lo) * 0.12 || 1;
  lo = Math.max(0, lo - pad);
  hi += pad;
  const dp = hi - lo < 5 ? 2 : 1;

  const t0 = pts[0].ts;
  const span = pts[pts.length - 1].ts - t0 || 1;
  const X = (ts) => pl + ((ts - t0) / span) * cw;
  const Y = (v) => pt + ch - ((v - lo) / (hi - lo)) * ch;

  const xy = pts.map((p, i) => ({ x: X(p.ts), y: Y(p.v), i }));

  // Split into segments wherever data went missing.
  const segments = [];
  xy.forEach((p, i) => {
    if (i === 0 || pts[i].ts - pts[i - 1].ts > gapMs) segments.push([p]);
    else segments[segments.length - 1].push(p);
  });

  const linePath = segments.map((s) => splinePath(s, pt, base)).join(" ");
  const areaPath = segments
    .filter((s) => s.length > 1)
    .map(
      (s) =>
        `${splinePath(s, pt, base)} L${s[s.length - 1].x.toFixed(1)} ${base} L${s[0].x.toFixed(1)} ${base} Z`,
    )
    .join(" ");

  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const xTicks = [0, 0.25, 0.5, 0.75, 1];
  const showLimit = cfg.threshold >= lo && cfg.threshold <= hi;
  const last = xy[xy.length - 1];
  const lastOver = pts[pts.length - 1].v >= cfg.threshold;

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < xy.length; i++) {
      if (Math.abs(xy[i].x - x) < Math.abs(xy[best].x - x)) best = i;
    }
    setHover(best);
  };

  const hp = hover !== null ? pts[hover] : null;
  const hxy = hover !== null ? xy[hover] : null;
  const hoverOver = hp ? hp.v >= cfg.threshold : false;
  const dotColor = (over) => (over ? "var(--accent-red)" : cfg.color);
  const tipLeft = hxy ? Math.min(88, Math.max(12, (hxy.x / W) * 100)) : 0;

  return (
    <div className="chart-wrap">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="svg-chart"
        onPointerMove={onMove}
        onPointerDown={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={cfg.color} stopOpacity="0.5" />
            <stop offset="55%" stopColor={cfg.color} stopOpacity="0.14" />
            <stop offset="100%" stopColor={cfg.color} stopOpacity="0" />
          </linearGradient>
          <filter
            id={`glow-${uid}`}
            x="-10%"
            y="-30%"
            width="120%"
            height="160%"
          >
            <feDropShadow
              dx="0"
              dy="0"
              stdDeviation="3.5"
              floodColor={cfg.color}
              floodOpacity="0.75"
            />
          </filter>
        </defs>

        {/* Horizontal grid + Y labels */}
        {yTicks.map((s) => {
          const y = pt + ch * (1 - s);
          return (
            <g key={s}>
              <line
                x1={pl}
                y1={y}
                x2={W - pr}
                y2={y}
                stroke="var(--grid-line)"
                strokeDasharray="3 5"
              />
              <text
                x={pl - 10}
                y={y + 4}
                fill="var(--text-muted)"
                fontSize="10.5"
                textAnchor="end"
                fontFamily="JetBrains Mono"
              >
                {(lo + (hi - lo) * s).toFixed(dp)}
              </text>
            </g>
          );
        })}

        {/* X labels */}
        {xTicks.map((s, i) => (
          <text
            key={s}
            x={pl + cw * s}
            y={H - 8}
            fill="var(--text-muted)"
            fontSize="10.5"
            textAnchor={
              i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"
            }
            fontFamily="JetBrains Mono"
          >
            {fmt(t0 + span * s, long)}
          </text>
        ))}

        {/* Limit line */}
        {showLimit && (
          <g className="ch-limit">
            <line
              x1={pl}
              y1={Y(cfg.threshold)}
              x2={W - pr}
              y2={Y(cfg.threshold)}
              stroke="var(--accent-red)"
              strokeDasharray="6 5"
              strokeWidth="1.4"
              opacity="0.9"
            />
            <text
              x={W - pr - 4}
              y={Y(cfg.threshold) - 6}
              fill="var(--accent-red)"
              fontSize="10.5"
              fontWeight="700"
              textAnchor="end"
              fontFamily="JetBrains Mono"
            >
              LIMIT {cfg.threshold} {cfg.unit}
            </text>
          </g>
        )}

        {/* Area + glowing line */}
        {areaPath && (
          <path
            d={areaPath}
            fill={`url(#fill-${uid})`}
            className="ch-area"
          />
        )}
        <path
          d={linePath}
          pathLength="1"
          fill="none"
          stroke={cfg.color}
          strokeWidth="2.6"
          strokeLinejoin="round"
          strokeLinecap="round"
          filter={`url(#glow-${uid})`}
          className="ch-line"
        />

        {/* Live dot on the newest reading */}
        {hover === null && (
          <g className="ch-live">
            <circle
              cx={last.x}
              cy={last.y}
              r="5"
              fill={dotColor(lastOver)}
              className="ch-live-ring"
            />
            <circle
              cx={last.x}
              cy={last.y}
              r="4.5"
              fill={dotColor(lastOver)}
              stroke="#fff"
              strokeWidth="1.8"
            />
          </g>
        )}

        {/* Hover crosshair */}
        {hxy && (
          <g>
            <line
              x1={hxy.x}
              y1={pt}
              x2={hxy.x}
              y2={base}
              stroke={cfg.color}
              strokeOpacity="0.55"
              strokeDasharray="3 3"
            />
            <circle
              cx={hxy.x}
              cy={hxy.y}
              r="11"
              fill={dotColor(hoverOver)}
              opacity="0.18"
            />
            <circle
              cx={hxy.x}
              cy={hxy.y}
              r="5.5"
              fill={dotColor(hoverOver)}
              stroke="#fff"
              strokeWidth="2"
            />
          </g>
        )}
      </svg>

      {hp && (
        <div className="ch-tooltip" style={{ left: `${tipLeft}%` }}>
          <span className="ch-tip-time">{hp.t}</span>
          <strong style={{ color: dotColor(hoverOver) }}>
            {hp.v.toFixed(cfg.dec)} {cfg.unit}
          </strong>
        </div>
      )}
    </div>
  );
}
