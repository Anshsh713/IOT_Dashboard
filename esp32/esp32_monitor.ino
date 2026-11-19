/*
  ====================================================================
  Smart Transformer Health Management System - ESP32 Firmware
  ====================================================================
  Hardware Pin Assignments:
    - ZMPT101B AC Voltage Sensor: GPIO 35 (ADC1_CH7)
    - ACS712 AC Current Sensor:   GPIO 34 (ADC1_CH6)
    - DHT22 Temp & Humidity:      GPIO 4
    - Relay (Cooling Fan):        GPIO 23 (Active LOW relay board)
    - Status & Alarm LED:         GPIO 2
    - Main Switch Sense:          GPIO 27 (Input Pullup, optional)

  Calibrations & Enhancements:
    1. RELAY SWITCHING PROTECTION:
       - 600ms measurement settling buffer ignores electrical contact arc
         transients immediately when relay switches ON or OFF.
    2. HARDWARE MOTOR EMI FILTERING:
       - 2-sample ADC oversampling + 0.80 mV slew-rate clamp directly in
         readTrueRmsMv strips DC motor brush spark noise without needing
         distorting manual offset subtractions.
    3. EXACT VOLTAGE CALIBRATION:
       - 0.00 A (No Load)  -> 12.6 - 12.8 V
       - 0.41 A (1 Bulb)   -> 11.2 - 11.4 V
       - 0.58 A (Med Load) -> 10.2 - 10.5 V
       - 0.87 A (2 Bulbs)  ->  9.0 -  9.3 V
       - 1.03 A (Heavy)    ->  7.8 -  8.1 V
       - 1.23 A (3 Bulbs)  ->  7.4 -  7.6 V (Fan ON)
       - Transformer OFF   ->  0.00 V
    4. CURRENT CALIBRATION:
       - 100% matched to multimeter across 0.00 A to 1.23 A.
  ====================================================================
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <math.h>

// ---------- Network Configuration ----------
const char* WIFI_SSID     = "realme 8";
const char* WIFI_PASSWORD = "m9wyr2ej";

// Primary Backend Server URL
const char* SERVER_URL    = "http://10.202.246.202:5000/api/readings";
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

// ====================================================================
// CALIBRATION & SENSOR TUNING
// ====================================================================

// --- Voltage Calibration (ZMPT101B) ---
// Calibrated directly to your multimeter measurements (12.8V down to 7.4V):
// Linear formula: Volts = 2.02f * vSmooth - 0.10f
const float VOLTS_SLOPE              = 2.02f;
const float VOLTS_OFFSET             = 0.10f;
const float VOLTAGE_NOISE_FLOOR_MV   = 3.10f; // Transformer OFF clamps cleanly to 0.00 V

// --- Current Calibration (ACS712) ---
// 100% matched to multimeter (0.38A, 0.58A, 0.87A, 1.03A, 1.23A)
const float AMPS_PER_COUNT        = 0.01215f; 
const float CURRENT_ZERO_CUTOFF_A = 0.10f; 

// Low-pass filter smoothing coefficient (smooth and responsive)
const float SMOOTH_ALPHA_V = 0.20f; 
const float SMOOTH_ALPHA_I = 0.25f; 

// ---------- Protection & Relay Thresholds ----------
const float THRESHOLD_CURRENT_OVERLOAD_A = 1.0f;  // Fan turns ON when Current > 1.0 A
const float THRESHOLD_SHORT_CIRCUIT_A    = 2.2f;  // Critical short circuit limit
const float FAN_ON_TEMP                  = 40.0f; // Fan turns ON when Temp >= 40.0 °C
const float FAN_OFF_TEMP                 = 35.0f; // Fan turns OFF when Temp <= 35.0 °C
const int   DHT_FAIL_LIMIT               = 5;
const bool  FAN_ON_SENSOR_FAILURE        = false;
const unsigned long DHT_FAILSAFE_DELAY_MS = 120000;

// RELAY POLARITY: Active LOW relay board (LOW = Fan ON, HIGH = Fan OFF)
const bool  RELAY_ACTIVE_HIGH            = false; 

// ---------- Relay State & Transition Settling ----------
bool lastRelayState                 = false;
unsigned long relayChangedAt        = 0;
const unsigned long RELAY_SETTLE_TIME = 600; // 600ms sensor settling window after relay switch

void setRelay(bool on) {
  if (on != lastRelayState) {
    digitalWrite(RELAY_PIN, (on == RELAY_ACTIVE_HIGH) ? HIGH : LOW);
    lastRelayState = on;
    relayChangedAt = millis();
    Serial.printf("[Relay] State changed to %s. Settling sensors for %lu ms.\n", 
                  on ? "ON (Cooling Fan Active)" : "OFF (Standby)", RELAY_SETTLE_TIME);
  }
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
float iSmooth = 0.0f;
bool  iSmoothInit = false;

unsigned long previousSendTime      = 0;
unsigned long previousBlinkTime     = 0;
unsigned long lastReconnectAttempt  = 0;

const unsigned long SEND_INTERVAL       = 2000; // Send telemetry every 2 seconds
const unsigned long BLINK_INTERVAL      = 500;  // Normal heartbeat (500ms)
const unsigned long TRIP_BLINK_INTERVAL = 100;  // Rapid alarm strobe (100ms)

// ---------- True AC RMS for Current (ADC Counts, 5 cycles at 50Hz) ----------
float readTrueRms(int pin, float &meanOut) {
  const unsigned long windowUs = 100000; // 100 ms
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
  double var = (sumSq / n) - (mean * mean);
  return var > 0 ? (float)sqrt(var) : 0.0f;
}

// ---------- True AC RMS for Voltage with Motor EMI Filter ----------
// 2-sample oversampling + 0.80 mV slew-rate clamp eliminates DC fan motor brush sparks
float readTrueRmsMv(int pin, float &meanMvOut) {
  const unsigned long windowUs = 200000; // 200 ms (10 cycles of 50Hz)
  unsigned long start = micros();
  double sum = 0, sumSq = 0;
  long n = 0;

  // Initialize tracking filter
  float filteredMv = (float)analogReadMilliVolts(pin);

  while (micros() - start < windowUs) {
    // 2-sample averaging suppresses narrow commutator spark spikes
    float rawMv = (float)(analogReadMilliVolts(pin) + analogReadMilliVolts(pin)) * 0.5f;

    // Motor EMI Slew-Rate Limiter:
    // Legitimate 50Hz AC changes < 0.35 mV per 100 µs.
    // Clamping sudden jumps to 0.80 mV strips motor brush noise completely!
    float delta = rawMv - filteredMv;
    if (delta > 0.80f) {
      filteredMv += 0.80f;
    } else if (delta < -0.80f) {
      filteredMv -= 0.80f;
    } else {
      filteredMv = rawMv;
    }

    sum += filteredMv;
    sumSq += (double)filteredMv * filteredMv;
    n++;
    delayMicroseconds(100);
  }
  if (n == 0) { meanMvOut = 0.0f; return 0.0f; }
  double mean = sum / n;
  meanMvOut = (float)mean;
  double var = (sumSq / n) - (mean * mean);
  return var > 0 ? (float)sqrt(var) : 0.0f;
}

bool adcLooksDisconnected(float meanCounts) { return meanCounts < 100.0f || meanCounts > 3995.0f; }
bool mvLooksDisconnected(float meanMv)      { return meanMv < 80.0f || meanMv > 3150.0f; }

// ---------- DHT22 Climate Reader ----------
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

// ---------- Protection & Relay Evaluator ----------
// Rules:
// 1. Normal (no fault): Fan is OFF.
// 2. Relay runs ONLY when Current > 1.0 A OR Temperature >= 40.0 °C.
// 3. NO voltage faults (voltage sag under load is normal and does NOT trigger relay).
void evaluateProtection(float volts, float amps, float temp, bool vOk, bool iOk, bool hasTemp) {
  int faults = 0;
  bool isOverload = false;
  bool isOverheat = false;
  bool isShortCircuit = false;

  // Check 1: Current Overload (> 1.0 A)
  if (iOk && amps > THRESHOLD_CURRENT_OVERLOAD_A) {
    faults++;
    isOverload = true;
    Serial.printf("[Fault Detected] Current Overload: %.2f A > %.1f A\n", amps, THRESHOLD_CURRENT_OVERLOAD_A);
  }

  // Check 2: Short Circuit (> 2.2 A)
  if (iOk && amps > THRESHOLD_SHORT_CIRCUIT_A) {
    faults += 2;
    isShortCircuit = true;
    Serial.printf("[Fault Detected] Critical Short Circuit: %.2f A!\n", amps);
  }

  // Check 3: Over-Temperature (>= 40.0 °C)
  if (hasTemp && temp >= FAN_ON_TEMP) {
    faults++;
    isOverheat = true;
    Serial.printf("[Fault Detected] Over-Temperature: %.1f C >= %.1f C\n", temp, FAN_ON_TEMP);
  }

  localFaultCount = faults;

  // RELAY / FAN CONTROL:
  // Fan is ON ONLY if Current > 1.0 A OR Temperature >= 40.0 °C
  bool relayTrigger = (isOverload || isOverheat);

  if (isShortCircuit || faults >= 3) {
    connectionTripped = true;
    fanActive = true;
    setRelay(true);
    Serial.printf("🚨 [EMERGENCY TRIP] Short circuit / critical fault! Line connection tripped!\n");
  } else if (relayTrigger) {
    fanActive = true;
    setRelay(true);
    Serial.printf("⚠️ [Relay ON] %s%s%s -> Fan RUNNING\n",
                  isOverload ? "Current > 1.0A " : "",
                  (isOverload && isOverheat) ? "+ " : "",
                  isOverheat ? "Temp >= 40°C" : "");
  } else if ((!hasTemp || temp <= FAN_OFF_TEMP) && !isOverload) {
    if (!connectionTripped) {
      fanActive = false;
      setRelay(false); // Normal state: Fan OFF
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

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=======================================================");
  Serial.println("  Smart Transformer Health Monitor - ESP32 Firmware  ");
  Serial.println("  Clean Proportional Scale & Relay Settle Buffer      ");
  Serial.println("=======================================================");

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, (false == RELAY_ACTIVE_HIGH) ? HIGH : LOW);
  lastRelayState = false;
  relayChangedAt = millis();

  pinMode(MAIN_SW_PIN, INPUT_PULLUP);

  analogReadResolution(12);
  analogSetPinAttenuation(VOLTAGE_PIN, ADC_11db);
  analogSetPinAttenuation(CURRENT_PIN, ADC_11db);

  pinMode(DHT_PIN, INPUT_PULLUP);
  dht.begin();
  delay(1200);

  connectWiFi();
}

void loop() {
  unsigned long now = millis();
  bool wifiOk = (WiFi.status() == WL_CONNECTED);

  // Auto-reconnect Wi-Fi if dropped
  if (!wifiOk) {
    backendConnected = false;
    if (now - lastReconnectAttempt >= 3500) {
      lastReconnectAttempt = now;
      Serial.println("[Wi-Fi] Reconnecting...");
      WiFi.disconnect();
      WiFi.reconnect();
    }
  }

  // Telemetry acquisition loop every 2 seconds
  if (now - previousSendTime >= SEND_INTERVAL) {
    previousSendTime = now;
    thermalControl();

    // Check if the relay recently switched
    bool relaySettled = (now - relayChangedAt) >= RELAY_SETTLE_TIME;

    float vMeanMv = 0.0f;
    float iMeanCounts = 0.0f;

    // 1. Read AC Sensors with Motor EMI Noise Clamping
    float vRawMv  = readTrueRmsMv(VOLTAGE_PIN, vMeanMv);
    float iCounts = readTrueRms(CURRENT_PIN, iMeanCounts);

    bool vOk = !mvLooksDisconnected(vMeanMv);
    bool iOk = !adcLooksDisconnected(iMeanCounts);

    // 2. Smooth raw readings (skip updating during the 600ms relay switching transition)
    if (relaySettled) {
      if (!vSmoothInit) { vSmooth = vRawMv; vSmoothInit = true; }
      else { vSmooth += SMOOTH_ALPHA_V * (vRawMv - vSmooth); }

      if (!iSmoothInit) { iSmooth = iCounts; iSmoothInit = true; }
      else { iSmooth += SMOOTH_ALPHA_I * (iCounts - iSmooth); }
    } else {
      Serial.println("[Sensor] Ignoring transient spike during relay switching transition.");
    }

    // 3. Precision Voltage Calculation:
    // If vSmooth is below noise floor (3.10 mV), transformer is OFF -> exactly 0.00 V
    float volts = 0.0f;
    if (vSmooth > VOLTAGE_NOISE_FLOOR_MV) {
      volts = VOLTS_SLOPE * vSmooth - VOLTS_OFFSET;
      if (volts < 0.0f) volts = 0.0f;
    }

    // 4. Calculate Current (RMS Amperes)
    float amps = iSmooth * AMPS_PER_COUNT;
    if (amps < CURRENT_ZERO_CUTOFF_A) {
      amps = 0.0f; // Clamp resting noise to 0.00A
    }

    bool hasTemp = (lastValidTemp > -900.0f) && (dhtFailCount < DHT_FAIL_LIMIT);
    bool hasHum  = (lastValidHumidity > -900.0f) && (dhtFailCount < DHT_FAIL_LIMIT);
    bool expectedOn = (digitalRead(MAIN_SW_PIN) == LOW);

    // 5. Evaluate local safety protection (Relay only on Current > 1A or Temp >= 40C)
    evaluateProtection(volts, amps, lastValidTemp, vOk, iOk, hasTemp);

    // 6. Print diagnostics to Serial Monitor
    Serial.printf("[Sensor Diagnostics]\n");
    Serial.printf("  Voltage -> Raw: %6.2f mV  | Calculated: %5.2f V AC\n", vRawMv, volts);
    Serial.printf("  Current -> Raw: %6.1f cnt | Calculated: %5.2f A AC\n", iCounts, amps);
    Serial.printf("  Climate -> Temp: %4.1f C   | Humidity:   %4.1f %%\n", 
                  hasTemp ? lastValidTemp : 0.0f, hasHum ? lastValidHumidity : 0.0f);
    Serial.printf("  Status  -> Fan: %s | State: %s\n\n",
                  fanActive ? "ON" : "OFF",
                  connectionTripped ? "TRIPPED" : "NORMAL");

    // 7. Send telemetry payload to backend
    if (wifiOk) {
      String p = "{";
      p += "\"voltageCounts\":" + (vOk ? String(vSmooth, 2) : String("null"));
      p += ",\"voltageRms\":" + (vOk ? String(volts, 2) : String("null"));
      p += ",\"currentCounts\":" + (iOk ? String(iSmooth, 2) : String("null"));
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
        } else if (resp.indexOf("\"fanActive\":false") >= 0) {
          bool isOverload = (iOk && amps > THRESHOLD_CURRENT_OVERLOAD_A);
          bool isOverheat = (hasTemp && lastValidTemp >= FAN_ON_TEMP);
          if (!connectionTripped && !isOverload && !isOverheat) {
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
    // Short circuit emergency: rapid alarm strobe (100ms)
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
