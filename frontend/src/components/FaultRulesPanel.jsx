import { useTelemetry } from "../context/TelemetryContext";
import { FAULT_RULES } from "../constants/metrics";

export default function FaultRulesPanel() {
  const { connected, faultTypes, thresholds } = useTelemetry();

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">Fault detection rules</h2>
      </div>
      <div className="diag-list">
        {FAULT_RULES.map(({ name, desc, types, limit }) => {
          const hasFault = types.some((t) => faultTypes.has(t));
          return (
            <div className="diag-row" key={name}>
              <div>
                <div className="diag-name">
                  {name}
                  {limit && <span className="limit-tag">{limit(thresholds)}</span>}
                </div>
                <div className="diag-desc">{desc}</div>
              </div>
              <span className={`badge ${!connected ? "badge-gray" : hasFault ? "badge-red" : "badge-green"}`}>
                {!connected ? "No data" : hasFault ? "Fault" : "OK"}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
