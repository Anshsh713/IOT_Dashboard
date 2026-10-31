const express = require("express");
const router = express.Router();
const telemetryController = require("../controllers/telemetryController");
const apiKey = require("../middleware/apiKey");

router.get("/readings", telemetryController.getReadings);
router.get("/history", telemetryController.getHistory);
router.post("/readings", apiKey, telemetryController.postReadings);

module.exports = router;
