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
    readings,
  } = useTelemetry();

  const faultList = faults || [];
  const currentAmps = readings?.currentRms ?? 0;
  const tempC = readings?.temperatureC ?? 0;

  // Fault is considered actively running if there are active faults, current > 1.0A, or temp is not yet cooled below 35°C
  const isOverload = currentAmps > (t?.CURRENT_OVERLOAD_A ?? 1.0);
  const isOverheat = tempC >= (t?.TEMP_OVERHEAT_C ?? 40.0) || (connectionClosed && tempC >= 35.0);
  const isFaultRunning = faultList.length > 0 || isOverload || isOverheat;

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
    trip: isFaultRunning
      ? "🚨 Main Circuit Tripped (Fault Running)"
      : "⚡ Main Circuit Tripped (Fault Cleared — Ready to Restore)",
    fault: `${faultList.length} fault${faultList.length > 1 ? "s" : ""} active: cooling fan running`,
    warn: "Voltage sensor unavailable",
    live: "System healthy: telemetry streaming",
    idle: "Transformer idle: mains off",
  }[state];

  const detail = {
    standby: `Waiting for ESP32 Wi-Fi.${lastSeen ? ` Last data at ${lastSeen}.` : ""} On-chip protection is active.`,
    trip: isFaultRunning
      ? "Main supply is broken (D22 OFF). The restore button is locked until the fault clears and temperature drops below 35°C."
      : "Fault has cleared and temperature is safe (< 35°C). Click the button below to restore the main supply (D22 ON).",
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

        {/* Circuit Status & Restore Button Row */}
        <div className="sys-reset-row" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          {connectionClosed ? (
            <button
              type="button"
              className={`reset-circuit-btn ${isFaultRunning ? "locked" : "ready"}`}
              disabled={isFaultRunning}
              onClick={() => !isFaultRunning && resetCircuit && resetCircuit()}
              title={
                isFaultRunning
                  ? "Cannot reset while fault is active or temperature >= 35°C"
                  : "Click to restore power and reconnect the main supply (D22 ON)"
              }
            >
              {isFaultRunning
                ? `🔒 FAULT ACTIVE (${isOverload ? `OVERLOAD ${currentAmps.toFixed(2)}A` : `COOLING ${tempC.toFixed(1)}°C`}) — RESET LOCKED`
                : "⚡ FAULT CLEARED — CLICK TO RESTORE & RESTART CIRCUIT"}
            </button>
          ) : (
            <div className="sys-status-badge-normal">
              <span className="dot-green-pulse" />
              <span>MAIN SUPPLY: <strong>ENERGIZED (D22 ON)</strong> &bull; FAN: <strong>STANDBY (D23 ON)</strong></span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
