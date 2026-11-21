const telemetryStore = require("../models/telemetryModel");
const { THRESHOLDS, CALIBRATION } = require("../config/constants");
const { isValidTelemetryPayload, processTelemetry, clearFaultStreaks } = require("../services/telemetryService");
const { computeInsights } = require("../services/insightsService");

let pendingReset = false;

/** POST /api/reset: manual circuit restart command from the dashboard */
exports.resetCircuit = (req, res) => {
  clearFaultStreaks();
  pendingReset = true;
  const current = telemetryStore.latestReading;
  if (current) {
    current.connectionClosed = false;
    current.faultCount = 0;
    current.faults = [];
    current.fanActive = false;
    current.faultDetected = false;
    current.systemState = current.isMainsOn ? "ENERGIZED" : "STANDBY";
  }
  console.log("[Circuit Reset] Protection manually reset from Dashboard.");
  res.json({
    success: true,
    message: "Circuit protection reset command initiated",
    connectionClosed: false,
  });
};

/** GET /api/readings: connection state, latest telemetry, rolling in-memory history */
exports.getReadings = (req, res) => {
  res.json(telemetryStore.getData());
};

/** GET /api/config: thresholds and calibration flags, so the dashboard never hard-codes them */
exports.getConfig = (req, res) => {
  res.json({ thresholds: THRESHOLDS, calibration: CALIBRATION });
};

/** GET /api/faults: fault events with start and end time (in memory, reset on restart) */
exports.getFaults = (req, res) => {
  res.json({ events: telemetryStore.getFaultEvents() });
};

/** GET /api/insights: heating trend, signal stability and health index */
exports.getInsights = (req, res) => {
  res.json(computeInsights(telemetryStore.getInsightSamples()));
};

/** GET /api/history?minutes=60&maxPoints=600: rolling in-memory readings, evenly thinned to maxPoints */
exports.getHistory = (req, res) => {
  const minutes = Math.min(Math.max(Number(req.query.minutes) || 60, 1), 1440);
  const maxPoints = Math.min(Math.max(Number(req.query.maxPoints) || 600, 50), 2000);
  const since = Date.now() - minutes * 60 * 1000;

  try {
    const readings = telemetryStore.getHistory(since, maxPoints);
    res.json({ success: true, minutes, total: readings.length, count: readings.length, readings });
  } catch (err) {
    console.error("[History]", err.message);
    res.status(500).json({ success: false, error: "Could not load history" });
  }
};

/** POST /api/readings: ingest ESP32 telemetry, analyse faults, store in-memory */
exports.postReadings = (req, res) => {
  if (!isValidTelemetryPayload(req.body)) {
    return res.status(400).json({ success: false, error: "Invalid payload format or value out of range" });
  }

  const {
    processedReading,
    detectedFaults,
    faultCount,
    connectionClosed,
    isMainsOn,
    cleanSecVoltage,
    cleanCurrent,
    tempVal,
    isFanEngaged,
  } = processTelemetry(req.body);

  telemetryStore.saveReading(processedReading);

  console.log(
    `[Telemetry ${new Date().toLocaleTimeString()}] Mains: ${isMainsOn ? "ON" : "OFF"} | SecV: ${
      cleanSecVoltage ?? "--"
    }V | Cur: ${cleanCurrent ?? "--"}A | Temp: ${tempVal ?? "--"}C | Fan: ${
      isFanEngaged ? "ON" : "OFF"
    } | Faults: ${detectedFaults.length}${connectionClosed ? " | 🚨 CONNECTION CLOSED (TRIPPED)" : ""}`
  );

  const resetTriggered = pendingReset;
  if (pendingReset) {
    pendingReset = false;
  }

  res.json({
    success: true,
    timestamp: processedReading.timestamp,
    faults: detectedFaults,
    faultCount,
    fanActive: isFanEngaged,
    connectionClosed,
    disconnect: connectionClosed,
    resetCircuit: resetTriggered,
  });
};
