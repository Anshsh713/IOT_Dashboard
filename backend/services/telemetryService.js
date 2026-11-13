const {
  TURNS_RATIO,
  THRESHOLDS,
  CALIBRATION,
  RANGES,
  DEBOUNCE,
} = require("../config/constants");

const isNum = (x) => typeof x === "number" && Number.isFinite(x);
const r1 = (x) => Number(x.toFixed(1));
const r2 = (x) => Number(x.toFixed(2));

// Last healthy (energized, voltage inside limits) sample: tells "just collapsed" from "long idle"
const lastHealthy = { at: 0, voltage: 0, current: 0 };
// Consecutive-sample counters per fault type (debounce)
const streaks = {};

function inRange(value, [lo, hi]) {
  return (
    value === null ||
    value === undefined ||
    (isNum(value) && value >= lo && value <= hi)
  );
}

function isValidTelemetryPayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const { fanActive, expectedOn, scenario } = body;
  return (
    Object.entries(RANGES).every(([key, range]) => inRange(body[key], range)) &&
    (fanActive === undefined || typeof fanActive === "boolean") &&
    (expectedOn === undefined || typeof expectedOn === "boolean") &&
    (scenario === undefined ||
      (typeof scenario === "string" && scenario.length <= 24))
  );
}

// Keep a fault only after it has been present for enough consecutive samples
function confirmFaults(candidates) {
  const present = new Set(candidates.map((f) => f.type));
  Object.keys(streaks).forEach((type) => {
    if (!present.has(type)) delete streaks[type];
  });
  return candidates.filter((f) => {
    streaks[f.type] = (streaks[f.type] || 0) + 1;
    const needed = DEBOUNCE.IMMEDIATE_TYPES.includes(f.type)
      ? 1
      : DEBOUNCE.SAMPLES;
    return streaks[f.type] >= needed;
  });
}

