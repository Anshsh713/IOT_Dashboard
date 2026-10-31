const telemetryStore = require("../models/telemetryModel");
const Reading = require("../models/readingModel");
const { isDbConnected } = require("../config/db");
const {
  isValidTelemetryPayload,
  processTelemetry,
} = require("../services/telemetryService");

/** GET /api/readings: connection state, latest telemetry, rolling in-memory history */
exports.getReadings = (req, res) => {
  res.json(telemetryStore.getData());
};

/** GET /api/history?minutes=60: stored readings from MongoDB (oldest first) */
exports.getHistory = async (req, res) => {
  if (!isDbConnected()) {
    return res
      .status(503)
      .json({ success: false, error: "History database not connected" });
  }
  const minutes = Math.min(Math.max(Number(req.query.minutes) || 60, 1), 1440);
  const since = Date.now() - minutes * 60 * 1000;
  try {
    const rows = await Reading.find({ timestamp: { $gte: since } })
      .sort({ timestamp: 1 })
      .limit(5000)
      .select("-raw -_id")
      .lean();
    res.json({ success: true, minutes, count: rows.length, readings: rows });
  } catch (err) {
    console.error("[History]", err.message);
    res.status(500).json({ success: false, error: "Could not load history" });
  }
};

/** POST /api/readings: ingest ESP32 telemetry, analyse faults, store */
exports.postReadings = (req, res) => {
  if (!isValidTelemetryPayload(req.body)) {
    return res.status(400).json({
      success: false,
      error: "Invalid payload format or value out of range",
    });
  }

  const {
    processedReading,
    detectedFaults,
    isMainsOn,
    cleanSecVoltage,
    cleanCurrent,
    tempVal,
    isFanEngaged,
  } = processTelemetry(req.body);

  telemetryStore.saveReading(processedReading);

  // Fire-and-forget: a database problem must never block or fail the ESP32's request
  if (isDbConnected()) {
    Reading.create({ ...processedReading, raw: req.body }).catch((err) =>
      console.error("[DB] save failed:", err.message),
    );
  }

  console.log(
    `[Telemetry ${new Date().toLocaleTimeString()}] Mains: ${isMainsOn ? "ON" : "OFF"} | SecV: ${
      cleanSecVoltage ?? "--"
    }V | Cur: ${cleanCurrent ?? "--"}A | Temp: ${tempVal ?? "--"}C | Fan: ${
      isFanEngaged ? "ON" : "OFF"
    } | Faults: ${detectedFaults.length}`,
  );

  res.json({
    success: true,
    timestamp: processedReading.timestamp,
    faults: detectedFaults,
  });
};
