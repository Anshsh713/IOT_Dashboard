import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import SensorHealthPanel from "./SensorHealthPanel";
import FaultRulesPanel from "./FaultRulesPanel";
import FaultLog from "./FaultLog";
import { useTelemetry } from "../context/TelemetryContext";

export default function OperationsHub() {
  const [activeTab, setActiveTab] = useState("health");
  const { faults } = useTelemetry();
  const faultCount = faults ? faults.length : 0;

  const tabs = [
    { id: "health", label: "Sensor Diagnostics", icon: "🩺" },
    { id: "rules", label: "Safety Rules & Matrix", icon: "🛡️" },
    {
      id: "log",
      label: "Fault Events Log",
      icon: "📜",
      badge: faultCount > 0 ? `${faultCount}` : null,
    },
  ];

  return (
    <div className="operations-hub-card">
      <div className="ops-header">
        <div className="ops-title-group">
          <span className="ops-chip">OPERATIONS &amp; DIAGNOSTICS</span>
          <h3 className="ops-title">Telemetry Intelligence Center</h3>
        </div>

        <nav className="ops-tabs" aria-label="Operations Navigation">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`ops-tab-btn ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className="tab-icon">{tab.icon}</span>
              <span className="tab-label">{tab.label}</span>
              {tab.badge && <span className="tab-badge">{tab.badge}</span>}
            </button>
          ))}
        </nav>
      </div>

      <div className="ops-content">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
          >
            {activeTab === "health" && <SensorHealthPanel />}
            {activeTab === "rules" && <FaultRulesPanel />}
            {activeTab === "log" && <FaultLog />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