function processTelemetry(raw, now = Date.now()) {
  // null = value unavailable (NOT zero)
  const v = isNum(raw.voltageRms) ? raw.voltageRms : null;
  const i = isNum(raw.currentRms) ? raw.currentRms : null;
  const tempVal = isNum(raw.temperatureC) ? r1(raw.temperatureC) : null;
  const humVal = isNum(raw.humidity) ? r1(raw.humidity) : null;
  // true/false from the ESP32 main-switch input; null = firmware does not send it
  const expectedOn =
    typeof raw.expectedOn === "boolean" ? raw.expectedOn : null;

  // State flag only. It never changes the displayed voltage.
  const isMainsOn = v !== null && v >= THRESHOLDS.VOLTAGE_ENERGIZED_MIN_V;
  const recentlyHealthy = now - lastHealthy.at < THRESHOLDS.COLLAPSE_WINDOW_MS;

  // CHANGED: always show the real measured value (no forcing to 0)
  const cleanSecVoltage = v === null ? null : r2(v);
  const cleanPrimVoltage =
    cleanSecVoltage === null ? null : r1(cleanSecVoltage * TURNS_RATIO);
  // Current is kept even when voltage is low: a short circuit is low voltage + high current
  const cleanCurrent = i === null ? null : i > 0.08 ? r2(i) : 0;
  const cleanPower =
    cleanSecVoltage === null || cleanCurrent === null
      ? null
      : r2(cleanSecVoltage * cleanCurrent);

  const candidates = [];
  const add = (type, severity, params, message) =>
    candidates.push({ type, severity, param: params[0], params, message });

  // 1. Short circuit: high current with collapsed/sagging voltage (ignored if the switch says OFF)
  const shortLike =
    v !== null &&
    cleanCurrent !== null &&
    cleanCurrent > THRESHOLDS.SHORT_CIRCUIT_A &&
    v < THRESHOLDS.VOLTAGE_UNDER_V &&
    expectedOn !== false;

  if (shortLike) {
    add(
      "SHORT_CIRCUIT",
      "CRITICAL",
      ["current", "voltage"],
      `Possible short circuit: ${cleanCurrent.toFixed(2)} A with only ${v.toFixed(1)} V on the secondary.`,
    );
  }

  // 2. De-energized when it should not be
  if (!isMainsOn && v !== null && !shortLike) {
    if (expectedOn === true) {
      add(
        "SUPPLY_LOSS",
        "CRITICAL",
        ["voltage"],
        "No secondary voltage while the main switch is ON. Check for a broken wire, blown fuse or tripped supply.",
      );
    } else if (expectedOn === null && recentlyHealthy) {
      add(
        "VOLTAGE_COLLAPSE",
        "WARNING",
        ["voltage"],
        `Voltage dropped from ${lastHealthy.voltage.toFixed(1)} V to ${v.toFixed(1)} V within ${Math.round(THRESHOLDS.COLLAPSE_WINDOW_MS / 1000)} s. Unconfirmed: a deliberate switch-off looks the same.`,
      );
    }
  }

  // 3. Normal energized checks
  if (isMainsOn && !shortLike) {
    if (cleanCurrent !== null && cleanCurrent > THRESHOLDS.CURRENT_OVERLOAD_A) {
      add(
        "CURRENT_OVERLOAD",
        "CRITICAL",
        ["current"],
        `Current overload (${cleanCurrent.toFixed(2)} A > ${THRESHOLDS.CURRENT_OVERLOAD_A} A).`,
      );
    }
    if (cleanSecVoltage < THRESHOLDS.VOLTAGE_UNDER_V) {
      add(
        "UNDER_VOLTAGE",
        "WARNING",
        ["voltage"],
        `Secondary under-voltage (${cleanSecVoltage.toFixed(1)} V < ${THRESHOLDS.VOLTAGE_UNDER_V} V).`,
      );
    } else if (cleanSecVoltage > THRESHOLDS.VOLTAGE_OVER_V) {
      add(
        "OVER_VOLTAGE",
        "CRITICAL",
        ["voltage"],
        `Secondary over-voltage (${cleanSecVoltage.toFixed(1)} V > ${THRESHOLDS.VOLTAGE_OVER_V} V).`,
      );
    }
  }

  // 4. Temperature
  if (tempVal !== null && tempVal >= THRESHOLDS.TEMP_OVERHEAT_C) {
    add(
      "OVER_TEMPERATURE",
      "WARNING",
      ["temperature"],
      `Over-temperature (${tempVal.toFixed(1)} °C >= ${THRESHOLDS.TEMP_OVERHEAT_C} °C).`,
    );
  }

  const faults = confirmFaults(candidates);

  if (isMainsOn && v >= THRESHOLDS.VOLTAGE_UNDER_V) {
    lastHealthy.at = now;
    lastHealthy.voltage = v;
    lastHealthy.current = cleanCurrent ?? 0;
  }

  const faultCount = faults.length;
  const isShortCircuit = faults.some((f) => f.type === "SHORT_CIRCUIT");

  // Rule:
  // 1 or 2 faults -> Fan turns ON automatically to cool down the unit.
  // 3 or more faults (or SHORT_CIRCUIT) -> Trip/close connection + Warning signal on screen.
  const connectionClosed = faultCount >= 3 || isShortCircuit;

  // Fan active decision:
  // If 1 or more faults are active -> Fan forced ON.
  // If temperature >= 40.0°C -> Fan forced ON.
  // If temperature <= 35.0°C and 0 faults -> Fan turns OFF.
  let isFanEngaged = raw.fanActive === true;
  if (faultCount >= 1 || (tempVal !== null && tempVal >= THRESHOLDS.TEMP_OVERHEAT_C)) {
    isFanEngaged = true;
  } else if (tempVal !== null && tempVal <= THRESHOLDS.TEMP_FAN_OFF_C && faultCount === 0) {
    isFanEngaged = false;
  }

  const deEnergizedFault = faults.some((f) =>
    ["SHORT_CIRCUIT", "SUPPLY_LOSS", "VOLTAGE_COLLAPSE"].includes(f.type),
  );
  const systemState = connectionClosed
    ? "TRIPPED_CONNECTION_CLOSED"
    : v === null
      ? "UNKNOWN"
      : isMainsOn
        ? "ENERGIZED"
        : deEnergizedFault
          ? "DE_ENERGIZED_FAULT"
          : "STANDBY";

  const sensorStatus = (value, calibrated) =>
    value === null ? "unavailable" : calibrated ? "ok" : "uncalibrated";

  const processedReading = {
    voltageRms: cleanSecVoltage,
    voltageCounts: isNum(raw.voltageCounts) ? r1(raw.voltageCounts) : null,
    primaryVoltageRms: cleanPrimVoltage,
    turnsRatio: r2(TURNS_RATIO),
    voltageCalibrated: CALIBRATION.voltage,
    voltageStatus: sensorStatus(v, CALIBRATION.voltage),
    isMainsOn,
    expectedOn,
    systemState,

    currentRms: cleanCurrent,
    currentCounts: isNum(raw.currentCounts) ? r1(raw.currentCounts) : null,
    currentCalibrated: CALIBRATION.current,
    currentStatus: sensorStatus(i, CALIBRATION.current),

    powerWatts: cleanPower,

    temperatureC: tempVal,
    humidity: humVal,

    fanActive: isFanEngaged,
    faultCount,
    connectionClosed,
    faultDetected: faults.length > 0,
    faults,

    scenario: typeof raw.scenario === "string" ? raw.scenario : null,
    timestamp: now,
  };

  return {
    processedReading,
    detectedFaults: faults,
    faultCount,
    connectionClosed,
    isMainsOn,
    cleanSecVoltage,
    cleanCurrent,
    tempVal,
    isFanEngaged,
  };
}

module.exports = { isValidTelemetryPayload, processTelemetry };
