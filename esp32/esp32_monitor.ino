/*
  ====================================================================
  Smart Transformer Health Management System - ESP32 Firmware
  ====================================================================
  Hardware Pin Assignments:
    - ZMPT101B AC Voltage Sensor: GPIO 35 (ADC1_CH7)
    - ACS712 AC Current Sensor:   GPIO 34 (ADC1_CH6)
    - DHT22 Temp & Humidity:      GPIO 4
    - Relay (Cooling Fan / Load): GPIO 23 (Active HIGH)
    - Status & Alarm LED:         GPIO 2
    - Main Switch Sense:          GPIO 27 (Input Pullup, optional)

  Protection Tiers:
    - Tier 1 (1 or 2 faults): Cooling fan (Relay D23) engages ON automatically.
    - Tier 2 (3 or more faults or Short Circuit): System connection CLOSED / TRIPPED,
      screen warning triggered, alarm LED strobes rapidly.
    - Normal (0 faults): Thermal control (Fan ON >= 40°C, Fan OFF <= 35°C).
  ====================================================================
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <math.h>

// ---------- Network Configuration ----------
const char* WIFI_SSID     = "realme 8";
const char* WIFI_PASSWORD = "m9wyr2ej";

// Primary and fallback server URLs
const char* SERVER_URL    = "http://192.168.1.7:5000/api/readings";
const char* API_KEY       = "";

// ---------- Pin Definitions ----------
#define VOLTAGE_PIN  35
#define CURRENT_PIN  34
#define DHT_PIN      4
#define DHT_TYPE     DHT22
#define RELAY_PIN    23
#define LED_PIN      2
#define MAIN_SW_PIN  27

const bool HAS_MAIN_SWITCH = false;

DHT dht(DHT_PIN, DHT_TYPE);

// ---------- Calibration & Tuning ----------
// Voltage RMS measured in millivolts (calibrated ADC). VOLTS_PER_COUNT = real secondary volts per 1 mV RMS.
float VOLTS_PER_COUNT = 1.0f;        // Tune with Dashboard Calibration Helper
const float VOLTAGE_NOISE_MV = 4.0f; // Idle noise mV with transformer OFF
float AMPS_PER_COUNT  = 0.01307f;    // ACS712-05B sensitivity factor
const float CURRENT_NOISE_FLOOR = 20.0f;
const float SMOOTH_ALPHA = 0.3f;     // Low-pass filter smoothing coefficient

// ---------- Thresholds for Protection ----------
const float THRESHOLD_CURRENT_OVERLOAD_A = 1.0f; // Current overload at 1.0 A
const float THRESHOLD_SHORT_CIRCUIT_A    = 2.0f; // Critical short circuit
const float THRESHOLD_VOLTAGE_UNDER_V    = 10.0f;// Undervoltage limit
const float THRESHOLD_VOLTAGE_OVER_V     = 14.5f;// Overvoltage limit
const float FAN_ON_TEMP                  = 40.0f;// Thermal Fan ON threshold
const float FAN_OFF_TEMP                 = 35.0f;// Thermal Fan OFF release threshold
const int   DHT_FAIL_LIMIT               = 5;
const bool  FAN_ON_SENSOR_FAILURE        = false;
const unsigned long DHT_FAILSAFE_DELAY_MS = 120000;
const bool  RELAY_ACTIVE_HIGH            = true;

void setRelay(bool on) {
  digitalWrite(RELAY_PIN, (on == RELAY_ACTIVE_HIGH) ? HIGH : LOW);
}

// ---------- System States ----------
bool backendConnected  = false;
bool ledState          = false;
bool fanActive         = false;
bool connectionTripped = false;
int  localFaultCount   = 0;

float lastValidTemp     = -999.0f;
float lastValidHumidity = -999.0f;
int   dhtFailCount      = 0;
unsigned long dhtFailSince = 0;
float vSmooth = 0.0f;
bool  vSmoothInit = false;

unsigned long previousSendTime      = 0;
unsigned long previousBlinkTime     = 0;
unsigned long lastReconnectAttempt  = 0;

const unsigned long SEND_INTERVAL       = 2000; // 2 seconds
const unsigned long BLINK_INTERVAL      = 500;  // 500 ms normal heartbeat
const unsigned long TRIP_BLINK_INTERVAL = 100;  // 100 ms rapid alarm strobe

// ---------- True AC RMS for Current (Counts) ----------
float readTrueRms(int pin, float &meanOut) {
  const unsigned long windowUs = 100000; // 100 ms = 5 full 50Hz cycles
  unsigned long start = micros();
  double sum = 0, sumSq = 0;
  long n = 0;
  while (micros() - start < windowUs) {
    int raw = analogRead(pin);
    sum += raw;
    sumSq += (double)raw * raw;
    n++;
    delayMicroseconds(100);
  }
  if (n == 0) { meanOut = 0.0f; return 0.0f; }
  double mean = sum / n;
  meanOut = (float)mean;
  double var = (sumSq / n) - mean * mean;
  return var > 0 ? (float)sqrt(var) : 0.0f;
}

// ---------- True AC RMS for Voltage (Millivolts via Calibrated ADC) ----------
float readTrueRmsMv(int pin, float &meanMvOut) {
  const unsigned long windowUs = 200000; // 200 ms = 10 full 50Hz cycles
  unsigned long start = micros();
  double sum = 0, sumSq = 0;
  long n = 0;
  while (micros() - start < windowUs) {
    int mv = analogReadMilliVolts(pin);
    sum += mv;
    sumSq += (double)mv * mv;
    n++;
    delayMicroseconds(100);
  }
  if (n == 0) { meanMvOut = 0.0f; return 0.0f; }
  double mean = sum / n;
  meanMvOut = (float)mean;
  double var = (sumSq / n) - mean * mean;
  return var > 0 ? (float)sqrt(var) : 0.0f;
}

bool adcLooksDisconnected(float meanCounts) { return meanCounts < 100.0f || meanCounts > 3995.0f; }
bool mvLooksDisconnected(float meanMv)      { return meanMv < 80.0f || meanMv > 3150.0f; }

// ---------- DHT22 Robust Climate Reader ----------
void readClimate(float &t, float &h) {
  t = dht.readTemperature(false, true);
  h = dht.readHumidity(true);
  if (isnan(t) || isnan(h)) {
    delay(60);
    t = dht.readTemperature(false, true);
    h = dht.readHumidity(true);
  }
}

// ---------- Thermal & Climate Control ----------
void thermalControl() {
  float t = NAN, h = NAN;
  readClimate(t, h);

  if (!isnan(t) && t >= 0.0f && t <= 75.0f &&
      (lastValidTemp < -900.0f || fabs(t - lastValidTemp) < 15.0f)) {
    lastValidTemp = t;
    dhtFailCount = 0;
  } else {
    dhtFailCount++;
    Serial.printf("[DHT] Bad read #%d\n", dhtFailCount);
  }

  if (!isnan(h) && h >= 0.0f && h <= 100.0f) {
    lastValidHumidity = h;
  }

  if (dhtFailCount >= DHT_FAIL_LIMIT) {
    if (dhtFailSince == 0) dhtFailSince = millis();
    if (FAN_ON_SENSOR_FAILURE && !fanActive && millis() - dhtFailSince >= DHT_FAILSAFE_DELAY_MS) {
      fanActive = true;
      setRelay(true);
      Serial.println("[Thermal] DHT22 failure failsafe: Fan forced ON");
    }
  } else {
    dhtFailSince = 0;
  }
}

// ---------- Local Protection Evaluator (Tier 1 & Tier 2) ----------
void evaluateProtection(float volts, float amps, float temp, bool vOk, bool iOk, bool hasTemp) {
  int faults = 0;

  // Check 1: Current Overload > 1.0 A
  if (iOk && amps > THRESHOLD_CURRENT_OVERLOAD_A) {
    faults++;
    Serial.printf("[Fault Detected] Current Overload: %.2f A > %.1f A\n", amps, THRESHOLD_CURRENT_OVERLOAD_A);
  }

  // Check 2: Short Circuit (High Current + Collapsed Voltage)
  if (iOk && amps > THRESHOLD_SHORT_CIRCUIT_A && volts < THRESHOLD_VOLTAGE_UNDER_V) {
    faults += 2; // Short circuit is immediately critical
    Serial.printf("[Fault Detected] Short Circuit: %.2f A with voltage %.1f V!\n", amps, volts);
  }

  // Check 3: Over-Temperature >= 40 °C
  if (hasTemp && temp >= FAN_ON_TEMP) {
    faults++;
    Serial.printf("[Fault Detected] Over-Temperature: %.1f C >= %.1f C\n", temp, FAN_ON_TEMP);
  }

  // Check 4: Voltage Window when Energized
  if (vOk && volts >= 1.0f) {
    if (volts < THRESHOLD_VOLTAGE_UNDER_V) {
      faults++;
      Serial.printf("[Fault Detected] Under-Voltage: %.1f V < %.1f V\n", volts, THRESHOLD_VOLTAGE_UNDER_V);
    } else if (volts > THRESHOLD_VOLTAGE_OVER_V) {
      faults++;
      Serial.printf("[Fault Detected] Over-Voltage: %.1f V > %.1f V\n", volts, THRESHOLD_VOLTAGE_OVER_V);
    }
  }

  localFaultCount = faults;

  // DUAL-TIER LOGIC:
  // 1 or 2 faults: Fan ON automatically to cool down the system.
  // 3 or more faults: Closed / tripped connection + Warning signal on screen.
  if (faults >= 3) {
    connectionTripped = true;
    fanActive = true;
    setRelay(true);
    Serial.printf("🚨 [EMERGENCY TRIP] %d Faults Active! Connection CLOSED to protect transformer!\n", faults);
  } else if (faults >= 1 || (hasTemp && temp >= FAN_ON_TEMP)) {
    fanActive = true;
    setRelay(true);
    Serial.printf("⚠️ [TIER 1] %d Fault(s) active -> Relay Fan ON\n", faults);
  } else if (hasTemp && temp <= FAN_OFF_TEMP && faults == 0) {
    if (!connectionTripped) {
      fanActive = false;
      setRelay(false);
      Serial.println("[Normal] System healthy -> Relay Fan OFF");
    }
  }
}

// ---------- Wi-Fi Manager ----------
void connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[Wi-Fi] Connecting to ");
  Serial.print(WIFI_SSID);
  for (int i = 0; i < 25 && WiFi.status() != WL_CONNECTED; i++) {
    delay(400);
    Serial.print(".");
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[Wi-Fi] Connected! IP: " + WiFi.localIP().toString());
  } else {
    Serial.println("\n[Wi-Fi] Timed out, auto-retry will continue in background.");
  }
}

const char* resetReasonText() {
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON:  return "power-on";
    case ESP_RST_SW:       return "software reset";
    case ESP_RST_PANIC:    return "crash (panic)";
    case ESP_RST_INT_WDT:
    case ESP_RST_TASK_WDT:
    case ESP_RST_WDT:      return "watchdog";
    case ESP_RST_BROWNOUT: return "BROWNOUT (power dip)";
    default:               return "other";
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.printf("\n[Boot] Smart Transformer Health Monitor starting (Reset: %s)\n", resetReasonText());

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  pinMode(RELAY_PIN, OUTPUT);
  setRelay(false); // Fan strictly OFF at boot

  pinMode(MAIN_SW_PIN, INPUT_PULLUP);

  analogReadResolution(12);
  analogSetPinAttenuation(VOLTAGE_PIN, ADC_11db);
  analogSetPinAttenuation(CURRENT_PIN, ADC_11db);

  pinMode(DHT_PIN, INPUT_PULLUP);
  dht.begin();
  delay(1200); // Warm up DHT22

  connectWiFi();
}

void loop() {
  unsigned long now = millis();
  bool wifiOk = (WiFi.status() == WL_CONNECTED);

  // Auto-reconnect Wi-Fi
  if (!wifiOk) {
    backendConnected = false;
    if (now - lastReconnectAttempt >= 3500) {
      lastReconnectAttempt = now;
      Serial.println("[Wi-Fi] Reconnecting...");
      WiFi.disconnect();
      WiFi.reconnect();
    }
  }

  // Telemetry cycle every 2 seconds
  if (now - previousSendTime >= SEND_INTERVAL) {
    previousSendTime = now;
    thermalControl();

    float vMeanMv, iMean;
    float vRawMv  = readTrueRmsMv(VOLTAGE_PIN, vMeanMv);
    float iCounts = readTrueRms(CURRENT_PIN, iMean);
    bool vOk = !mvLooksDisconnected(vMeanMv);
    bool iOk = !adcLooksDisconnected(iMean);

    // Filter idle noise and smooth
    float vSig = sqrtf(fmaxf(0.0f, vRawMv * vRawMv - VOLTAGE_NOISE_MV * VOLTAGE_NOISE_MV));
    if (!vSmoothInit) { vSmooth = vSig; vSmoothInit = true; }
    else vSmooth += SMOOTH_ALPHA * (vSig - vSmooth);

    float volts = vSmooth * VOLTS_PER_COUNT;
    float amps  = (iCounts - CURRENT_NOISE_FLOOR) * AMPS_PER_COUNT;
    if (amps < 0.0f) amps = 0.0f;

    bool hasTemp = (lastValidTemp > -900.0f) && (dhtFailCount < DHT_FAIL_LIMIT);
    bool hasHum  = (lastValidHumidity > -900.0f) && (dhtFailCount < DHT_FAIL_LIMIT);
    bool expectedOn = (digitalRead(MAIN_SW_PIN) == LOW);

    // Evaluate protection tiers (1-2 faults: Fan ON, 3+ faults: Connection closed)
    evaluateProtection(volts, amps, lastValidTemp, vOk, iOk, hasTemp);

    Serial.printf("[Telemetry] V:%s (raw %.1f mV) | A:%s | T:%s | Fan:%s | State:%s\n",
                  vOk ? String(volts, 2).c_str() : "n/a", vRawMv,
                  iOk ? String(amps, 2).c_str() : "n/a",
                  hasTemp ? String(lastValidTemp, 1).c_str() : "n/a",
                  fanActive ? "ON" : "OFF",
                  connectionTripped ? "TRIPPED" : "NORMAL");

    if (wifiOk) {
      String p = "{";
      p += "\"voltageCounts\":" + (vOk ? String(vSmooth, 2) : String("null"));
      p += ",\"voltageRms\":" + (vOk ? String(volts, 2) : String("null"));
      p += ",\"currentCounts\":" + (iOk ? String(iCounts, 2) : String("null"));
      p += ",\"currentRms\":" + (iOk ? String(amps, 2) : String("null"));
      p += ",\"temperatureC\":" + (hasTemp ? String(lastValidTemp, 1) : String("null"));
      p += ",\"humidity\":" + (hasHum ? String(lastValidHumidity, 1) : String("null"));
      p += ",\"fanActive\":" + String(fanActive ? "true" : "false");
      if (HAS_MAIN_SWITCH) p += ",\"expectedOn\":" + String(expectedOn ? "true" : "false");
      p += "}";

      HTTPClient http;
      http.setTimeout(2500);
      http.begin(SERVER_URL);
      http.addHeader("Content-Type", "application/json");
      if (strlen(API_KEY) > 0) http.addHeader("x-api-key", API_KEY);

      int httpCode = http.POST(p);
      backendConnected = (httpCode == 200);

      // Parse backend directives
      if (backendConnected) {
        String resp = http.getString();
        if (resp.indexOf("\"connectionClosed\":true") >= 0 || resp.indexOf("\"disconnect\":true") >= 0) {
          connectionTripped = true;
          fanActive = true;
          setRelay(true);
        }
        if (resp.indexOf("\"fanActive\":true") >= 0) {
          fanActive = true;
          setRelay(true);
        } else if (resp.indexOf("\"fanActive\":false") >= 0 && localFaultCount == 0 && (lastValidTemp < FAN_ON_TEMP)) {
          if (!connectionTripped) {
            fanActive = false;
            setRelay(false);
          }
        }
      }
      http.end();
    }
  }

  // ---------- LED Heartbeat & Alarm Blink ----------
  if (connectionTripped) {
    // 3+ faults emergency: rapid alarm strobe (100ms)
    if (now - previousBlinkTime >= TRIP_BLINK_INTERVAL) {
      previousBlinkTime = now;
      ledState = !ledState;
      digitalWrite(LED_PIN, ledState ? HIGH : LOW);
    }
  } else if (backendConnected) {
    // Normal connected heartbeat (500ms)
    if (now - previousBlinkTime >= BLINK_INTERVAL) {
      previousBlinkTime = now;
      ledState = !ledState;
      digitalWrite(LED_PIN, ledState ? HIGH : LOW);
    }
  } else {
    // Disconnected
    digitalWrite(LED_PIN, LOW);
  }

  delay(5);
}
