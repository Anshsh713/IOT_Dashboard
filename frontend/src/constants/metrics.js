export const API_URL = `http://${window.location.hostname}:5000/api/readings`;
export const POLL_INTERVAL_MS = 1500;

// Metric configuration mapping telemetry keys to labels, units, colors, and limits
export const METRICS = {
  primVoltage: {
    title: "Primary Mains Voltage",
    key: "primaryVoltageRms",
    unit: "V RMS",
    dec: 1,
    color: "#818cf8",
    threshold: 250,
    param: "voltage",
    pin: "230V AC",
    electrical: true,
    desc: "230 V primary, derived from the secondary via the 19.17 turns ratio.",
  },
  secVoltage: {
    title: "Secondary Voltage",
    key: "voltageRms",
    unit: "V RMS",
    dec: 1,
    color: "#38bdf8",
    threshold: 14.5,
    param: "voltage",
    pin: "Pin D35",
    electrical: true,
    desc: "ZMPT101B true RMS on the 12 V secondary (limits 10.0 - 14.5 V).",
  },
  current: {
    title: "Load Current",
    key: "currentRms",
    unit: "A RMS",
    dec: 2,
    color: "#f59e0b",
    threshold: 1.0,
    param: "current",
    pin: "Pin D34",
    electrical: true,
    desc: "ACS712 current sensor (fault limit > 1.0 A).",
  },
  power: {
    title: "Secondary Apparent Power",
    key: "powerWatts",
    unit: "VA",
    dec: 2,
    color: "#10b981",
    threshold: 15,
    param: "current",
    pin: "S = V × I",
    electrical: true,
    desc: "Apparent power S = V × I (not real power; no phase measurement).",
  },
  temp: {
    title: "Transformer Temperature",
    key: "temperatureC",
    unit: "°C",
    dec: 1,
    color: "#f87171",
    threshold: 40,
    param: "temperature",
    pin: "Pin D4",
    desc: "DHT22. Fan turns ON at 40 °C and OFF at 35 °C.",
  },
  humidity: {
    title: "Relative Humidity",
    key: "humidity",
    unit: "% RH",
    dec: 1,
    color: "#2dd4bf",
    threshold: 85,
    pin: "Pin D4",
    desc: "DHT22 ambient humidity inside the enclosure.",
  },
};

export const FAULT_RULES = [
  {
    name: "Current overload (> 1.0 A)",
    desc: "Secondary load above 1.0 A while energized.",
    param: "current",
  },
  {
    name: "Over-temperature (≥ 40 °C)",
    desc: "Fan relay engages until the temperature falls to 35 °C.",
    param: "temperature",
  },
  {
    name: "Secondary voltage window (10.0 - 14.5 V)",
    desc: "Checked only when energized; 0 V is a safe standby.",
    param: "voltage",
  },
];
