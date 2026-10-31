import { useTelemetry } from "../context/TelemetryContext";

export default function FaultBanner() {
  const { connected, faults, isMainsOn, voltageUnavailable, lastSeen, bannerState, thresholds: t } = useTelemetry();

  const icon =
    bannerState === "active-fault"
      ? "🚨"
      : bannerState === "healthy"
        ? "🛡️"
        : !connected
          ? "📡"
          : voltageUnavailable
            ? "❓"
            : "💤";

  const title = !connected
    ? "NO LIVE DATA"
    : faults.length
      ? `FAULT DETECTED (${faults.length} active)`
      : voltageUnavailable
        ? "VOLTAGE SENSOR UNAVAILABLE"
        : isMainsOn
          ? "SYSTEM HEALTHY"
          : "TRANSFORMER STANDBY (MAINS OFF)";

  const detail = !connected
    ? `Status unknown.${lastSeen ? ` Last data received at ${lastSeen}.` : ""} Fan control keeps running on the ESP32 itself.`
    : voltageUnavailable
      ? "The voltage reading is missing, so the transformer state is unknown. Check the ZMPT101B wiring."
      : isMainsOn
        ? `Voltage ${t.VOLTAGE_UNDER_V}-${t.VOLTAGE_OVER_V} V, current ≤ ${t.CURRENT_OVERLOAD_A} A, temperature < ${t.TEMP_OVERHEAT_C} °C.`
        : "Secondary voltage is 0 V and no fault was detected. The DHT22 sensor is still active.";

  return (
    <div className={`fault-banner ${bannerState}`} role="status" aria-live="polite">
      <span className="fault-icon" aria-hidden="true">{icon}</span>
      <div className="fault-content">
        <div className="fault-title">{title}</div>
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
