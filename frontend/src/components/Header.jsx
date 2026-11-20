import { useTelemetry } from "../context/TelemetryContext";

export default function Header() {
  const { error, connected, connectionClosed, faults } = useTelemetry();
  const hasFault = (faults && faults.length > 0) || connectionClosed;

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

      <div className="header-actions">
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
