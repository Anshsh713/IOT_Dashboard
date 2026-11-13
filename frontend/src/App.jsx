import { useState, useEffect } from "react";
import "./App.css";
import "./panels.css";
import { ThemeProvider } from "./context/ThemeContext";
import { TelemetryProvider, useTelemetry } from "./context/TelemetryContext";
import { METRICS } from "./constants/metrics";
import Header from "./components/Header";
import FaultBanner from "./components/FaultBanner";
import Transformer3DModel from "./components/Transformer3DModel";
import MetricsGrid from "./components/MetricsGrid";
import InsightsPanel from "./components/InsightsPanel";
import SensorHealthPanel from "./components/SensorHealthPanel";
import CalibrationHelper from "./components/CalibrationHelper";
import FaultRulesPanel from "./components/FaultRulesPanel";
import FaultLog from "./components/FaultLog";
import AnalyticsModal from "./components/AnalyticsModal";

function DashboardContent() {
  const [selectedMetricId, setSelectedMetricId] = useState(null);
  const { connected, faults, connectionClosed } = useTelemetry();

  // Close modal on Escape key press
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setSelectedMetricId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeMetricCfg = selectedMetricId ? METRICS[selectedMetricId] : null;

  // USER COLOR THEME LOGIC:
  // 1. When ESP32 is NOT connected -> GREEN
  // 2. When ESP32 is CONNECTED -> BLUE
  // 3. When ANY FAULT happens -> RED
  const systemStatusTheme = !connected
    ? "status-disconnected-green"
    : (faults && faults.length > 0) || connectionClosed
      ? "status-fault-red"
      : "status-connected-blue";

  return (
    <main
      className={`dashboard ${systemStatusTheme}`}
      data-system-status={systemStatusTheme}
    >
      <Header />
      <FaultBanner />
      <Transformer3DModel />
      <MetricsGrid onSelectMetric={setSelectedMetricId} />
      <InsightsPanel />
      <SensorHealthPanel />
      <FaultRulesPanel />
      <FaultLog />
      <CalibrationHelper />
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
    <ThemeProvider>
      <TelemetryProvider>
        <DashboardContent />
      </TelemetryProvider>
    </ThemeProvider>
  );
}
