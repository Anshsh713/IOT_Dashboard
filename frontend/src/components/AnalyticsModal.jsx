import { useState, useMemo } from "react";
import { useTelemetry } from "../context/TelemetryContext";
import InteractiveChart from "./InteractiveChart";

export default function AnalyticsModal({ cfg, onClose }) {
  const { history } = useTelemetry();
  const [mode, setMode] = useState("line");

  const stats = useMemo(() => {
    if (!cfg) return null;
    const v = history
      .map((h) => h[cfg.key])
      .filter((x) => typeof x === "number");
    if (!v.length) return null;
    return {
      current: v[v.length - 1],
      min: Math.min(...v),
      max: Math.max(...v),
      avg: v.reduce((a, b) => a + b, 0) / v.length,
    };
  }, [cfg, history]);

  if (!cfg) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <span className="eyebrow">Detailed analytics</span>
            <h2 style={{ margin: "4px 0 0", fontSize: 22 }}>{cfg.title}</h2>
            <p
              style={{
                margin: "4px 0 0",
                fontSize: 13,
                color: "var(--text-secondary)",
              }}
            >
              {cfg.desc}
            </p>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="modal-stat-row">
          {[
            ["Current", stats?.current],
            ["Minimum", stats?.min],
            ["Maximum", stats?.max],
            ["Average", stats?.avg],
          ].map(([label, v]) => (
            <div className="stat-box" key={label}>
              <div className="stat-label">{label}</div>
              <div
                className="stat-value"
                style={label === "Current" ? { color: cfg.color } : undefined}
              >
                {v == null ? "--" : v.toFixed(cfg.dec)} {cfg.unit}
              </div>
            </div>
          ))}
        </div>

        <div className="graph-toolbar">
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-secondary)",
            }}
          >
            Chart type
          </span>
          <div className="graph-mode-selector">
            {[
              ["line", "📈 Line"],
              ["area", "🌊 Area"],
              ["bar", "📊 Bar"],
            ].map(([m, label]) => (
              <button
                key={m}
                type="button"
                className={`mode-btn ${mode === m ? "active" : ""}`}
                onClick={() => setMode(m)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="chart-container">
          <InteractiveChart data={history} cfg={cfg} mode={mode} />
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 12,
            color: "var(--text-muted)",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span>Last {history.length} samples</span>
          <span>~1 sample every 2 s</span>
        </div>
      </div>
    </div>
  );
}
