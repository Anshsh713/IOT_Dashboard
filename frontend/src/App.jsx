import { useEffect, useMemo, useState } from "react";
import "./App.css";

const API_URL = `http://${window.location.hostname}:5000/api/readings`;

// param links a metric to the `param` field of faults sent by the backend
const METRICS = {
  primVoltage: {
    title: "Primary Mains Voltage",
    key: "primaryVoltageRms",
    unit: "V RMS",
    dec: 1,
    color: "#818cf8",
    threshold: 250,
    param: "voltage",
    pin: "230V AC",
    electrical: true,
    desc: "230 V primary, derived from the secondary via the 19.17 turns ratio.",
  },
  secVoltage: {
    title: "Secondary Voltage",
    key: "voltageRms",
    unit: "V RMS",
    dec: 1,
    color: "#38bdf8",
    threshold: 14.5,
    param: "voltage",
    pin: "Pin D35",
    electrical: true,
    desc: "ZMPT101B true RMS on the 12 V secondary (limits 10.0 - 14.5 V).",
  },
  current: {
    title: "Load Current",
    key: "currentRms",
    unit: "A RMS",
    dec: 2,
    color: "#f59e0b",
    threshold: 1.0,
    param: "current",
    pin: "Pin D34",
    electrical: true,
    desc: "ACS712 current sensor (fault limit > 1.0 A).",
  },
  power: {
    title: "Secondary Apparent Power",
    key: "powerWatts",
    unit: "VA",
    dec: 2,
    color: "#10b981",
    threshold: 15,
    param: "current",
    pin: "S = V × I",
    electrical: true,
    desc: "Apparent power S = V × I (not real power; no phase measurement).",
  },
  temp: {
    title: "Transformer Temperature",
    key: "temperatureC",
    unit: "°C",
    dec: 1,
    color: "#f87171",
    threshold: 40,
    param: "temperature",
    pin: "Pin D4",
    desc: "DHT22. Fan turns ON at 40 °C and OFF at 35 °C.",
  },
  humidity: {
    title: "Relative Humidity",
    key: "humidity",
    unit: "% RH",
    dec: 1,
    color: "#2dd4bf",
    threshold: 85,
    pin: "Pin D4",
    desc: "DHT22 ambient humidity inside the enclosure.",
  },
};

