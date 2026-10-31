// VITE_API_ROOT example: http://192.168.1.20:5000/api (defaults to the same host on port 5000)
export const API_ROOT =
  import.meta.env.VITE_API_ROOT || `http://${window.location.hostname}:5000/api`;
export const API_URL = `${API_ROOT}/readings`;
export const POLL_INTERVAL_MS = 1500;

// Used until /api/config has loaded (the backend is the source of truth)
export const DEFAULT_THRESHOLDS = {
  CURRENT_OVERLOAD_A: 1.0,
  TEMP_OVERHEAT_C: 40.0,
  TEMP_FAN_OFF_C: 35.0,
  VOLTAGE_UNDER_V: 10.0,
  VOLTAGE_OVER_V: 14.5,
};

// statusFields: which backend status fields (voltageStatus / currentStatus) affect this metric
export const METRICS = {
  primVoltage: {
    title: "Primary Mains Voltage (estimated)",
    key: "primaryVoltageRms",
    unit: "V RMS",
    dec: 1,
    color: "#818cf8",
    threshold: 250,
    param: "voltage",
    pin: "230V AC",
    electrical: true,
    statusFields: ["voltageStatus"],
    desc: "Estimated from the secondary using the 230:12 nameplate ratio. Real value sags under load.",
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
    statusFields: ["voltageStatus"],
    desc: "ZMPT101B true RMS on the 12 V secondary.",
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
    statusFields: ["currentStatus"],
    desc: "ACS712 current sensor.",
  },
  power: {
    title: "Secondary Apparent Power",
    key: "powerWatts",
    unit: "VA",
    dec: 2,
    color: "#10b981",
    threshold: 15,
    pin: "S = V × I",
    electrical: true,
    statusFields: ["voltageStatus", "currentStatus"],
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
    desc: "DHT22. The fan turns on at the overheat limit and off below the release temperature.",
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

// A rule is active when any fault with one of its `types` is present. `limit` reads live thresholds.
export const FAULT_RULES = [
  {
    name: "Current overload",
    desc: "Secondary load above the overload limit while energized.",
    types: ["CURRENT_OVERLOAD"],
    limit: (t) => `> ${t.CURRENT_OVERLOAD_A} A`,
  },
  {
    name: "Short circuit",
    desc: "High current with collapsed voltage. Raised immediately.",
    types: ["SHORT_CIRCUIT"],
  },
  {
    name: "Over-temperature",
    desc: "Fan relay engages until the temperature falls to the release value.",
    types: ["OVER_TEMPERATURE"],
    limit: (t) => `≥ ${t.TEMP_OVERHEAT_C} °C`,
  },
  {
    name: "Secondary voltage window",
    desc: "Checked only when energized; 0 V alone is standby.",
    types: ["UNDER_VOLTAGE", "OVER_VOLTAGE"],
    limit: (t) => `${t.VOLTAGE_UNDER_V} - ${t.VOLTAGE_OVER_V} V`,
  },
  {
    name: "Supply loss / voltage collapse",
    desc: "No voltage when the line should be energized. Certain only with the GPIO 27 switch input.",
    types: ["SUPPLY_LOSS", "VOLTAGE_COLLAPSE"],
  },
];
