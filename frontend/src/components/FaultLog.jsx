import { useEffect, useState } from "react";
import { API_ROOT } from "../constants/metrics";

function duration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${s % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

export default function FaultLog() {
  const [events, setEvents] = useState([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch(`${API_ROOT}/faults`);
        if (!res.ok) throw new Error();
        const json = await res.json();
        if (active) {
          setEvents(json.events);
          setError(false);
        }
      } catch {
        if (active) setError(true);
      }
    }
    load();
    const id = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">Fault event log</h2>
        <span className="diag-desc">Kept in server memory; cleared on restart.</span>
      </div>
      {error ? (
        <p className="diag-desc">Could not load the fault log.</p>
      ) : events.length === 0 ? (
        <p className="diag-desc">No faults recorded since the server started.</p>
      ) : (
        <div className="table-wrap">
          <table className="log-table">
            <thead>
              <tr>
                <th>Started</th>
                <th>Type</th>
                <th>Severity</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {events.slice(0, 20).map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.startedAt).toLocaleString()}</td>
                  <td title={e.message}>{e.type.replaceAll("_", " ")}</td>
                  <td>
                    <span className={`badge ${e.severity === "CRITICAL" ? "badge-red" : "badge-yellow"}`}>{e.severity}</span>
                  </td>
                  <td>{e.endedAt ? duration(e.endedAt - e.startedAt) : <span className="badge badge-red">Ongoing</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
