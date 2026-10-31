const { MAX_HISTORY, CONNECTION_TIMEOUT_MS } = require("../config/constants");

class TelemetryStore {
  constructor() {
    this.latestReading = null;
    this.lastReceivedAt = null;
    this.historyBuffer = [];
  }

  isConnected() {
    return (
      this.lastReceivedAt !== null &&
      Date.now() - this.lastReceivedAt < CONNECTION_TIMEOUT_MS
    );
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
      primaryVoltageRms: reading.primaryVoltageRms,
      currentRms: reading.currentRms,
      powerWatts: reading.powerWatts,
      temperatureC: reading.temperatureC,
      humidity: reading.humidity,
      fanActive: reading.fanActive,
      faultDetected: reading.faultDetected
    };

    this.historyBuffer.push(historyPoint);
    if (this.historyBuffer.length > MAX_HISTORY) {
      this.historyBuffer.shift();
    }

    return historyPoint;
  }

  getData() {
    return {
      connected: this.isConnected(),
      lastReceivedAt: this.lastReceivedAt,
      readings: this.latestReading,
      history: this.historyBuffer
    };
  }

  clear() {
    this.latestReading = null;
    this.lastReceivedAt = null;
    this.historyBuffer = [];
  }
}

// Export singleton instance
module.exports = new TelemetryStore();
