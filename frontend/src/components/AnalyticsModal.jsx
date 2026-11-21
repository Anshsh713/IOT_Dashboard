import { useEffect, useMemo, useRef, useState } from "react";
import { useTelemetry } from "../context/TelemetryContext";
import { API_ROOT } from "../constants/metrics";
import InteractiveChart from "./InteractiveChart";

const RANGES = [
  ["live", "Live"],
  ["5", "5 min"],
  ["60", "1 h"],
  ["1440", "24 h"],
];
const CSV_KEYS = ["voltageRms", "primaryVoltageRms", "currentRms", "powerWatts", "temperatureC", "humidity"];

function downloadCsv(rows, name) {
  const lines = [["timestamp_iso", ...CSV_KEYS].join(",")];
  rows.forEach((r) => {
    lines.push([new Date(r.timestamp).toISOString(), ...CSV_KEYS.map((k) => (typeof r[k] === "number" ? r[k] : ""))].join(","));
  });
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AnalyticsModal({ cfg, onClose }) {
  const { history } = useTelemetry();
  const [range, setRange] = useState("live");
  const [remote, setRemote] = useState({ rows: [], loading: false, error: null });
  const closeRef = useRef(null);

  // Move focus into the dialog and give it back to the card when it closes
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  // Stored rolling history for the 5 min / 1 h / 24 h ranges
  useEffect(() => {
    if (range === "live") return;
    let active = true;
    async function load() {
      setRemote((r) => ({ ...r, loading: true, error: null }));
      try {
        const res = await fetch(`${API_ROOT}/history?minutes=${range}&maxPoints=600`);
        if (!res.ok) throw new Error("Could not load history.");
        const json = await res.json();
        if (active) setRemote({ rows: json.readings, loading: false, error: null });
      } catch (e) {
        if (active) setRemote({ rows: [], loading: false, error: e.message });
      }
    }
    load();
    const id = setInterval(load, 15000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [range]);

  const data = range === "live" ? history : remote.rows;

  const stats = useMemo(() => {
    const v = data.map((h) => h[cfg.key]).filter((x) => typeof x === "number");
    if (!v.length) return null;
    return {
      current: v[v.length - 1],
      min: Math.min(...v),
      max: Math.max(...v),
      avg: v.reduce((a, b) => a + b, 0) / v.length,
    };
  }, [cfg, data]);

  // Real spacing between samples, instead of a hard-coded number
  const spacing =
    data.length > 1 ? ((data[data.length - 1].timestamp - data[0].timestamp) / (data.length - 1) / 1000).toFixed(1) : null;

  const content = (
    <div
      className="modal-content"
      role="dialog"
      aria-modal="true"
      aria-labelledby="analytics-title"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="modal-header">
        <div>
          <span className="eyebrow">Detailed analytics</span>
          <h2 id="analytics-title" style={{ margin: "4px 0 0", fontSize: 22 }}>
            {cfg.title}
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-secondary)" }}>
            {cfg.desc}
          </p>
        </div>
        <button
          ref={closeRef}
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
            <div className="stat-value" style={label === "Current" ? { color: cfg.color } : undefined}>
              {v == null ? "--" : v.toFixed(cfg.dec)} {cfg.unit}
            </div>
          </div>
        ))}
      </div>

      <div className="graph-toolbar">
        <div className="graph-mode-selector" role="group" aria-label="Time range">
          {RANGES.map(([r, label]) => (
            <button
              key={r}
              type="button"
              className={`mode-btn ${range === r ? "active" : ""}`}
              onClick={() => setRange(r)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="chart-legend">
          <i style={{ background: cfg.color }} />
          {cfg.title}
        </span>
      </div>

      <div className="chart-container">
        {range !== "live" && remote.error ? (
          <div className="chart-message">{remote.error}</div>
        ) : (
          <InteractiveChart key={`${cfg.key}-${range}`} data={data} cfg={cfg} />
        )}
      </div>

      <div className="modal-footer">
        <span>
          {data.length} samples{spacing ? `, about ${spacing} s apart` : ""}
          {range !== "live" && remote.loading ? " (loading...)" : ""}
        </span>
        <button
          type="button"
          className="btn-secondary"
          disabled={!data.length}
          onClick={() => downloadCsv(data, `transformer_${range === "live" ? "live" : range + "min"}.csv`)}
        >
          Export CSV
        </button>
      </div>
    </div>
  );

  return <div className="modal-overlay" onClick={onClose}>{content}</div>;
}
