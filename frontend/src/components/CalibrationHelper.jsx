import { useMemo, useState } from "react";
import { useTelemetry } from "../context/TelemetryContext";

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

export default function CalibrationHelper() {
  const { history, connected } = useTelemetry();
  const [meterV, setMeterV] = useState("");
  const [meterA, setMeterA] = useState("");
  const [floor, setFloor] = useState("20");

  // Average the last 10 raw-count samples so one noisy reading does not skew the factor
  const counts = useMemo(() => {
    const last = history.slice(-10);
    return {
      v: avg(last.map((h) => h.voltageCounts).filter((x) => typeof x === "number" && x > 0)),
      i: avg(last.map((h) => h.currentCounts).filter((x) => typeof x === "number" && x > 0)),
    };
  }, [history]);

  const mv = parseFloat(meterV);
  const ma = parseFloat(meterA);
  const fl = parseFloat(floor);

  const voltsPerCount = counts.v && mv > 0 ? mv / counts.v : null;
  const ampsPerCount = counts.i && ma > 0 && counts.i - fl > 0 ? ma / (counts.i - fl) : null;

  return (
    <section className="panel">
      <details>
        <summary className="panel-title summary">Calibration helper</summary>
        <p className="diag-desc" style={{ marginTop: 12 }}>
          Read your multimeter while the transformer and load are steady, type the values here, and copy the factor into
          the firmware. One point gives a factor only; use two or more loads to check linearity. Set{" "}
          <code>CALIBRATION</code> to true in <code>constants.js</code> only after the dashboard matches the meter within
          about 3%.
        </p>

        <div className="calib-grid">
          <div className="calib-field">
            <label htmlFor="meter-v">Meter voltage (V AC)</label>
            <input id="meter-v" type="number" step="0.01" value={meterV} onChange={(e) => setMeterV(e.target.value)} placeholder="e.g. 12.1" />
            <span className="calib-note">Raw counts (avg of last 10): {counts.v ? counts.v.toFixed(1) : "--"}</span>
            {counts.v && counts.v < 20 && (
              <span className="calib-warn">Signal is very small. Turn the ZMPT101B trimpot up first, then calibrate.</span>
            )}
            {voltsPerCount && (
              <code className="calib-result">float VOLTS_PER_COUNT = {voltsPerCount.toFixed(5)}f;</code>
            )}
          </div>

          <div className="calib-field">
            <label htmlFor="meter-a">Meter current (A AC)</label>
            <input id="meter-a" type="number" step="0.01" value={meterA} onChange={(e) => setMeterA(e.target.value)} placeholder="e.g. 0.50" />
            <label htmlFor="floor">No-load noise floor (counts)</label>
            <input id="floor" type="number" step="0.1" value={floor} onChange={(e) => setFloor(e.target.value)} />
            <span className="calib-note">Raw counts (avg of last 10): {counts.i ? counts.i.toFixed(1) : "--"}</span>
            {ampsPerCount && (
              <code className="calib-result">float AMPS_PER_COUNT = {ampsPerCount.toFixed(5)}f;</code>
            )}
          </div>
        </div>
        {!connected && <p className="calib-warn">Waiting for ESP32 data.</p>}
        <p className="diag-desc">
          Measure the noise floor with no load connected, then update <code>CURRENT_NOISE_FLOOR</code> in the firmware
          if it differs from 20.
        </p>
      </details>
    </section>
  );
}
