/*
  ====================================================================
  Smart Transformer Health Management System - ESP32 Firmware
  ====================================================================
  Hardware Pin Assignments:
    - ZMPT101B AC Voltage Sensor: GPIO 35 (ADC1_CH7)
    - ACS712 AC Current Sensor:   GPIO 34 (ADC1_CH6)
    - DHT22 Temp & Humidity:      GPIO 4
    - Relay D23 (Cooling Fan):    GPIO 23 (Active LOW)
    - Relay D22 (Main Breaker):   GPIO 22 (Active LOW, COM & NC wired)
    - 2-Pin Buzzer Alarm:         GPIO 21 (Longer leg (+) to D21, shorter leg (-) to GND)
    - Status & Alarm LED:         GPIO 2
    - Hardware Reset Button:      GPIO 0  (ESP32 on-board BOOT button)
    - Main Switch Sense:          GPIO 27 (Input Pullup, optional)

  ====================================================================
  2-PIN BUZZER DRIVE (PWM Tone):
  ====================================================================
    * 2-pin buzzers are passive piezo transducers: they require an oscillating
      frequency (tone) to produce sound. Static HIGH produces zero sound.
    * Uses tone(BUZZER_PIN, 2400) for a crisp, loud 2.4 kHz alarm!
    * Emits a brief 200ms startup chirp when ESP32 powers on to confirm wiring.
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
#define VOLTAGE_PIN        35
#define CURRENT_PIN        34
#define DHT_PIN            4
#define DHT_TYPE           DHT22
#define D23_RELAY_PIN      23  // Relay D23 (Cooling Fan)
#define D22_RELAY_PIN      22  // Relay D22 (Main Breaker)
#define BUZZER_PIN         21  // 2-Pin Buzzer on GPIO 21
#define LED_PIN            2   // Status & Alarm LED
#define MAIN_SW_PIN        27
#define BOOT_BTN_PIN       0   // On-board ESP32 BOOT button for manual trip reset

const bool HAS_MAIN_SWITCH = false;

DHT dht(DHT_PIN, DHT_TYPE);

// ====================================================================
// CALIBRATION & SENSOR TUNING
// ====================================================================

// --- Voltage Calibration (ZMPT101B) ---
// Scale = 1.690f | Noise floor = 3.50 mV (transformer OFF reads cleanly 0.00 V AC)
float VOLTS_SCALE            = 1.690f; 
float VOLTAGE_NOISE_FLOOR_MV = 3.50f;

// --- Current Calibration (ACS712) ---
// Scale = 0.01215f (matches multimeter 0.38A, 0.59A, 0.90A, 1.04A, 1.23A)
const float AMPS_PER_COUNT        = 0.01215f; 
const float CURRENT_ZERO_CUTOFF_A = 0.10f; 

// Low-pass filter smoothing coefficients
const float SMOOTH_ALPHA_V = 0.20f; 
const float SMOOTH_ALPHA_I = 0.25f; 

// ---------- Protection Thresholds ----------
const float THRESHOLD_CURRENT_OVERLOAD_A = 1.00f; // Overload cutoff limit
const float THRESHOLD_SHORT_CIRCUIT_A    = 2.20f; // Critical short circuit limit
const float FAN_ON_TEMP                  = 40.0f; // Overheat limit (Fault trigger)
const float FAN_OFF_TEMP                 = 35.0f; // Cooldown limit before reset is allowed
const int   DHT_FAIL_LIMIT               = 5;

// ====================================================================
// 2-PIN BUZZER CONTROLLER (Frequency Tone Generator)
// ====================================================================
void setBuzzer(bool on) {
  if (on) {
    tone(BUZZER_PIN, 2400); // 2.4 kHz piercing alarm tone
  } else {
    noTone(BUZZER_PIN);
    digitalWrite(BUZZER_PIN, LOW);
  }
}

// ====================================================================
// D22 RELAY SWITCHING FIX (Ensures clean switch between NO and NC)
// ====================================================================
void setD22Relay(bool energize) {
  if (energize) {
    // Fault: Energize coil -> COM pulls to NO (NC broken)
    pinMode(D22_RELAY_PIN, OUTPUT);
    digitalWrite(D22_RELAY_PIN, LOW);
  } else {
    // Normal: De-energize coil -> COM snaps to NC!
    pinMode(D22_RELAY_PIN, OUTPUT);
    digitalWrite(D22_RELAY_PIN, HIGH);
    pinMode(D22_RELAY_PIN, INPUT); // High-Z release guarantees COM connects to NC
  }
}

// ====================================================================
// COMPLEMENTARY RELAY CONTROLLER
// Rule: When D23 is ON -> D22 is OFF. When D23 is OFF -> D22 is ON.
// ====================================================================
void setRelays(bool d23_on) {
  if (d23_on) {
    // Normal: D23 is ON, D22 is OFF (switched to NC)
    digitalWrite(D23_RELAY_PIN, LOW);   // D23 Relay ON  (Active LOW)
    setD22Relay(false);                 // D22 Relay OFF -> COM switches to NC!
  } else {
    // Fault: D23 is OFF, D22 is ON (switched to NO)
    digitalWrite(D23_RELAY_PIN, HIGH);  // D23 Relay OFF (Active LOW)
    setD22Relay(true);                  // D22 Relay ON  -> COM switches to NO!
  }
}

// ---------- System States ----------
bool backendConnected  = false;
bool ledState          = false;
bool connectionTripped = false;
int  localFaultCount   = 0;

float lastValidTemp     = -999.0f;
float lastValidHumidity = -999.0f;
int   dhtFailCount      = 0;

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

// ---------- True AC RMS for Current (ACS712, 50Hz, 100ms window) ----------
float readTrueRms(int pin, float &meanOut) {
  const unsigned long windowUs = 100000;
  unsigned long startUs = micros();
  unsigned long count = 0;
  double sum = 0.0;
  double sumSq = 0.0;

  while ((micros() - startUs) < windowUs) {
    int val = analogRead(pin);
    sum += val;
    sumSq += ((double)val * (double)val);
    count++;
    delayMicroseconds(100);
  }

  if (count == 0) {
    meanOut = 0.0f;
    return 0.0f;
  }

  double mean = sum / (double)count;
  meanOut = (float)mean;
  double variance = (sumSq / (double)count) - (mean * mean);
  if (variance < 0.0) variance = 0.0;
  return (float)sqrt(variance);
}

// ---------- True AC RMS for Voltage (ZMPT101B with Motor EMI Spike Filter) ----------
float readTrueRmsMv(int pin, float &meanMvOut) {
  const unsigned long windowUs = 100000;
  unsigned long startUs = micros();
  unsigned long count = 0;
  double sumMv = 0.0;
  double sumSqMv = 0.0;
  float lastRawMv = 0.0f;
  bool hasLast = false;

  while ((micros() - startUs) < windowUs) {
    int val = analogRead(pin);
    float milliVolts = (val / 4095.0f) * 3300.0f;

    // Slew-rate limiter strips motor brush EMI spikes
    if (hasLast) {
      float dMv = milliVolts - lastRawMv;
      if (dMv > 80.0f) milliVolts = lastRawMv + 80.0f;
      else if (dMv < -80.0f) milliVolts = lastRawMv - 80.0f;
    }
    lastRawMv = milliVolts;
    hasLast = true;

    sumMv += milliVolts;
    sumSqMv += ((double)milliVolts * (double)milliVolts);
    count++;
    delayMicroseconds(100);
  }

  if (count == 0) {
    meanMvOut = 0.0f;
    return 0.0f;
  }

  double meanMv = sumMv / (double)count;
  meanMvOut = (float)meanMv;
  double varianceMv = (sumSqMv / (double)count) - (meanMv * meanMv);
  if (varianceMv < 0.0) varianceMv = 0.0;
  return (float)sqrt(varianceMv);
}

bool adcLooksDisconnected(float meanCounts) {
  return (meanCounts < 100.0f || meanCounts > 3995.0f);
}

bool mvLooksDisconnected(float meanMv) {
  return (meanMv < 100.0f || meanMv > 3200.0f);
}

// ---------- DHT22 Temperature & Humidity Acquisition ----------
void thermalControl() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();

  if (!isnan(t) && !isnan(h) && t > -40.0f && t < 125.0f) {
    lastValidTemp = t;
    lastValidHumidity = h;
    dhtFailCount = 0;
  } else {
    dhtFailCount++;
  }
}

// ---------- Protection Evaluator ----------
void evaluateProtection(float volts, float amps, float temp, bool vOk, bool iOk, bool hasTemp) {
  int faults = 0;
  bool isOverload = false;
  bool isOverheat = false;
  bool isShortCircuit = false;

  // 1. Current Overload (> 1.0 A)
  if (iOk && amps > THRESHOLD_CURRENT_OVERLOAD_A) {
    faults++;
    isOverload = true;
    Serial.printf("⚠️ [Fault Detected] Overload: %.2f A > %.1f A\n", amps, THRESHOLD_CURRENT_OVERLOAD_A);
  }

  // 2. Critical Short Circuit (> 2.2 A)
  if (iOk && amps > THRESHOLD_SHORT_CIRCUIT_A) {
    faults += 2;
    isShortCircuit = true;
    Serial.printf("🚨 [Fault Detected] Short Circuit: %.2f A!\n", amps);
  }

  // 3. Overheat (>= 40.0 °C)
  if (hasTemp && temp >= FAN_ON_TEMP) {
    faults++;
    isOverheat = true;
    Serial.printf("🔥 [Fault Detected] Overheat: %.1f C >= %.1f C\n", temp, FAN_ON_TEMP);
  }

  localFaultCount = faults;
  bool activeFaultNow = (isOverload || isShortCircuit || isOverheat);

  // --- STATE 1: ACTIVE FAULT DETECTED ---
  if (activeFaultNow) {
    connectionTripped = true;
    // Rule: When fault comes -> D23 is OFF, D22 is ON (switched to NO), Buzzer tones ON!
    setRelays(false);
    setBuzzer(true);
    Serial.println("⚡ [FAULT TRIP] D23 is OFF | D22 is ON | 2-Pin Buzzer D21 is SOUNDING");
  } 
  // --- STATE 2: NO ACTIVE FAULT ---
  else {
    if (connectionTripped) {
      // Latched trip: remain in tripped state and keep Buzzer sounding until user resets!
      setRelays(false);
      setBuzzer(true);
    } else {
      // Normal state: D23 is ON, D22 is OFF (switched to NC), Buzzer is silent
      setRelays(true);
      setBuzzer(false);
    }
  }
}

// ---------- Circuit Reset Handler ----------
bool attemptResetCircuit(float currentAmps, float currentTemp, bool hasTemp) {
  // Safety Lockout: Cannot reset when fault is actively running or temp >= 35.0°C!
  bool isFaultRunning = (currentAmps > THRESHOLD_CURRENT_OVERLOAD_A) || 
                        (hasTemp && currentTemp >= FAN_OFF_TEMP);

  if (isFaultRunning) {
    Serial.printf("⛔ [Reset Rejected] Fault condition is still active (Cur: %.2fA, Temp: %.1fC)! Cannot restore.\n",
                  currentAmps, currentTemp);
    return false;
  }

  // Fault is gone! Restore normal state: D23 ON, D22 OFF (switches to NC), Buzzer OFF
  connectionTripped = false;
  localFaultCount = 0;
  setBuzzer(false); // Stop buzzer sound!
  setRelays(true);  // Restore relays to Normal
  Serial.println("✅ [CIRCUIT RESTORED] Reset successful! D22 to NC | D23 ON | Buzzer D21 OFF.");
  return true;
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
    Serial.println("\n[Wi-Fi] Timed out, retry will continue in background.");
  }
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=======================================================");
  Serial.println("  Smart Transformer Health Monitor - ESP32 Firmware  ");
  Serial.println("  D22: Main Breaker | D23: Fan | D21: 2-Pin Tone Buzzer");
  Serial.println("=======================================================");

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  pinMode(D23_RELAY_PIN, OUTPUT);

  // 2-Pin Buzzer Setup & Quick Startup Test Chirp (200ms)
  pinMode(BUZZER_PIN, OUTPUT);
  setBuzzer(false);
  tone(BUZZER_PIN, 2400, 200); // 200ms test chirp on boot!
  
  // STARTUP IN NORMAL STATE: D23 is ON, D22 is OFF (COM connected to NC)
  setRelays(true);

  pinMode(BOOT_BTN_PIN, INPUT_PULLUP);
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

  // Read current and temp for instant button evaluation
  float currentAmpsEstimate = iSmooth * AMPS_PER_COUNT;
  bool hasTempData = (lastValidTemp > -900.0f) && (dhtFailCount < DHT_FAIL_LIMIT);

  // Check hardware BOOT button (GPIO 0) for manual trip reset
  if (digitalRead(BOOT_BTN_PIN) == LOW) {
    delay(50); // Debounce
    if (digitalRead(BOOT_BTN_PIN) == LOW && connectionTripped) {
      Serial.println("[Button] Hardware BOOT button pressed -> Checking reset eligibility...");
      attemptResetCircuit(currentAmpsEstimate, lastValidTemp, hasTempData);
      delay(300);
    }
  }

  // Auto-reconnect Wi-Fi
  if (!wifiOk) {
    backendConnected = false;
    if (now - lastReconnectAttempt >= 4000) {
      lastReconnectAttempt = now;
      Serial.println("[Wi-Fi] Reconnecting...");
      WiFi.disconnect();
      WiFi.reconnect();
    }
  }

  // Telemetry loop every 2 seconds
  if (now - previousSendTime >= SEND_INTERVAL) {
    previousSendTime = now;
    thermalControl();

    float vMeanMv = 0.0f;
    float iMeanCounts = 0.0f;

    // 1. Read True RMS values
    float vRawMv  = readTrueRmsMv(VOLTAGE_PIN, vMeanMv);
    float iCounts = readTrueRms(CURRENT_PIN, iMeanCounts);

    bool vOk = !mvLooksDisconnected(vMeanMv);
    bool iOk = !adcLooksDisconnected(iMeanCounts);

    // 2. Smooth raw readings
    if (!vSmoothInit) { vSmooth = vRawMv; vSmoothInit = true; }
    else { vSmooth += SMOOTH_ALPHA_V * (vRawMv - vSmooth); }

    if (!iSmoothInit) { iSmooth = iCounts; iSmoothInit = true; }
    else { iSmooth += SMOOTH_ALPHA_I * (iCounts - iSmooth); }

    // 3. Calculate Voltage (RMS Volts)
    float volts = 0.0f;
    if (vSmooth > VOLTAGE_NOISE_FLOOR_MV) {
      volts = vSmooth * VOLTS_SCALE;
    }

    // 4. Calculate Current (RMS Amperes)
    float amps = iSmooth * AMPS_PER_COUNT;
    if (amps < CURRENT_ZERO_CUTOFF_A) {
      amps = 0.0f;
    }

    bool hasTemp = (lastValidTemp > -900.0f) && (dhtFailCount < DHT_FAIL_LIMIT);
    bool hasHum  = (lastValidHumidity > -900.0f) && (dhtFailCount < DHT_FAIL_LIMIT);
    bool expectedOn = (digitalRead(MAIN_SW_PIN) == LOW);

    // 5. Evaluate protection
    evaluateProtection(volts, amps, lastValidTemp, vOk, iOk, hasTemp);

    // 6. Diagnostics print
    bool isD23On = !connectionTripped;
    Serial.printf("[Sensor Diagnostics]\n");
    Serial.printf("  Voltage -> Raw: %6.2f mV  | Calculated: %5.2f V AC\n", vRawMv, volts);
    Serial.printf("  Current -> Raw: %6.1f cnt | Calculated: %5.2f A AC\n", iCounts, amps);
    Serial.printf("  Climate -> Temp: %4.1f C   | Humidity:   %4.1f %%\n", 
                  hasTemp ? lastValidTemp : 0.0f, hasHum ? lastValidHumidity : 0.0f);
    Serial.printf("  Status  -> D23: %s | D22: %s | Buzzer D21: %s | State: %s\n\n",
                  isD23On ? "ON" : "OFF",
                  connectionTripped ? "ON (NO)" : "OFF (NC)",
                  connectionTripped ? "TONE (ALARM)" : "SILENT",
                  connectionTripped ? "TRIPPED" : "NORMAL");

    // 7. Telemetry transmission to Backend
    if (wifiOk) {
      String p = "{";
      p += "\"voltageCounts\":" + (vOk ? String(vSmooth, 2) : String("null"));
      p += ",\"voltageRms\":" + (vOk ? String(volts, 2) : String("null"));
      p += ",\"currentCounts\":" + (iOk ? String(iSmooth, 2) : String("null"));
      p += ",\"currentRms\":" + (iOk ? String(amps, 2) : String("null"));
      p += ",\"temperatureC\":" + (hasTemp ? String(lastValidTemp, 1) : String("null"));
      p += ",\"humidity\":" + (hasHum ? String(lastValidHumidity, 1) : String("null"));
      p += ",\"fanActive\":" + String(connectionTripped ? "true" : "false");
      p += ",\"connectionClosed\":" + String(connectionTripped ? "true" : "false");
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
        
        // Remote trip command from dashboard
        if (resp.indexOf("\"connectionClosed\":true") >= 0 || resp.indexOf("\"disconnect\":true") >= 0) {
          connectionTripped = true;
          setRelays(false); // D23 OFF, D22 ON
          setBuzzer(true);  // Buzzer ON
        }

        // Remote reset command from dashboard button
        if (resp.indexOf("\"resetCircuit\":true") >= 0) {
          Serial.println("[Dashboard Command] Remote circuit reset requested! Evaluating eligibility...");
          attemptResetCircuit(amps, lastValidTemp, hasTemp);
        }
      }
      http.end();
    }
  }

  // ---------- LED Heartbeat & Alarm ----------
  if (connectionTripped) {
    if (now - previousBlinkTime >= TRIP_BLINK_INTERVAL) {
      previousBlinkTime = now;
      ledState = !ledState;
      digitalWrite(LED_PIN, ledState ? HIGH : LOW);
    }
  } else if (backendConnected) {
    if (now - previousBlinkTime >= BLINK_INTERVAL) {
      previousBlinkTime = now;
      ledState = !ledState;
      digitalWrite(LED_PIN, ledState ? HIGH : LOW);
    }
  } else {
    digitalWrite(LED_PIN, LOW);
  }

  delay(5);
}