function MetricCard({ id, cfg, value, badge, note, isFault, onClick }) {
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

function InteractiveChart({ data, cfg, mode }) {
  const [hover, setHover] = useState(null);

  const pts = useMemo(
    () =>
      data
        .filter((d) => typeof d[cfg.key] === "number")
        .map((d) => ({ t: d.timeLabel, v: d[cfg.key] })),
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

  const W = 800,
    H = 240,
    pl = 48,
    pr = 20,
    pt = 20,
    pb = 24;
  const cw = W - pl - pr,
    ch = H - pt - pb;
  const vals = pts.map((p) => p.v);
  let lo = Math.min(...vals),
    hi = Math.max(...vals, cfg.threshold);
  const pad = (hi - lo) * 0.1 || 1;
  lo = Math.max(0, lo - pad);
  hi += pad;
  const dp = hi - lo < 5 ? 2 : 1; // finer axis labels for small ranges

  const X = (i) => pl + (i / (pts.length - 1)) * cw;
  const Y = (v) => pt + ch - ((v - lo) / (hi - lo)) * ch;
  const line = pts
    .map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(p.v).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${X(pts.length - 1)} ${pt + ch} L${X(0)} ${pt + ch} Z`;
  const gid = `g-${cfg.key}`;

  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    setHover(
      Math.max(
        0,
        Math.min(
          pts.length - 1,
          Math.round(((x - pl) / cw) * (pts.length - 1)),
        ),
      ),
    );
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
                key={i}
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

function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [selected, setSelected] = useState(null);
  const [mode, setMode] = useState("line");

  useEffect(() => {
    document.body.className = theme === "light" ? "light-theme" : "";
  }, [theme]);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const res = await fetch(API_URL);
        if (!res.ok) throw new Error("offline");
        const json = await res.json();
        if (active) {
          setData(json);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      }
    }
    poll();
    const id = setInterval(poll, 1500);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const readings = data?.readings;
  const history = data?.history ?? [];
  const connected = !error && data?.connected === true && !!readings;
  const isMainsOn = connected && readings.isMainsOn;
  const faults = connected ? (readings.faults ?? []) : []; // single source of truth: backend
  const faultParams = new Set(faults.map((f) => f.param));
  const fanActive = connected && readings.fanActive === true;

  const bannerState = !connected
    ? "standby"
    : faults.length
      ? "active-fault"
      : isMainsOn
        ? "healthy"
        : "standby";

  function cardProps(id) {
    const cfg = METRICS[id];
    const raw = readings?.[cfg.key];
    const isFault = connected && faultParams.has(cfg.param);
    let value =
      connected && typeof raw === "number" ? raw.toFixed(cfg.dec) : "--";
    let badge = { type: "badge-green", text: "Normal" };
    let note = cfg.desc;

    if (!connected) {
      badge = { type: "badge-gray", text: "Offline" };
      note = "Waiting for ESP32 data";
    } else if (isFault) {
      const f = faults.find((x) => x.param === cfg.param);
      badge = { type: "badge-red", text: f.type.replace("_", " ") };
      note = f.message;
    } else if (cfg.electrical && !isMainsOn) {
      badge = { type: "badge-gray", text: "Mains OFF" };
      note = "Transformer is switched off (0 is normal standby)";
    } else if (raw == null) {
      badge = { type: "badge-yellow", text: "Reading" };
    }

    return { id, cfg, value, badge, note, isFault, onClick: setSelected };
  }

  const cfg = selected ? METRICS[selected] : null;
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

  const lastSeen = data?.lastReceivedAt
    ? new Date(data.lastReceivedAt).toLocaleTimeString()
    : null;

  return (
    <main className="dashboard">
      <header className="header">
        <div>
          <div className="eyebrow-row">
            <span className="eyebrow">IoT Smart Transformer</span>
            <span className="model-tag">TELEMETRY &amp; FAULT PROTECTION</span>
          </div>
          <h1>Electrical &amp; Thermal Telemetry</h1>
          <p className="subtitle">
            True RMS voltage and current, apparent power, automatic fault
            detection and thermal protection.
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="theme-toggle-btn"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
          </button>
          <div
            className={`connection-pill ${connected ? "online" : "offline"}`}
          >
            <span className="dot" />
            <span>
              {error
                ? "Backend Offline"
                : connected
                  ? "ESP32 Online"
                  : "ESP32 Offline"}
            </span>
          </div>
        </div>
      </header>

      <div className={`fault-banner ${bannerState}`}>
        <span className="fault-icon">
          {bannerState === "active-fault"
            ? "🚨"
            : bannerState === "healthy"
              ? "🛡️"
              : connected
                ? "💤"
                : "📡"}
        </span>
        <div className="fault-content">
          <div className="fault-title">
            {!connected
              ? "NO LIVE DATA"
              : faults.length
                ? `FAULT DETECTED (${faults.length} active)`
                : isMainsOn
                  ? "SYSTEM HEALTHY"
                  : "TRANSFORMER STANDBY (MAINS OFF)"}
          </div>
          {faults.length ? (
            <ul className="fault-list">
              {faults.map((f) => (
                <li key={f.type}>
                  <strong>{f.message}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {!connected
                ? `Status unknown.${lastSeen ? ` Last data received at ${lastSeen}.` : ""} Fan control keeps running on the ESP32 itself.`
                : isMainsOn
                  ? "Voltage 10-14.5 V, current ≤ 1.0 A, temperature < 40 °C."
                  : "Secondary voltage is 0 V. The DHT22 sensor is still active."}
            </span>
          )}
        </div>
      </div>

      <section className="metrics-grid">
        {Object.keys(METRICS).map((id) => (
          <MetricCard key={id} {...cardProps(id)} />
        ))}

        <div
          className={`card ${fanActive ? "is-fault" : ""}`}
          style={{ cursor: "default" }}
        >
          <div className="card-top">
            <span className="card-label">Cooling Fan Relay</span>
            <div className="card-meta">
              <span
                className={`badge ${!connected ? "badge-gray" : fanActive ? "badge-yellow" : "badge-green"}`}
              >
                {!connected ? "Offline" : fanActive ? "Fan on" : "Standby"}
              </span>
              <span className="pin-badge">Pin D23</span>
            </div>
          </div>
          <div className="card-value-wrap">
            <span
              className="card-value"
              style={{ color: fanActive ? "var(--accent-yellow)" : undefined }}
            >
              {!connected ? "--" : fanActive ? "RUNNING" : "OFF"}
            </span>
          </div>
          <p className="card-footer">
            ON at ≥ 40 °C, OFF at ≤ 35 °C. Also forced ON if the temperature
            sensor fails.
          </p>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Fault Detection Rules</h2>
        </div>
        <div className="diag-list">
          {[
            [
              "Current overload (> 1.0 A)",
              "Secondary load above 1.0 A while energized.",
              "current",
            ],
            [
              "Over-temperature (≥ 40 °C)",
              "Fan relay engages until the temperature falls to 35 °C.",
              "temperature",
            ],
            [
              "Secondary voltage window (10.0 - 14.5 V)",
              "Checked only when energized; 0 V is a safe standby.",
              "voltage",
            ],
          ].map(([name, desc, param]) => (
            <div className="diag-row" key={param}>
              <div>
                <div className="diag-name">{name}</div>
                <div className="diag-desc">{desc}</div>
              </div>
              <span
                className={`badge ${!connected ? "badge-gray" : faultParams.has(param) ? "badge-red" : "badge-green"}`}
              >
                {!connected
                  ? "No data"
                  : faultParams.has(param)
                    ? "Fault"
                    : "OK"}
              </span>
            </div>
          ))}
        </div>
      </section>

      {cfg && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
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
                onClick={() => setSelected(null)}
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
                    style={
                      label === "Current" ? { color: cfg.color } : undefined
                    }
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
      )}
    </main>
  );
}

export default App;
