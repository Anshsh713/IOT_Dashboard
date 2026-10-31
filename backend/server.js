require("dotenv").config();
const express = require("express");
const cors = require("cors");
const telemetryRoutes = require("./routes/telemetryRoutes");
const { connectDb } = require("./config/db");

const app = express();

// CORS_ORIGIN: comma-separated list (e.g. http://localhost:5173,http://192.168.1.20:5173).
// Leave it empty to allow any origin, which is fine on a private network.
const origins = (process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: origins.length ? origins : true }));
app.use(express.json({ limit: "15kb" }));

app.use("/api", telemetryRoutes);

// 404 for unknown routes
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Not found" });
});

// Central error handler (must be last)
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({ success: false, error: "Payload too large" });
  }
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({ success: false, error: "Malformed JSON payload from client" });
  }
  console.error("[Server Error]", err);
  res.status(500).json({ success: false, error: "Internal server error" });
});

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log("-----------------------------------------");
  console.log(` Smart Transformer API Server: Port ${PORT}`);
  console.log(` API key check: ${process.env.API_KEY ? "ON" : "OFF"}`);
  console.log("-----------------------------------------");
  connectDb();
});

server.on("error", (err) => {
  console.error(err.code === "EADDRINUSE" ? `[Error] Port ${PORT} is already in use.` : err);
  process.exit(1);
});

// Do not keep running in an unknown state: log and exit (use nodemon or pm2 to restart)
process.on("uncaughtException", (err) => {
  console.error("[Uncaught Exception]", err);
  process.exit(1);
});

module.exports = app;
