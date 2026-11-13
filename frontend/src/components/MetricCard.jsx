import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import HoverSmoothGraph from "./HoverSmoothGraph";

function CompactSparkline({ values, color }) {
  if (values.length < 2) return null;
  const W = 120;
  const H = 28;
  const lo = Math.min(...values);
  const range = Math.max(...values) - lo || 1;
  const points = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * W).toFixed(1)},${(H - 3 - ((v - lo) / range) * (H - 6)).toFixed(1)}`,
    )
    .join(" ");

  return (
    <svg
      className="sparkline"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function MetricCard({
  id,
  cfg,
  numeric,
  badge,
  note,
  isFault,
  trend = [],
  onClick,
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <motion.div
      className={`card modern-metric-card ${isFault ? "is-fault" : ""} ${isHovered ? "card-hovered" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => onClick(id)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onKeyDown={(e) =>
        (e.key === "Enter" || e.key === " ") &&
        (e.preventDefault(), onClick(id))
      }
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
    >
      <div className="card-top">
        <span className="card-label">{cfg.title}</span>
        <div className="card-meta">
          <span className={`badge ${badge.type}`}>{badge.text}</span>
          <span className="pin-badge">{cfg.pin}</span>
        </div>
      </div>

      <div className="card-value-wrap">
        <span className="card-value">
          {numeric == null ? "--" : numeric.toFixed(cfg.dec)}
        </span>
        <span className="card-unit">{cfg.unit}</span>
      </div>

      {/* When hovered: Reveal the smooth liquid spline graph! */}
      <AnimatePresence>
        {isHovered && trend.length >= 2 ? (
          <HoverSmoothGraph values={trend} cfg={cfg} isVisible={isHovered} />
        ) : (
          <motion.div
            className="compact-sparkline-wrap"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <CompactSparkline values={trend} color={cfg.color} />
          </motion.div>
        )}
      </AnimatePresence>

      <p className="card-footer">{note}</p>
      <div className="card-click-hint">
        <span>{isHovered ? "Click for detailed analytics" : "Hover for live graph"}</span>
        <span>↗</span>
      </div>
    </motion.div>
  );
}
