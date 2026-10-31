import { useState, useEffect } from "react";
import "./App.css";
import { ThemeProvider } from "./context/ThemeContext";
import { TelemetryProvider } from "./context/TelemetryContext";
import { METRICS } from "./constants/metrics";
import Header from "./components/Header";
import FaultBanner from "./components/FaultBanner";
import MetricsGrid from "./components/MetricsGrid";
import FaultRulesPanel from "./components/FaultRulesPanel";
import AnalyticsModal from "./components/AnalyticsModal";

function DashboardContent() {
  const [selectedMetricId, setSelectedMetricId] = useState(null);

  // Close modal on Escape key press
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && setSelectedMetricId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeMetricCfg = selectedMetricId ? METRICS[selectedMetricId] : null;

  return (
    <main className="dashboard">
      <Header />
      <FaultBanner />
      <MetricsGrid onSelectMetric={setSelectedMetricId} />
      <FaultRulesPanel />
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
