// Thresholds, turns ratio, and limits for the transformer monitoring system
const TURNS_RATIO = 230.0 / 12.0;

const THRESHOLDS = {
  CURRENT_OVERLOAD_A: 1.0, // Secondary load current > 1.0 A
  SHORT_CIRCUIT_A: 2.2, // Critical short circuit limit
  TEMP_OVERHEAT_C: 40.0, // Thermal overheat threshold: >= 40.0 °C
  TEMP_FAN_OFF_C: 35.0, // Fan turns off at or below 35.0 °C
  VOLTAGE_ENERGIZED_MIN_V: 1.0, // CHANGED (was 8.5). Only decides ON vs standby; never changes the displayed value
  VOLTAGE_UNDER_V: 10.0, // Undervoltage limit when energized
  VOLTAGE_OVER_V: 14.5, // Overvoltage limit when energized
  COLLAPSE_WINDOW_MS: 30000, // A sudden drop to 0 V is flagged for this long (no expectedOn signal)
};

// Keep false until the sensor has been verified against a reference meter
const CALIBRATION = {
  voltage: false,
  current: false,
};

// Sanity ranges for incoming payload values (rejects garbage, not just wrong types)
const RANGES = {
  voltageRms: [0, 300],
  voltageCounts: [0, 4095], // now millivolts of ZMPT RMS, still well inside this range
  currentRms: [0, 50],
  currentCounts: [0, 4095],
  temperatureC: [-40, 85],
  humidity: [0, 100],
};

// A fault must appear in this many consecutive samples (2 s apart) before it is raised.
// Short circuit and supply loss are raised immediately.
const DEBOUNCE = {
  SAMPLES: 2,
  IMMEDIATE_TYPES: ["SHORT_CIRCUIT", "SUPPLY_LOSS"],
};

const MAX_HISTORY = 600; // Rolling in-memory history buffer (up to ~30 mins at 2.5s interval)
const CONNECTION_TIMEOUT_MS = 6500;

module.exports = {
  TURNS_RATIO,
  THRESHOLDS,
  CALIBRATION,
  RANGES,
  DEBOUNCE,
  MAX_HISTORY,
  CONNECTION_TIMEOUT_MS,
};
