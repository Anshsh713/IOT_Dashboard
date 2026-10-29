const express = require("express");
const cors = require("cors");

const app = express();
const PORT = 5000;
const API_KEY = process.env.API_KEY || ""; // set API_KEY=change-me to require the ESP32 header

app.use(cors());
app.use(express.json({ limit: "15kb" }));

let latestReading = null;
let lastReceivedAt = null;
const historyBuffer = [];
const MAX_HISTORY = 60;

const TURNS_RATIO = 230.0 / 12.0;

const THRESHOLDS = {
  CURRENT_OVERLOAD_A: 1.0,
  TEMP_OVERHEAT_C: 40.0,
  VOLTAGE_ENERGIZED_MIN_V: 8.5, // below this the transformer is treated as OFF (idle ADC noise)
  VOLTAGE_UNDER_V: 10.0,
  VOLTAGE_OVER_V: 14.5,
};

app.get("/api/readings", (req, res) => {
  const connected =
    lastReceivedAt !== null && Date.now() - lastReceivedAt < 6500;
  res.json({
    connected,
    lastReceivedAt,
    readings: latestReading,
    history: historyBuffer,
  });
});

const validNumberOrNull = (v) =>
  v === null ||
  v === undefined ||
  (typeof v === "number" && Number.isFinite(v));

app.post("/api/readings", (req, res) => {
  if (API_KEY && req.get("x-api-key") !== API_KEY) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }

  const {
    voltageRms,
    voltageCounts,
    currentRms,
    currentCounts,
    temperatureC,
    humidity,
    fanActive,
  } = req.body || {};

  if (
    ![
      voltageRms,
      voltageCounts,
      currentRms,
      currentCounts,
      temperatureC,
      humidity,
    ].every(validNumberOrNull)
  ) {
    return res
      .status(400)
      .json({ success: false, error: "Invalid payload format" });
  }

  const rawV = typeof voltageRms === "number" ? voltageRms : 0;
  const rawI = typeof currentRms === "number" ? currentRms : 0;
  const tempVal =
    typeof temperatureC === "number" ? Number(temperatureC.toFixed(1)) : null;
  const humVal =
    typeof humidity === "number" ? Number(humidity.toFixed(1)) : null;

  const isMainsOn = rawV >= THRESHOLDS.VOLTAGE_ENERGIZED_MIN_V;
  const secV = isMainsOn ? Number(rawV.toFixed(1)) : 0;
  const primV = isMainsOn ? Number((secV * TURNS_RATIO).toFixed(1)) : 0;
  const current = isMainsOn && rawI > 0.08 ? Number(rawI.toFixed(2)) : 0;
  const powerVA = isMainsOn ? Number((secV * current).toFixed(2)) : 0; // apparent power (VA)

  const faults = [];
  if (isMainsOn && current > THRESHOLDS.CURRENT_OVERLOAD_A) {
    faults.push({
      type: "CURRENT_OVERLOAD",
      severity: "CRITICAL",
      param: "current",
      message: `Current Overload (${current.toFixed(2)} A > ${THRESHOLDS.CURRENT_OVERLOAD_A} A)`,
    });
  }
  if (tempVal !== null && tempVal >= THRESHOLDS.TEMP_OVERHEAT_C) {
    faults.push({
      type: "OVER_TEMPERATURE",
      severity: "WARNING",
      param: "temperature",
      message: `Over-temperature (${tempVal.toFixed(1)} °C >= ${THRESHOLDS.TEMP_OVERHEAT_C} °C)`,
    });
  }
  if (isMainsOn) {
    if (secV < THRESHOLDS.VOLTAGE_UNDER_V) {
      faults.push({
        type: "UNDER_VOLTAGE",
        severity: "WARNING",
        param: "voltage",
        message: `Secondary Under-voltage (${secV.toFixed(1)} V < ${THRESHOLDS.VOLTAGE_UNDER_V} V)`,
      });
    } else if (secV > THRESHOLDS.VOLTAGE_OVER_V) {
      faults.push({
        type: "OVER_VOLTAGE",
        severity: "CRITICAL",
        param: "voltage",
        message: `Secondary Over-voltage (${secV.toFixed(1)} V > ${THRESHOLDS.VOLTAGE_OVER_V} V)`,
      });
    }
  }

  // Trust the relay state reported by the ESP32 (it owns the hysteresis and the fail-safe)
  const isFanEngaged = fanActive === true;
  const now = Date.now();

  latestReading = {
    voltageRms: secV,
    primaryVoltageRms: primV,
    turnsRatio: Number(TURNS_RATIO.toFixed(2)),
    isMainsOn,
    currentRms: current,
    powerWatts: powerVA,
    temperatureC: tempVal,
    humidity: humVal,
    fanActive: isFanEngaged,
    faultDetected: faults.length > 0,
    faults,
    timestamp: now,
  };
  lastReceivedAt = now;

  historyBuffer.push({
    timestamp: now,
    timeLabel: new Date(now).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    voltageRms: secV,
    primaryVoltageRms: primV,
    currentRms: current,
    powerWatts: powerVA,
    temperatureC: tempVal,
    humidity: humVal,
    fanActive: isFanEngaged,
    faultDetected: faults.length > 0,
  });
  if (historyBuffer.length > MAX_HISTORY) historyBuffer.shift();

  console.log(
    `[${new Date(now).toLocaleTimeString()}] Mains ${isMainsOn ? "ON" : "OFF"} | ${secV}V | ${current}A | ${tempVal ?? "--"}C | Fan ${isFanEngaged ? "ON" : "OFF"} | Faults ${faults.length}`,
  );
  res.json({ success: true, timestamp: now, faults });
});

// Error handler (must come after routes/middleware)
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({ success: false, error: "Payload too large" });
  }
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res
      .status(400)
      .json({ success: false, error: "Malformed JSON payload from client" });
  }
  console.error("[Server Error]", err);
  res.status(500).json({ success: false, error: "Internal server error" });
});

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Smart Transformer API listening on port ${PORT} (auth ${API_KEY ? "ON" : "OFF"})`,
  );
});

server.on("error", (err) => {
  console.error(
    err.code === "EADDRINUSE" ? `[Error] Port ${PORT} already in use.` : err,
  );
  process.exit(1);
});

// Don't keep running in an unknown state: log and exit (use nodemon/pm2 to restart)
process.on("uncaughtException", (err) => {
  console.error("[Uncaught Exception]", err);
  process.exit(1);
});
