import { useState } from "react";
import { useTelemetry } from "../context/TelemetryContext";
import OperationsHub from "./OperationsHub";

export default function CenterTapHeroWidget() {
  const [activeView, setActiveView] = useState("safety");
  const { readings, connected, faults, connectionClosed, fanActive, thresholds: t, resetCircuit } = useTelemetry();

  const voltage = readings?.voltageRms ?? 12.0;
  const current = readings?.currentRms ?? 0.0;
  const temp = readings?.temperatureC ?? 28.0;
  const faultCount = faults ? faults.length : 0;
  const isTrip = connectionClosed || faultCount >= 3;
  const isFaultRunning = faultCount > 0 || current > (t?.CURRENT_OVERLOAD_A ?? 1.0) || (isTrip && temp >= 35.0);

  // Calculate Health Score (100 base, deductions for temperature, current, faults)
  let healthScore = 100;
  if (!connected) healthScore = 0;
  else {
    if (temp > 35) healthScore -= Math.min(30, (temp - 35) * 4);
    const overloadLimit = t?.CURRENT_OVERLOAD_A ?? 0.5;
    if (current > overloadLimit * 0.8) healthScore -= Math.min(35, ((current - overloadLimit * 0.8) / overloadLimit) * 100);
    if (faultCount > 0) healthScore -= faultCount * 25;
    if (isTrip) healthScore = 0;
  }
  healthScore = Math.max(0, Math.min(100, Math.round(healthScore)));

  const healthColor = !connected
    ? "var(--status-theme-color)"
    : isTrip || healthScore < 50
      ? "var(--accent-red)"
      : healthScore < 80
        ? "var(--accent-yellow)"
        : "var(--status-theme-color, #0ea5e9)";

  return (
    <div className="center-tap-hero-card">
      <div className="ct-view-switcher" role="group" aria-label="Center-Tap sections">
        <button
          type="button"
          className={activeView === "safety" ? "active" : ""}
          aria-pressed={activeView === "safety"}
          onClick={() => setActiveView("safety")}
        >
          System Health
        </button>
        <button
          type="button"
          className={activeView === "operations" ? "active" : ""}
          aria-pressed={activeView === "operations"}
          onClick={() => setActiveView("operations")}
        >
          Operations &amp; Diagnostics
        </button>
      </div>

      {activeView === "safety" ? (
        <div className="ct-widget-panel">
          <div className="ct-hero-header">
            <span className="ct-badge">SYSTEM HEALTH &amp; SAFETY</span>
            <div className="ct-status-dot">
              <span className="dot" style={{ background: healthColor }} />
              <span>{healthScore >= 80 ? "Nominal Grid" : healthScore >= 50 ? "Stressed" : isTrip ? "TRIPPED" : "Critical"}</span>
            </div>
          </div>

          {/* Main Health Index Gauge */}
          <div className="health-gauge-row">
            <div className="health-circle-wrap">
              <svg className="health-circle-svg" viewBox="0 0 100 100">
                <circle
                  className="bg"
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke="var(--border-color)"
                  strokeWidth="8"
                />
                <circle
                  className="meter"
                  cx="50"
                  cy="50"
                  r="40"
                  fill="none"
                  stroke={healthColor}
                  strokeWidth="8"
                  strokeDasharray="251.2"
                  strokeDashoffset={251.2 - (251.2 * healthScore) / 100}
                  strokeLinecap="round"
                />
              </svg>
              <div className="health-center-val">
                <span className="score">{connected ? healthScore : "--"}</span>
                <span className="unit">HEALTH</span>
              </div>
            </div>

            <div className="ct-health-details">
              <div className="ct-metric-line">
                <span className="k">Health Index:</span>
                <strong style={{ color: healthColor }}>{connected ? `${healthScore}%` : "Offline"}</strong>
              </div>
              <div className="ct-metric-line">
                <span className="k">Active Faults:</span>
                <strong style={{ color: faultCount > 0 ? "var(--accent-red)" : "var(--accent-green)" }}>
                  {faultCount}
                </strong>
              </div>
              <div className="ct-metric-line">
                <span className="k">Protection State:</span>
                <div style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                  <strong style={{ color: isTrip ? "var(--accent-red)" : "inherit" }}>
                    {isTrip ? "TRIPPED (CLOSED)" : faultCount > 0 ? "TIER 1 (COOLING)" : "NORMAL"}
                  </strong>
                  {isTrip && (
                    <button
                      type="button"
                      className="ct-quick-reset-btn"
                      disabled={isFaultRunning}
                      onClick={() => !isFaultRunning && resetCircuit && resetCircuit()}
                      title={isFaultRunning ? "Cannot reset while fault is active" : "Click to reset tripped circuit"}
                    >
                      {isFaultRunning ? "🔒 Locked" : "⚡ Reset"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Center-Tapped Voltage Balance Grid */}
          <div className="ct-balance-card">
            <div className="ct-balance-title">12-0-12 Center-Tapped AC Vector</div>
            <div className="ct-wave-display">
              <div className="ct-leg-box">
                <span className="leg-label">+12V Phase A</span>
                <span className="leg-val">{voltage.toFixed(2)} V</span>
                <span className="leg-ref">To 0V Center Tap</span>
              </div>
              <div className="ct-leg-divider">
                <span className="tap-pill">0V GND</span>
              </div>
              <div className="ct-leg-box">
                <span className="leg-label">-12V Phase B</span>
                <span className="leg-val">{voltage.toFixed(2)} V</span>
                <span className="leg-ref">To 0V Center Tap</span>
              </div>
            </div>
            <div className="ct-full-span">
              <span>Half Secondary Span (Phase A ↔ Center Tap):</span>
              <strong>{voltage.toFixed(2)} V</strong>
            </div>
          </div>

          {/* Dual-Tier Protection HUD */}
          <div className="tier-safety-hud">
            <div className={`tier-card tier1 ${fanActive ? "active" : ""}`}>
              <div className="tier-top">
                <span className="tier-num">TIER 1</span>
                <span className={`status-pill ${fanActive ? "on" : "idle"}`}>
                  {fanActive ? "COOLING FAN ON" : "STANDBY"}
                </span>
              </div>
              <div className="tier-desc">
                Engages Relay D23 when Current &gt; 1.0A or Temp &ge; 40.0&deg;C.
              </div>
            </div>

            <div className={`tier-card tier2 ${isTrip ? "tripped" : ""}`}>
              <div className="tier-top">
                <span className="tier-num">TIER 2</span>
                <span className={`status-pill ${isTrip ? "tripped" : "safe"}`}>
                  {isTrip ? "LINE TRIPPED" : "ARMED"}
                </span>
              </div>
              <div className="tier-desc">
                Closes connection &amp; isolates transformer when 3+ faults or short circuit occurs.
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="ct-widget-panel">
          <OperationsHub />
        </div>
      )}
    </div>
  );
}
