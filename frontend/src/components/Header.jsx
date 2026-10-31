import { useTheme } from "../context/ThemeContext";
import { useTelemetry } from "../context/TelemetryContext";

export default function Header() {
  const { theme, toggleTheme } = useTheme();
  const { error, connected } = useTelemetry();

  return (
    <header className="header">
      <div>
        <div className="eyebrow-row">
          <span className="eyebrow">IoT Smart Transformer</span>
          <span className="model-tag">TELEMETRY &amp; FAULT PROTECTION</span>
        </div>
        <h1>Electrical &amp; Thermal Telemetry</h1>
        <p className="subtitle">
          True RMS voltage and current, apparent power, automatic fault detection
          and thermal protection.
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

        <div className={`connection-pill ${connected ? "online" : "offline"}`}>
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
  );
}
