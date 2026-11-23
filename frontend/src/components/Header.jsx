import { useTelemetry } from "../context/TelemetryContext";

export default function Header() {
  const { error, connected, connectionClosed, faults, readings, thresholds: t, resetCircuit } = useTelemetry();
  const faultList = faults || [];
  const currentAmps = readings?.currentRms ?? 0;
  const tempC = readings?.temperatureC ?? 0;
  const hasFault = faultList.length > 0 || connectionClosed;

  const isOverload = currentAmps > (t?.CURRENT_OVERLOAD_A ?? 1.0);
  const isOverheat = tempC >= (t?.TEMP_OVERHEAT_C ?? 40.0) || (connectionClosed && tempC >= 35.0);
  const isFaultRunning = faultList.length > 0 || isOverload || isOverheat;

  // Backend offline -> gray | Not connected -> white | Fault -> red | Connected -> cyan
  const pillStatusClass = error
    ? "pill-offline-gray"
    : !connected
      ? "pill-green"
      : hasFault
        ? "pill-red"
        : "pill-blue";

  const pillState = error
    ? "offline"
    : !connected
      ? "standby"
      : hasFault
        ? "fault"
        : "live";
  const pillTitle = error
    ? "Backend Offline"
    : !connected
      ? "ESP32 Disconnected"
      : hasFault
        ? connectionClosed
          ? "System Tripped"
          : `${faults.length} Fault(s) Active`
        : "ESP32 Connected";
  const pillSub = error
    ? "Telemetry backend unavailable"
    : !connected
      ? "Standby system ready"
      : hasFault
        ? "Protection active"
        : "Live telemetry streaming";

  return (
    <header className="header modern-header hdr">
      <div className="hdr-brand">
        <div>
          <div className="eyebrow-row">
            <span className="eyebrow">Smart Transformer Health Management</span>
            <span className="model-tag">
              12-0-12 &ensp; CT &ensp; STEP-DOWN
            </span>
          </div>
          <h1>Electrical and Thermal Telemetry</h1>
          <p className="subtitle">
            Live voltage, current and temperature monitoring with automatic
            protection for your 12-0-12 transformer.
          </p>
        </div>
      </div>

      <div className="header-actions" style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        {/* Main Circuit Breaker Header Action Button */}
        {connected && connectionClosed && (
          <button
            type="button"
            className={`reset-circuit-btn ${isFaultRunning ? "locked" : "ready"}`}
            disabled={isFaultRunning}
            onClick={() => !isFaultRunning && resetCircuit && resetCircuit()}
            style={{ margin: 0, padding: "7px 14px", fontSize: "12px" }}
            title={
              isFaultRunning
                ? "Cannot reset while fault is active or cooling (>= 35°C)"
                : "Click to reconnect main power supply (D22 ON)"
            }
          >
            {isFaultRunning
              ? `🔒 LOCKED (FAULT ACTIVE)`
              : `⚡ RESTORE CIRCUIT`}
          </button>
        )}

        <div
          className={`connection-pill status-pill-x ${pillStatusClass}`}
          data-state={pillState}
          role="status"
          aria-live="polite"
        >
          <span className="pill-icon" aria-hidden="true">
            <span className="pill-core" />
          </span>
          <span className="pill-text">
            <span className="pill-title">{pillTitle}</span>
            <span className="pill-sub">{pillSub}</span>
          </span>
          {pillState === "live" && (
            <svg
              className="pill-wave"
              viewBox="0 0 56 20"
              aria-hidden="true"
            >
              <path className="wave-base" d="M1 10 H55" />
              <path
                className="wave-run"
                d="M1 10 C6 10 6 3 11 3 S16 17 21 17 26 3 31 3 36 17 41 17 46 10 55 10"
              />
            </svg>
          )}
        </div>
      </div>
    </header>
  );
}
