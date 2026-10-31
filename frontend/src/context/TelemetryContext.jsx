import { createContext, useContext, useState, useEffect, useMemo } from "react";
import { API_URL, POLL_INTERVAL_MS } from "../constants/metrics";

const TelemetryContext = createContext();

export function TelemetryProvider({ children }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    let timer;
    let controller;

    async function poll() {
      controller = new AbortController();
      try {
        const res = await fetch(API_URL, { signal: controller.signal });
        if (!res.ok) throw new Error("API Offline");
        const json = await res.json();
        if (active) {
          setData(json);
          setError(false);
        }
      } catch (e) {
        if (active && e.name !== "AbortError") setError(true);
      }
      // Next poll only after this one finished, so slow requests never overlap
      if (active) timer = setTimeout(poll, POLL_INTERVAL_MS);
    }

    poll();
    return () => {
      active = false;
      clearTimeout(timer);
      controller?.abort();
    };
  }, []);

  const value = useMemo(() => {
    const readings = data?.readings;
    const history = data?.history ?? [];
    const connected = !error && data?.connected === true && !!readings;
    const isMainsOn = connected && Boolean(readings.isMainsOn);
    const voltageUnavailable =
      connected && readings.voltageStatus === "unavailable";
    const faults = connected ? (readings.faults ?? []) : [];
    // A fault can affect several parameters (e.g. short circuit = current + voltage)
    const faultParams = new Set(faults.flatMap((f) => f.params ?? [f.param]));
    const fanActive = connected && readings.fanActive === true;
    const lastSeen = data?.lastReceivedAt
      ? new Date(data.lastReceivedAt).toLocaleTimeString()
      : null;

    const bannerState = !connected
      ? "standby"
      : faults.length
        ? "active-fault"
        : voltageUnavailable
          ? "standby"
          : isMainsOn
            ? "healthy"
            : "standby";

    return {
      data,
      readings,
      history,
      error,
      connected,
      isMainsOn,
      voltageUnavailable,
      faults,
      faultParams,
      fanActive,
      lastSeen,
      bannerState,
    };
  }, [data, error]);

  return (
    <TelemetryContext.Provider value={value}>
      {children}
    </TelemetryContext.Provider>
  );
}

export function useTelemetry() {
  const context = useContext(TelemetryContext);
  if (!context) {
    throw new Error("useTelemetry must be used within a TelemetryProvider");
  }
  return context;
}
