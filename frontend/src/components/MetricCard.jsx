function Sparkline({ values, color }) {
  if (values.length < 2) return null;
  const W = 120;
  const H = 28;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const range = hi - lo || 1;
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * W).toFixed(1)},${(H - 3 - ((v - lo) / range) * (H - 6)).toFixed(1)}`)
    .join(" ");
  return (
    <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function MetricCard({ id, cfg, value, badge, note, isFault, trend = [], onClick }) {
  return (
    <div
      className={`card ${isFault ? "is-fault" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => onClick(id)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onClick(id))}
    >
      <div className="card-top">
        <span className="card-label">{cfg.title}</span>
        <div className="card-meta">
          <span className={`badge ${badge.type}`}>{badge.text}</span>
          <span className="pin-badge">{cfg.pin}</span>
        </div>
      </div>
      <div className="card-value-wrap">
        <span className="card-value">{value}</span>
        <span className="card-unit">{cfg.unit}</span>
      </div>
      <Sparkline values={trend} color={cfg.color} />
      <p className="card-footer">{note}</p>
      <div className="card-click-hint">
        <span>View live graph</span>
        <span>↗</span>
      </div>
    </div>
  );
}
