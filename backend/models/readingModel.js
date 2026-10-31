const mongoose = require("mongoose");

// strict:false keeps every processed field (statuses, faults, raw counts) without listing them all
const readingSchema = new mongoose.Schema(
  {
    timestamp: { type: Number, required: true, index: true }, // ms since epoch
    scenario: { type: String, default: null, index: true }, // normal / overload / short / open / loose
    raw: { type: Object }, // original payload from the ESP32
  },
  { strict: false, versionKey: false },
);

module.exports = mongoose.model("Reading", readingSchema);
