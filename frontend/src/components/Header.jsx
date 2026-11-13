import { useTheme } from "../context/ThemeContext";
import { useTelemetry } from "../context/TelemetryContext";

export default function Header() {
  const { theme, toggleTheme } = useTheme();
  const { error, connected, connectionClosed, faults } = useTelemetry();
  const hasFault = (faults && faults.length > 0) || connectionClosed;

  // The 3 states:
  // Not connected -> Green (standby)
  // Connected -> Blue (streaming)
  // Fault -> Red (alert)
  const pillStatusClass = error
    ? "pill-offline-gray"
    : !connected
      ? "pill-green"
      : hasFault
        ? "pill-red"
        : "pill-blue";

  const pillText = error
    ? "Backend Offline"
    : !connected
      ? "ESP32 Disconnected (Standby)"
      : hasFault
        ? (connectionClosed ? "🚨 System Tripped" : `⚠️ ${faults.length} Fault(s) Active`)
        : "⚡ ESP32 Connected (Live)";

  return (
    <header className="header modern-header">
      <div>
        <div className="eyebrow-row">
          <span className="eyebrow">Smart Transformer Health Management</span>
          <span className="model-tag">12-0-12 CT STEP-DOWN</span>
        </div>
        <h1>Electrical &amp; Thermal Telemetry</h1>
        <p className="subtitle">
          True RMS secondary &amp; primary voltage, ACS712 load current, DHT22 climate monitoring, and automated dual-tier protection.
        </p>
      </div>

      <div className="header-actions">
        <button
          type="button"
          className="theme-toggle-btn"
          onClick={toggleTheme}
          aria-label="Toggle Theme"
        >
          {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
        </button>

        <div className={`connection-pill ${pillStatusClass}`}>
          <span className="dot" />
          <span>{pillText}</span>
        </div>
      </div>
    </header>
  );
}
