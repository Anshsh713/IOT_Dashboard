import { useEffect, useState } from "react";
import { API_ROOT } from "../constants/metrics";

const STATUS_BADGE = {
  ok: { type: "badge-green", text: "OK" },
  info: { type: "badge-yellow", text: "Trend" },
  warning: { type: "badge-yellow", text: "Warning" },
  alert: { type: "badge-red", text: "Alert" },
  collecting: { type: "badge-gray", text: "Collecting" },
};

export default function InsightsPanel() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch(`${API_ROOT}/insights`);
        if (!res.ok) throw new Error();
        const json = await res.json();
        if (active) {
          setReport(json);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      }
    }
    load();
    const id = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const health = report?.health;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">Insights</h2>
        <span className="diag-desc">Statistical estimates from recent readings, not a diagnosis.</span>
      </div>

      {error && <p className="diag-desc">Could not load insights.</p>}

      {report && (
        <div className="insights-grid">
          <div className="health-box">
            <div className="stat-label">Health index (last 10 min)</div>
            <div className="health-score">{health.score ?? "--"}</div>
            <div className="health-label">{health.label}</div>
            <div className="health-bars">
              {health.breakdown.map((b) => (
                <div key={b.name} className="health-row">
                  <span>{b.name}</span>
                  <div className="health-track">
                    <div className="health-fill" style={{ width: `${(b.penalty / b.max) * 100}%` }} />
                  </div>
                  <span className="health-pen">−{b.penalty}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="insight-list">
            {report.insights.map((i) => {
              const badge = STATUS_BADGE[i.status] ?? STATUS_BADGE.ok;
              return (
                <div className="insight-item" key={i.id}>
                  <div className="insight-head">
                    <span className="diag-name">{i.title}</span>
                    <span className={`badge ${badge.type}`}>{badge.text}</span>
                  </div>
                  <p className="diag-desc">{i.message}</p>
                  {i.confidence != null && <span className="calib-note">Trend fit quality (R²): {i.confidence}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <p className="diag-desc" style={{ marginTop: 12 }}>
        The health index is a transparent penalty formula with illustrative weights. The heating estimate assumes the
        current trend continues.
      </p>
    </section>
  );
}
