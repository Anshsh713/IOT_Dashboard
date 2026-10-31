import { useTelemetry } from "../context/TelemetryContext";
import { METRICS } from "../constants/metrics";
import MetricCard from "./MetricCard";

const STATUS_RANK = { ok: 0, uncalibrated: 1, unavailable: 2 };

export default function MetricsGrid({ onSelectMetric }) {
  const { connected, readings, isMainsOn, faults, faultParams, fanActive } =
    useTelemetry();

  function getCardProps(id) {
    const cfg = METRICS[id];
    const raw = readings?.[cfg.key];
    const isFault = connected && !!cfg.param && faultParams.has(cfg.param);
    const value =
      connected && typeof raw === "number" ? raw.toFixed(cfg.dec) : "--";

    // Worst status among the sensors this metric depends on; a missing value counts as unavailable
    const status = (cfg.statusFields ?? [])
      .map((f) => readings?.[f] ?? "ok")
      .reduce(
        (a, b) => (STATUS_RANK[b] > STATUS_RANK[a] ? b : a),
        raw == null ? "unavailable" : "ok",
      );

    let badge = { type: "badge-green", text: "Normal" };
    let note = cfg.desc;

    if (!connected) {
      badge = { type: "badge-gray", text: "Offline" };
      note = "Waiting for ESP32 data";
    } else if (isFault) {
      const f = faults.find((x) => (x.params ?? [x.param]).includes(cfg.param));
      badge = {
        type: "badge-red",
        text: f ? f.type.replaceAll("_", " ") : "Fault",
      };
      note = f ? f.message : "Fault detected";
    } else if (status === "unavailable") {
      badge = { type: "badge-gray", text: "No sensor data" };
      note = "Reading unavailable. This is not a zero reading.";
    } else if (cfg.electrical && !isMainsOn) {
      badge = { type: "badge-gray", text: "Mains OFF" };
      note = "Transformer is switched off (0 is normal standby)";
    } else if (status === "uncalibrated") {
      badge = { type: "badge-yellow", text: "Uncalibrated" };
      note = "Value not yet verified against a reference meter.";
    }

    return { id, cfg, value, badge, note, isFault, onClick: onSelectMetric };
  }

  return (
    <section className="metrics-grid">
      {Object.keys(METRICS).map((id) => (
        <MetricCard key={id} {...getCardProps(id)} />
      ))}

      {/* Cooling Fan Relay Card (fan running is normal cooling, not a fault) */}
      <div className="card" style={{ cursor: "default" }}>
        <div className="card-top">
          <span className="card-label">Cooling Fan Relay</span>
          <div className="card-meta">
            <span
              className={`badge ${
                !connected
                  ? "badge-gray"
                  : fanActive
                    ? "badge-yellow"
                    : "badge-green"
              }`}
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
          ON at ≥ 40 °C, OFF at ≤ 35 °C. Forced ON if the temperature sensor
          fails.
        </p>
      </div>
    </section>
  );
}
