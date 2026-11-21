import { useTelemetry } from "../context/TelemetryContext";
import { METRICS } from "../constants/metrics";
import MetricCard from "./MetricCard";

const STATUS_RANK = { ok: 0, unavailable: 1 };

export default function MetricsGrid({ onSelectMetric }) {
  const {
    connected,
    readings,
    history,
    isMainsOn,
    faults,
    faultCount,
    connectionClosed,
    faultParams,
    fanActive,
  } = useTelemetry();

  function getCardProps(id) {
    const cfg = METRICS[id];
    const raw = readings?.[cfg.key];
    const isFault = connected && !!cfg.param && faultParams.has(cfg.param);
    const numeric = connected && typeof raw === "number" ? raw : null;

    // Worst status among the sensors this metric depends on; a missing value counts as unavailable
    const status = (cfg.statusFields ?? [])
      .map((f) => {
        const sensorStatus = readings?.[f];
        return sensorStatus === "uncalibrated"
          ? "ok"
          : sensorStatus ?? "ok";
      })
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
    }

    const state = !connected
      ? "standby"
      : isFault
        ? "fault"
        : badge.type === "badge-yellow"
          ? "warn"
          : badge.type === "badge-gray"
            ? "idle"
            : "live";

    const trend = connected
      ? history
          .map((h) => h[cfg.key])
          .filter((x) => typeof x === "number")
          .slice(-30)
      : [];

    return {
      id,
      cfg,
      numeric,
      badge,
      note,
      state,
      isFault,
      trend,
      onClick: onSelectMetric,
    };
  }

  const fanState = !connected
    ? "standby"
    : connectionClosed
      ? "fault"
      : fanActive
        ? "warn"
        : "live";

  return (
    <section className="metrics-grid">
      {Object.keys(METRICS).map((id) => (
        <MetricCard key={id} {...getCardProps(id)} />
      ))}

      {/* Cooling Fan Relay Card */}
      <div
        className="card metric-relay-card"
        data-state={fanState}
        style={{ cursor: "default" }}
      >
        <div className="card-top">
          <span className="card-label">Cooling Fan Relay</span>
          <div className="card-meta">
            <span
              className={`badge ${
                !connected
                  ? "badge-gray"
                  : connectionClosed
                    ? "badge-red"
                    : fanActive
                      ? "badge-yellow"
                      : "badge-green"
              }`}
            >
              {!connected
                ? "Offline"
                : connectionClosed
                  ? "Tripped"
                  : fanActive
                    ? "Fan ON"
                    : "Standby"}
            </span>
            <span className="pin-badge">Pin D23</span>
          </div>
        </div>
        <div className="card-value-wrap">
          <span
            className="card-value"
            style={{
              color: connectionClosed
                ? "var(--accent-red)"
                : fanActive
                  ? "var(--accent-yellow)"
                  : undefined,
            }}
          >
            {!connected ? "--" : fanActive ? "RUNNING" : "OFF"}
          </span>
        </div>
        <p className="card-footer">
          {connectionClosed
            ? "⚠️ Multi-fault trip: 3+ faults detected! Line connection closed; fan running."
            : fanActive && faults.length > 0
              ? `Engaged automatically: cooling transformer during ${faults.length} active fault(s).`
              : "Dual-tier control: ON if Current > 1.0A or Overheat (≥ 40°C). Trips line connection if short circuit occurs."}
        </p>
      </div>
    </section>
  );
}
