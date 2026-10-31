import { useEffect, useState } from "react";
import { useTelemetry } from "../context/TelemetryContext";

const STATUS_BADGE = {
  ok: { type: "badge-green", text: "OK" },
  uncalibrated: { type: "badge-yellow", text: "Uncalibrated" },
  unavailable: { type: "badge-gray", text: "No data" },
};

export default function SensorHealthPanel() {
  const { connected, readings, data } = useTelemetry();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const age = data?.lastReceivedAt ? Math.max(0, Math.round((now - data.lastReceivedAt) / 1000)) : null;
  const stale = age !== null && age > 6;

  const rows = [
    {
      name: "ESP32 link",
      desc: age === null ? "No data received yet." : `Last update ${age} s ago.`,
      badge: connected && !stale ? STATUS_BADGE.ok : { type: stale ? "badge-red" : "badge-gray", text: stale ? "Stale" : "Offline" },
    },
    {
      name: "Voltage sensor (ZMPT101B)",
      desc: "Pin D35. Missing readings are shown as unavailable, never as 0 V.",
      badge: STATUS_BADGE[readings?.voltageStatus] ?? STATUS_BADGE.unavailable,
    },
    {
      name: "Current sensor (ACS712)",
      desc: "Pin D34. Needs a no-load offset check and a known-load check.",
      badge: STATUS_BADGE[readings?.currentStatus] ?? STATUS_BADGE.unavailable,
    },
    {
      name: "Temperature / humidity (DHT22)",
      desc: "Pin D4. The fan is forced on if this sensor fails.",
      badge: !readings ? STATUS_BADGE.unavailable : readings.temperatureC == null ? { type: "badge-red", text: "Failed" } : STATUS_BADGE.ok,
    },
  ];

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">Sensor health</h2>
      </div>
      <div className="diag-list">
        {rows.map((r) => (
          <div className="diag-row" key={r.name}>
            <div>
              <div className="diag-name">{r.name}</div>
              <div className="diag-desc">{r.desc}</div>
            </div>
            <span className={`badge ${r.badge.type}`}>{r.badge.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
