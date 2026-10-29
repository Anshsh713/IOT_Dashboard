/*
  ====================================================================
  Smart Transformer Monitoring System - ESP32 Production Firmware
  ====================================================================
  Sensors:
    - Secondary Voltage: ZMPT101B on GPIO 35 (via 20k/10k divider)
    - Load Current:      ACS712 on GPIO 34 (via 20k/10k divider)
    - Temp & Humidity:   DHT22 on GPIO 4 (VCC to 5V/VIN or 3.3V)
    - Cooling Relay:     5V Relay on GPIO 23 (Configurable Active Level)
    - Status LED:        GPIO 2
  ====================================================================
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <math.h>

// ---------- Wi-Fi Credentials ----------
const char* WIFI_SSID     = "realme 8";
const char* WIFI_PASSWORD = "m9wyr2ej";

// Node.js Backend API Address (Current Laptop IP)
const char* SERVER_URL    = "http://10.213.2.202:5000/api/readings";

// ---------- Pin Definitions ----------
#define VOLTAGE_PIN 35    // ADC1_CH7 - ZMPT101B
#define CURRENT_PIN 34    // ADC1_CH6 - ACS712
#define DHT_PIN     4     // GPIO 4   - DHT22 data line
#define DHT_TYPE    DHT22

#define RELAY_PIN   23    // GPIO 23  - 5V Relay (Cooling Fan)
#define LED_PIN     2     // GPIO 2   - Onboard Status LED

DHT dht(DHT_PIN, DHT_TYPE);

// ---------- Calibration Factors ----------
// Secondary Voltage: If secondary is ~12V and raw counts are ~12, factor is ~1.0
// If ZMPT trimpot is tuned to give ~280 counts, factor is 12.0/280 = 0.04285
float VOLTS_PER_COUNT = 0.9677f; // Calibrated for ~12.4 counts -> 12.0V

// ACS712 Current: ~0.01307 A/count for 5A module (or 0.02418 for 20A module)
float AMPS_PER_COUNT  = 0.01307f;

// Noise Gate Thresholds:
// Idle ADC noise with transformer OFF is ~4.5 to 6.0 counts.
// Setting threshold to 7.0f cleanly clamps idle noise to 0.00 while transformer is OFF!
const float VOLTAGE_NOISE_THRESHOLD = 7.0f;
const float CURRENT_NOISE_THRESHOLD = 15.0f;

// Thermal Fan Relay Thresholds (°C) - Turns ON when > 40°C
const float FAN_ON_TEMP  = 40.0f;
const float FAN_OFF_TEMP = 35.0f;

// ---------- Relay Logic Configuration ----------
// Most 5V single relay boards are Active HIGH (HIGH = ON, LOW = OFF)
// If your relay was running when it should be off, setting this keeps it OFF at boot!
const bool RELAY_ACTIVE_HIGH = true; 

void setRelay(bool on) {
  if (RELAY_ACTIVE_HIGH) {
    digitalWrite(RELAY_PIN, on ? HIGH : LOW);
  } else {
    digitalWrite(RELAY_PIN, on ? LOW : HIGH);
  }
}

// ---------- State & Timers ----------
bool backendConnected = false;
bool ledState = false;
bool fanActive = false;

// Cached valid readings for DHT22
float lastValidTemp = -999.0f;
float lastValidHumidity = -999.0f;
int dhtFailCount = 0;

unsigned long previousSendTime = 0;
unsigned long previousBlinkTime = 0;
unsigned long lastReconnectAttempt = 0;

const unsigned long SEND_INTERVAL  = 2000;
const unsigned long BLINK_INTERVAL = 500;

// ---------- True AC RMS Sampling (5 Full 50Hz Cycles = 100ms) ----------
float readTrueRms(int pin) {
  const unsigned long samplePeriodUs = 100000; // 100 ms window
  unsigned long startUs = micros();
  
  double sum = 0.0;
  double sumSq = 0.0;
  long sampleCount = 0;

  while (micros() - startUs < samplePeriodUs) {
    int raw = analogRead(pin);
    sum += raw;
    sumSq += (double)raw * raw;
    sampleCount++;
    delayMicroseconds(100);
  }

  if (sampleCount == 0) return 0.0f;

  double mean = sum / sampleCount;
  double variance = (sumSq / sampleCount) - (mean * mean);

  if (variance < 0.0) variance = 0.0;

  return (float)sqrt(variance);
}

// ---------- Robust DHT22 Reader with Instant Retry ----------
void readClimate(float &tempOut, float &humOut) {
  float t = dht.readTemperature(false, true);
  float h = dht.readHumidity(true);

  if (isnan(t) || isnan(h)) {
    delay(60);
    t = dht.readTemperature(false, true);
    h = dht.readHumidity(true);
  }

  tempOut = t;
  humOut  = h;
}

// ---------- Wi-Fi Connection ----------
void connectWiFi() {
  Serial.print("Connecting to Wi-Fi '");
  Serial.print(WIFI_SSID);
  Serial.print("'");

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false); // Prevents Wi-Fi drop during mains inrush
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 25) {
    digitalWrite(LED_PIN, LOW);
    delay(400);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[Wi-Fi] Connected successfully!");
    Serial.print("[Wi-Fi] ESP32 IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[Wi-Fi] Connection timed out. Auto-retry enabled in loop.");
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=========================================");
  Serial.println("  Smart Transformer Monitor Starting...  ");
  Serial.println("=========================================");

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  // Relay initialization: Ensure Fan is strictly OFF at boot!
  pinMode(RELAY_PIN, OUTPUT);
  setRelay(false); // Fan strictly OFF in normal safe condition

  analogReadResolution(12);
  analogSetPinAttenuation(VOLTAGE_PIN, ADC_11db);
  analogSetPinAttenuation(CURRENT_PIN, ADC_11db);

  // Enable internal pullup on DHT pin to assist 1-wire bus
  pinMode(DHT_PIN, INPUT_PULLUP);
  dht.begin();
  delay(1200); // Warm up DHT22 sensor

  connectWiFi();
}

void loop() {
  unsigned long now = millis();

  // ---------- Robust Non-Blocking Wi-Fi Reconnection ----------
  if (WiFi.status() != WL_CONNECTED) {
    backendConnected = false;
    ledState = false;
    digitalWrite(LED_PIN, LOW);

    if (now - lastReconnectAttempt >= 3500) {
      lastReconnectAttempt = now;
      Serial.println("[Wi-Fi] Disconnected. Re-attempting handshake...");
      WiFi.disconnect();
      WiFi.reconnect();
    }
    delay(10);
    return;
  }

  // ---------- Telemetry Cycle (Every 2s) ----------
  if (now - previousSendTime >= SEND_INTERVAL) {
    previousSendTime = now;

    // 1. Read AC Sensors with 100ms True RMS integration
    float rawVoltageCounts = readTrueRms(VOLTAGE_PIN);
    float rawCurrentCounts = readTrueRms(CURRENT_PIN);

    // Send raw counts without aggressive noise clamping so low signals are never lost
    float voltageCounts = (rawVoltageCounts < VOLTAGE_NOISE_THRESHOLD) ? 0.0f : rawVoltageCounts;
    float currentCounts = (rawCurrentCounts < CURRENT_NOISE_THRESHOLD) ? 0.0f : rawCurrentCounts;

    // Calculate Secondary Volts RMS & Load Amperes RMS
    float secVoltageRms = (voltageCounts == 0.0f) ? 0.0f : (voltageCounts * VOLTS_PER_COUNT);
    float currentAmpsRms = (currentCounts == 0.0f) ? 0.00f : ((currentCounts - 20.0f) * AMPS_PER_COUNT);
    if (currentAmpsRms < 0.0f) currentAmpsRms = 0.00f;

    // 2. Read DHT22 Temperature & Humidity
    float tempReading = NAN;
    float humReading = NAN;
    readClimate(tempReading, humReading);

    if (!isnan(tempReading) && tempReading >= 0.0f && tempReading <= 75.0f) {
      // Discard 1-wire glitch jumps (> 15 deg sudden delta from valid room baseline)
      if (lastValidTemp < -900.0f || fabs(tempReading - lastValidTemp) < 15.0f) {
        lastValidTemp = tempReading;
        dhtFailCount = 0;
      }
    } else {
      dhtFailCount++;
    }

    if (!isnan(humReading) && humReading >= 0.0f && humReading <= 100.0f) {
      lastValidHumidity = humReading;
    }

    bool hasValidTemp = (lastValidTemp > -900.0f) && (dhtFailCount < 5);
    bool hasValidHum  = (lastValidHumidity > -900.0f) && (dhtFailCount < 5);

    // 3. Automatic Cooling Fan Control (> 40°C = Fan ON, otherwise Fan OFF)
    if (hasValidTemp) {
      if (lastValidTemp >= FAN_ON_TEMP && !fanActive) {
        fanActive = true;
        setRelay(true); // Fan ON
        Serial.println("[Thermal] Fan ON: Temperature > 40C!");
      } else if (lastValidTemp <= FAN_OFF_TEMP && fanActive) {
        fanActive = false;
        setRelay(false); // Fan OFF
        Serial.println("[Thermal] Fan OFF: Temperature normalized.");
      }
    } else {
      // Safe default: fan remains OFF unless commanded
      if (fanActive) {
        fanActive = false;
        setRelay(false);
      }
    }

    // Serial Debug Summary
    Serial.println("-----------------------------------------");
    Serial.printf("[AC Volts] Sec: %.1f V RMS (ADC: %.1f cts)\n", secVoltageRms, voltageCounts);
    Serial.printf("[AC Amps]  Load: %.2f A RMS (ADC: %.1f cts)\n", currentAmpsRms, currentCounts);
    if (hasValidTemp) {
      Serial.printf("[Climate]  Temp: %.1f C | Humidity: %.1f %%\n", lastValidTemp, lastValidHumidity);
    } else {
      Serial.println("[Climate]  DHT22 reading pending / check D4 wiring.");
    }
    Serial.printf("[Relay]    Cooling Fan: %s\n", fanActive ? "ON (Active)" : "OFF (Standby)");

    // 4. Construct Clean JSON Payload (With all commas verified)
    String payload = "{";

    // Voltage
    payload += "\"voltageCounts\":" + String(voltageCounts, 2);
    payload += ",\"voltageRms\":" + String(secVoltageRms, 2);
    payload += ",\"voltageCalibrated\":true";

    // Current
    payload += ",\"currentCounts\":" + String(currentCounts, 2);
    payload += ",\"currentRms\":" + String(currentAmpsRms, 2);
    payload += ",\"currentCalibrated\":true";

    // Climate
    payload += ",\"temperatureC\":" + (hasValidTemp ? String(lastValidTemp, 1) : "null");
    payload += ",\"humidity\":" + (hasValidHum ? String(lastValidHumidity, 1) : "null");

    // Relay
    payload += ",\"fanActive\":" + String(fanActive ? "true" : "false");

    payload += "}";

    // 5. Send HTTP POST
    HTTPClient http;
    http.setTimeout(2500);
    http.begin(SERVER_URL);
    http.addHeader("Content-Type", "application/json");

    int status = http.POST(payload);
    backendConnected = (status == 200);
    http.end();
  }

  // ---------- LED Heartbeat ----------
  if (backendConnected) {
    if (now - previousBlinkTime >= BLINK_INTERVAL) {
      previousBlinkTime = now;
      ledState = !ledState;
      digitalWrite(LED_PIN, ledState ? HIGH : LOW);
    }
  } else {
    ledState = false;
    digitalWrite(LED_PIN, LOW);
  }

  delay(5);
}
