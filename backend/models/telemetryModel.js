const { MAX_HISTORY, CONNECTION_TIMEOUT_MS } = require("../config/constants");

const MAX_INSIGHT_SAMPLES = 600; // about 25 min at one sample per 2.5 s (kept server-side, not sent to the dashboard)
const MAX_FAULT_EVENTS = 100;

class TelemetryStore {
  constructor() {
    this.clear();
  }

  isConnected() {
    return this.lastReceivedAt !== null && Date.now() - this.lastReceivedAt < CONNECTION_TIMEOUT_MS;
  }

  saveReading(reading) {
    this.latestReading = reading;
    this.lastReceivedAt = reading.timestamp || Date.now();

    const historyPoint = {
      timestamp: this.lastReceivedAt,
      timeLabel: new Date(this.lastReceivedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }),
      voltageRms: reading.voltageRms,
      voltageCounts: reading.voltageCounts, // raw counts, used by the calibration helper
      primaryVoltageRms: reading.primaryVoltageRms,
      currentRms: reading.currentRms,
      currentCounts: reading.currentCounts,
      powerWatts: reading.powerWatts,
      temperatureC: reading.temperatureC,
      humidity: reading.humidity,
      fanActive: reading.fanActive,
      faultCount: reading.faultCount ?? 0,
      connectionClosed: reading.connectionClosed ?? false,
      faultDetected: reading.faultDetected
    };

    this.historyBuffer.push(historyPoint);
    if (this.historyBuffer.length > MAX_HISTORY) this.historyBuffer.shift();

    this.insightBuffer.push({
      ts: this.lastReceivedAt,
      v: reading.voltageRms,
      i: reading.currentRms,
      t: reading.temperatureC,
      fan: reading.fanActive
    });
    if (this.insightBuffer.length > MAX_INSIGHT_SAMPLES) this.insightBuffer.shift();

    this.trackFaults(reading);
    return historyPoint;
  }

  // Turns the stream of "faults present" into events with a start and end time
  trackFaults(reading) {
    const now = reading.timestamp;
    const activeTypes = new Set(reading.faults.map((f) => f.type));

    for (const f of reading.faults) {
      const existing = this.activeFaults.get(f.type);
      if (existing) {
        existing.message = f.message;
      } else {
        const event = { id: `${f.type}-${now}`, type: f.type, severity: f.severity, message: f.message, startedAt: now, endedAt: null };
        this.activeFaults.set(f.type, event);
        this.faultEvents.unshift(event);
        if (this.faultEvents.length > MAX_FAULT_EVENTS) this.faultEvents.pop();
      }
    }
    for (const [type, event] of this.activeFaults) {
      if (!activeTypes.has(type)) {
        event.endedAt = now;
        this.activeFaults.delete(type);
      }
    }
  }

  getData() {
    return {
      connected: this.isConnected(),
      lastReceivedAt: this.lastReceivedAt,
      readings: this.latestReading,
      history: this.historyBuffer
    };
  }

  getFaultEvents() {
    return this.faultEvents;
  }

  getInsightSamples() {
    return this.insightBuffer;
  }

  getHistory(since = 0, maxPoints = 600) {
    const rows = this.historyBuffer.filter((h) => h.timestamp >= since);
    const step = Math.ceil(rows.length / maxPoints);
    return step > 1 ? rows.filter((_, i) => i % step === 0 || i === rows.length - 1) : rows;
  }

  clear() {
    this.latestReading = null;
    this.lastReceivedAt = null;
    this.historyBuffer = [];
    this.insightBuffer = [];
    this.faultEvents = [];
    this.activeFaults = new Map();
  }
}

module.exports = new TelemetryStore();
