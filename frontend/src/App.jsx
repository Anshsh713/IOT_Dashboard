import { useState, useEffect } from "react";
import "./App.css";
import "./panels.css";
import { TelemetryProvider, useTelemetry } from "./context/TelemetryContext";
import { METRICS } from "./constants/metrics";
import Header from "./components/Header";
import FaultBanner from "./components/FaultBanner";
import Transformer3DModel from "./components/Transformer3DModel";
import CenterTapHeroWidget from "./components/CenterTapHeroWidget";
import MetricsGrid from "./components/MetricsGrid";
import AnalyticsModal from "./components/AnalyticsModal";

function DashboardContent() {
  const [selectedMetricId, setSelectedMetricId] = useState(null);
  const { connected, faults, connectionClosed } = useTelemetry();

  // Close analytics on Escape key press
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setSelectedMetricId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeMetricCfg = selectedMetricId ? METRICS[selectedMetricId] : null;

  // SYSTEM STATUS COLOR LOGIC:
  // 1. When ESP32 is NOT connected -> WHITE
  // 2. When ESP32 is CONNECTED -> BLUE
  // 3. When ANY FAULT happens -> RED
  const systemStatusTheme = !connected
    ? "status-disconnected-green"
    : (faults && faults.length > 0) || connectionClosed
      ? "status-fault-red"
      : "status-connected-blue";

  return (
    <main
      className={`dashboard modern-dashboard ${systemStatusTheme}`}
      data-system-status={systemStatusTheme}
    >
      <Header />
      <FaultBanner />

      {/* Master Command Grid: 3D Digital Twin (65%) + Center-Tap & Safety HUD (35%) */}
      <section className="hero-command-grid">
        <div className="hero-left-3d">
          <Transformer3DModel />
        </div>
        <div className="hero-right-hud">
          <CenterTapHeroWidget />
        </div>
      </section>

      {/* Live Metrics Bento Grid with Hover Smooth Spline Graphs */}
      <section className="metrics-section">
        <MetricsGrid onSelectMetric={setSelectedMetricId} />
      </section>

      {activeMetricCfg && (
        <AnalyticsModal
          cfg={activeMetricCfg}
          onClose={() => setSelectedMetricId(null)}
        />
      )}
    </main>
  );
}

export default function App() {
  return (
    <TelemetryProvider>
      <DashboardContent />
    </TelemetryProvider>
  );
}
