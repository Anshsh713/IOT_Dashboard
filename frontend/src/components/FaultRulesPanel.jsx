import { useTelemetry } from "../context/TelemetryContext";
import { FAULT_RULES } from "../constants/metrics";

export default function FaultRulesPanel() {
  const { connected, faultParams } = useTelemetry();

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">Fault Detection Rules</h2>
      </div>
      <div className="diag-list">
        {FAULT_RULES.map(({ name, desc, param }) => {
          const hasFault = faultParams.has(param);
          return (
            <div className="diag-row" key={param}>
              <div>
                <div className="diag-name">{name}</div>
                <div className="diag-desc">{desc}</div>
              </div>
              <span
                className={`badge ${
                  !connected ? "badge-gray" : hasFault ? "badge-red" : "badge-green"
                }`}
              >
                {!connected ? "No data" : hasFault ? "Fault" : "OK"}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
