import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Converts a set of points into a smooth cubic Bezier path (Catmull-Rom to Bezier conversion).
 */
function createSmoothSplinePath(points, height) {
  if (points.length < 2) return { linePath: "", areaPath: "" };
  if (points.length === 2) {
    const linePath = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} L ${points[1].x.toFixed(1)} ${points[1].y.toFixed(1)}`;
    const areaPath = `${linePath} L ${points[1].x.toFixed(1)} ${height} L ${points[0].x.toFixed(1)} ${height} Z`;
    return { linePath, areaPath };
  }

  let linePath = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];

    // Catmull-Rom tension = 0.5
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;

    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    linePath += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }

  const lastPt = points[points.length - 1];
  const firstPt = points[0];
  const areaPath = `${linePath} L ${lastPt.x.toFixed(1)} ${height} L ${firstPt.x.toFixed(1)} ${height} Z`;

  return { linePath, areaPath };
}

export default function HoverSmoothGraph({ values = [], cfg, isVisible = true }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  const { points, stats, linePath, areaPath, width, height, padX, padY } = useMemo(() => {
    const W = 320;
    const H = 130;
    const px = 12;
    const py = 16;

    const clean = (values || []).filter((v) => typeof v === "number" && Number.isFinite(v));
    if (clean.length < 2) {
      return { points: [], stats: null, linePath: "", areaPath: "", width: W, height: H, padX: px, padY: py };
    }

    const minVal = Math.min(...clean);
    const maxVal = Math.max(...clean);
    const avgVal = clean.reduce((a, b) => a + b, 0) / clean.length;
    const delta = clean[clean.length - 1] - clean[0];

    const span = maxVal - minVal || 1;
    const effectiveMin = Math.max(0, minVal - span * 0.1);
    const effectiveMax = maxVal + span * 0.1;
    const vSpan = effectiveMax - effectiveMin || 1;

    const pts = clean.map((val, idx) => {
      const x = px + (idx / (clean.length - 1)) * (W - px * 2);
      const y = H - py - ((val - effectiveMin) / vSpan) * (H - py * 2);
      return { x, y, val };
    });

    const { linePath, areaPath } = createSmoothSplinePath(pts, H);

    return {
      points: pts,
      stats: {
        min: minVal,
        max: maxVal,
        avg: avgVal,
        current: clean[clean.length - 1],
        delta,
        count: clean.length,
      },
      linePath,
      areaPath,
      width: W,
      height: H,
      padX: px,
      padY: py,
    };
  }, [values]);

  if (!isVisible || points.length < 2) return null;

  const handlePointerMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, (clientX - padX) / (width - padX * 2)));
    const idx = Math.round(ratio * (points.length - 1));
    setHoverIndex(idx);
  };

  const activePoint = hoverIndex !== null ? points[hoverIndex] : points[points.length - 1];
  const gradId = `hover-grad-${cfg.key}`;

  return (
    <motion.div
      className="hover-smooth-graph-container"
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
    >
      <div className="hsg-header">
        <div className="hsg-stat-chips">
          <span className="hsg-chip current">
            <span className="dot" style={{ background: cfg.color }} />
            {activePoint.val.toFixed(cfg.dec)} {cfg.unit}
          </span>
          <span className="hsg-chip">Peak: {stats.max.toFixed(cfg.dec)}</span>
          <span className="hsg-chip">Low: {stats.min.toFixed(cfg.dec)}</span>
          <span className={`hsg-chip ${stats.delta >= 0 ? "up" : "down"}`}>
            {stats.delta >= 0 ? "↗ +" : "↘ "}
            {stats.delta.toFixed(cfg.dec)}
          </span>
        </div>
      </div>

      <div
        className="hsg-svg-wrap"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="hsg-svg"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={cfg.color} stopOpacity="0.45" />
              <stop offset="60%" stopColor={cfg.color} stopOpacity="0.12" />
              <stop offset="100%" stopColor={cfg.color} stopOpacity="0" />
            </linearGradient>
            <filter id={`glow-${cfg.key}`} x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor={cfg.color} floodOpacity="0.6" />
            </filter>
          </defs>

          {/* Background gridlines */}
          <line x1={padX} y1={padY} x2={width - padX} y2={padY} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
          <line x1={padX} y1={height / 2} x2={width - padX} y2={height / 2} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
          <line x1={padX} y1={height - padY} x2={width - padX} y2={height - padY} stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />

          {/* Smooth Area Gradient */}
          <path d={areaPath} fill={`url(#${gradId})`} />

          {/* Smooth Spline Stroke with Glow */}
          <path
            d={linePath}
            fill="none"
            stroke={cfg.color}
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#glow-${cfg.key})`}
          />

          {/* Active Hover Point & Crosshair */}
          {activePoint && (
            <g>
              <line
                x1={activePoint.x}
                y1={padY}
                x2={activePoint.x}
                y2={height - padY}
                stroke="rgba(255, 255, 255, 0.4)"
                strokeDasharray="2 2"
                strokeWidth="1.2"
              />
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r="6"
                fill={cfg.color}
                stroke="#ffffff"
                strokeWidth="2"
              />
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r="10"
                fill="none"
                stroke={cfg.color}
                strokeWidth="1"
                opacity="0.6"
              />
            </g>
          )}
        </svg>

        <div className="hsg-footer-hint">
          <span>Live 60s stream</span>
          <span>Click card for deep analytics ↗</span>
        </div>
      </div>
    </motion.div>
  );
}
