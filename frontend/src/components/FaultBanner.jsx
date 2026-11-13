import { useTelemetry } from "../context/TelemetryContext";

export default function FaultBanner() {
  const {
    connected,
    faults,
    faultCount,
    connectionClosed,
    isMainsOn,
    voltageUnavailable,
    lastSeen,
    bannerState,
    thresholds: t,
  } = useTelemetry();

  // Dynamic status theme:
  // Not connected -> Green
  // Connected -> Blue
  // Any fault -> Red
  const isFault = (faults && faults.length > 0) || connectionClosed;
  const bannerStatusClass = !connected
    ? "banner-green-standby"
    : isFault
      ? "banner-red-fault"
      : "banner-blue-connected";

  const icon = isFault
    ? (connectionClosed ? "🛑" : "🚨")
    : !connected
      ? "🟢"
      : "⚡";

  const title = !connected
    ? "ESP32 DISCONNECTED — STANDBY SYSTEM READY"
    : connectionClosed
      ? `CRITICAL TRIP: CONNECTION CLOSED (${faults.length} FAULTS)`
      : faults.length
        ? `FAULT DETECTED (${faults.length} active) — COOLING FAN RUNNING`
        : voltageUnavailable
          ? "VOLTAGE SENSOR UNAVAILABLE"
          : isMainsOn
            ? "SYSTEM HEALTHY — TELEMETRY STREAMING"
            : "TRANSFORMER STANDBY (MAINS OFF)";

  const detail = !connected
    ? `Waiting for ESP32 Wi-Fi connection.${lastSeen ? ` Last received at ${lastSeen}.` : ""} Autonomous on-chip protection active.`
    : voltageUnavailable
      ? "The voltage reading is missing, so the transformer state is unknown. Check the ZMPT101B wiring."
      : isMainsOn
        ? `Voltage ${t.VOLTAGE_UNDER_V}-${t.VOLTAGE_OVER_V} V, current ≤ ${t.CURRENT_OVERLOAD_A} A, temperature < ${t.TEMP_OVERHEAT_C} °C.`
        : "Secondary voltage is 0 V and no fault was detected. The DHT22 sensor is still active.";

  return (
    <div
      className={`fault-banner ${bannerStatusClass} ${connectionClosed ? "critical-trip" : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className="fault-icon" aria-hidden="true">{icon}</span>
      <div className="fault-content">
        <div className="fault-title">{title}</div>
        {connectionClosed && (
          <div className="fault-critical-notice">
            ⚠️ <strong>Emergency Multi-Fault Trip:</strong> 3 or more concurrent problems detected (or short circuit). Line connection closed/tripped to prevent transformer burnout. Cooling fan forced ON.
          </div>
        )}
        {faults.length ? (
          <ul className="fault-list">
            {faults.map((f) => (
              <li key={f.type}>
                <strong>{f.message}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>{detail}</span>
        )}
      </div>
    </div>
  );
}
