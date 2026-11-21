import { useTelemetry } from "../context/TelemetryContext";

export default function FaultBanner() {
  const {
    connected,
    faults,
    connectionClosed,
    isMainsOn,
    voltageUnavailable,
    lastSeen,
    thresholds: t,
    resetCircuit,
  } = useTelemetry();

  const faultList = faults || [];

  // standby -> white | trip/fault -> red | warn -> yellow | live -> cyan | idle -> gray
  const state = !connected
    ? "standby"
    : connectionClosed
      ? "trip"
      : faultList.length
        ? "fault"
        : voltageUnavailable
          ? "warn"
          : isMainsOn
            ? "live"
            : "idle";

  const title = {
    standby: "Standby: waiting for ESP32",
    trip: "System tripped: line disconnected",
    fault: `${faultList.length} fault${faultList.length > 1 ? "s" : ""} active: cooling fan running`,
    warn: "Voltage sensor unavailable",
    live: "System healthy: telemetry streaming",
    idle: "Transformer idle: mains off",
  }[state];

  const detail = {
    standby: `Waiting for ESP32 Wi-Fi.${lastSeen ? ` Last data at ${lastSeen}.` : ""} On-chip protection is still active.`,
    trip: "Multiple faults or a short circuit were detected. The line is opened and the fan is forced ON.",
    fault: "Check the items below. The fan stays on until readings return to normal.",
    warn: "No voltage reading, so the transformer state is unknown. Check the ZMPT101B wiring.",
    live: `Normal range: current ≤ ${t?.CURRENT_OVERLOAD_A} A, temperature < ${t?.TEMP_OVERHEAT_C} °C.`,
    idle: "Secondary voltage is 0 V. Temperature and humidity are still being monitored.",
  }[state];

  return (
    <div
      className="sys-banner"
      data-state={state}
      role="status"
      aria-live="polite"
    >
      <span className="sys-icon" aria-hidden="true">
        <span className="sys-core" />
      </span>

      <div className="sys-body">
        <div className="sys-title">{title}</div>
        <div className="sys-detail">{detail}</div>

        {faultList.length > 0 && (
          <ul className="sys-chips">
            {faultList.map((fault) => (
              <li key={fault.type} className="sys-chip">
                {fault.message}
              </li>
            ))}
          </ul>
        )}

        {connectionClosed && (
          <div className="sys-reset-row" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="reset-circuit-btn"
              onClick={() => resetCircuit && resetCircuit()}
              title="Clear trip condition and restore circuit power"
            >
              ⚡ RESTORE &amp; RESTART CIRCUIT
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
