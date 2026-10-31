import { useState, useMemo } from "react";

// A gap longer than this between samples (ms) breaks the line instead of drawing a false slope
const GAP_MS = 7000;

export default function InteractiveChart({ data, cfg, mode }) {
  const [hover, setHover] = useState(null);

  const pts = useMemo(
    () =>
      data
        .filter(
          (d) =>
            typeof d[cfg.key] === "number" && typeof d.timestamp === "number",
        )
        .map((d) => ({ ts: d.timestamp, t: d.timeLabel, v: d[cfg.key] })),
    [data, cfg.key],
  );

  if (pts.length < 2) {
    return (
      <div
        style={{
          height: 260,
          display: "grid",
          placeItems: "center",
          color: "var(--text-muted)",
          fontSize: 14,
        }}
      >
        Collecting data (need at least 2 readings)...
      </div>
    );
  }

  const W = 800;
  const H = 240;
  const pl = 48;
  const pr = 20;
  const pt = 20;
  const pb = 28;
  const cw = W - pl - pr;
  const ch = H - pt - pb;

  const vals = pts.map((p) => p.v);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals, cfg.threshold);
  const pad = (hi - lo) * 0.1 || 1;
  lo = Math.max(0, lo - pad);
  hi += pad;
  const dp = hi - lo < 5 ? 2 : 1;

  // X position comes from the real timestamp, so offline gaps are visible
  const t0 = pts[0].ts;
  const span = pts[pts.length - 1].ts - t0 || 1;
  const xs = pts.map((p) => pl + ((p.ts - t0) / span) * cw);
  const X = (i) => xs[i];
  const Y = (v) => pt + ch - ((v - lo) / (hi - lo)) * ch;

  const seg = (p, i, breakOnGap) =>
    `${i === 0 || (breakOnGap && p.ts - pts[i - 1].ts > GAP_MS) ? "M" : "L"}${X(i).toFixed(1)} ${Y(p.v).toFixed(1)}`;
  const line = pts.map((p, i) => seg(p, i, true)).join(" ");
  const areaLine = pts.map((p, i) => seg(p, i, false)).join(" ");
  const area = `${areaLine} L${X(pts.length - 1)} ${pt + ch} L${X(0)} ${pt + ch} Z`;
  const gid = `g-${cfg.key}`;

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < xs.length; i++) {
      if (Math.abs(xs[i] - x) < Math.abs(xs[best] - x)) best = i;
    }
    setHover(best);
  };

  const hp = hover !== null ? pts[hover] : null;
  const showLimit = cfg.threshold >= lo && cfg.threshold <= hi;

  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="svg-chart"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={cfg.color} stopOpacity=".35" />
            <stop offset="100%" stopColor={cfg.color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 0.33, 0.66, 1].map((s) => {
          const y = pt + ch * (1 - s);
          return (
            <g key={s}>
              <line
                x1={pl}
                y1={y}
                x2={W - pr}
                y2={y}
                stroke="var(--grid-line)"
                strokeDasharray="3 3"
              />
              <text
                x={pl - 8}
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

        <text
          x={pl}
          y={H - 8}
          fill="var(--text-muted)"
          fontSize="10.5"
          textAnchor="start"
          fontFamily="JetBrains Mono"
        >
          {pts[0].t}
        </text>
        <text
          x={W - pr}
          y={H - 8}
          fill="var(--text-muted)"
          fontSize="10.5"
          textAnchor="end"
          fontFamily="JetBrains Mono"
        >
          {pts[pts.length - 1].t}
        </text>

        {showLimit && (
          <g>
            <line
              x1={pl}
              y1={Y(cfg.threshold)}
              x2={W - pr}
              y2={Y(cfg.threshold)}
              stroke="var(--accent-red)"
              strokeDasharray="6 4"
              strokeWidth="1.5"
            />
            <text
              x={W - pr - 4}
              y={Y(cfg.threshold) - 5}
              fill="var(--accent-red)"
              fontSize="10.5"
              fontWeight="700"
              textAnchor="end"
            >
              Limit {cfg.threshold} {cfg.unit}
            </text>
          </g>
        )}

        {mode === "bar" ? (
          pts.map((p, i) => {
            const bw = Math.max(3, Math.min(20, (cw / pts.length) * 0.7));
            return (
              <rect
                key={p.ts}
                x={X(i) - bw / 2}
                y={Y(p.v)}
                width={bw}
                height={Math.max(2, pt + ch - Y(p.v))}
                rx="3"
                fill={p.v >= cfg.threshold ? "var(--accent-red)" : cfg.color}
                opacity={hover === i ? 1 : 0.85}
              />
            );
          })
        ) : (
          <>
            {mode === "area" && <path d={area} fill={`url(#${gid})`} />}
            <path
              d={line}
              fill="none"
              stroke={cfg.color}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </>
        )}

        {hp && (
          <g>
            <line
              x1={X(hover)}
              y1={pt}
              x2={X(hover)}
              y2={pt + ch}
              stroke="var(--accent-cyan)"
              strokeDasharray="2 2"
            />
            <circle
              cx={X(hover)}
              cy={Y(hp.v)}
              r="5"
              fill={cfg.color}
              stroke="#fff"
              strokeWidth="2"
            />
          </g>
        )}
      </svg>

      {hp && (
        <div
          style={{
            position: "absolute",
            top: 6,
            right: 12,
            background: "var(--bg-tertiary)",
            border: "1px solid var(--border-color)",
            padding: "6px 12px",
            borderRadius: 8,
            fontSize: 12,
            display: "flex",
            gap: 10,
          }}
        >
          <span style={{ color: "var(--text-muted)" }}>{hp.t}</span>
          <strong style={{ color: cfg.color, fontFamily: "JetBrains Mono" }}>
            {hp.v.toFixed(cfg.dec)} {cfg.unit}
          </strong>
        </div>
      )}
    </div>
  );
}
