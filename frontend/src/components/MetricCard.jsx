export default function MetricCard({ id, cfg, value, badge, note, isFault, onClick }) {
  return (
    <div
      className={`card ${isFault ? "is-fault" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => onClick(id)}
      onKeyDown={(e) =>
        (e.key === "Enter" || e.key === " ") &&
        (e.preventDefault(), onClick(id))
      }
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
      <p className="card-footer">{note}</p>
      <div className="card-click-hint">
        <span>View live graph</span>
        <span>↗</span>
      </div>
    </div>
  );
}
