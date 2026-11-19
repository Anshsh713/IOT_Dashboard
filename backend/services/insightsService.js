const { THRESHOLDS } = require("../config/constants");

// Statistical checks on recent samples. Not machine learning and not a diagnosis.
const MIN = 60 * 1000;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const std = (a) => {
  const m = mean(a);
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)));
};
const isNum = (x) => typeof x === "number" && Number.isFinite(x);

function linearFit(xs, ys) {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0, sxx = 0, syy = 0;
  for (let k = 0; k < xs.length; k++) {
    sxy += (xs[k] - mx) * (ys[k] - my);
    sxx += (xs[k] - mx) ** 2;
    syy += (ys[k] - my) ** 2;
  }
  return { slope: sxx ? sxy / sxx : 0, r2: sxx && syy ? (sxy * sxy) / (sxx * syy) : 0 };
}

// 1. Heating trend: linear fit of the last 10 minutes of temperature
function heatingInsight(samples, now) {
  const limit = THRESHOLDS.TEMP_OVERHEAT_C;
  const temps = samples.filter((s) => now - s.ts <= 10 * MIN && isNum(s.t));
  const spanMin = temps.length ? (temps[temps.length - 1].ts - temps[0].ts) / MIN : 0;
  const base = { id: "heating", title: "Heating trend" };

  if (temps.length < 20 || spanMin < 3) {
    return { ...base, status: "collecting", message: `Collecting temperature data (${spanMin.toFixed(1)} of 3 min needed).` };
  }
  const current = temps[temps.length - 1].t;
  if (current >= limit) {
    return { ...base, status: "alert", message: `Temperature is already at ${current.toFixed(1)} °C, at or above the ${limit} °C limit.` };
  }
  const { slope, r2 } = linearFit(temps.map((s) => (s.ts - temps[0].ts) / MIN), temps.map((s) => s.t));
  const detail = { slopePerMin: Number(slope.toFixed(3)), fitQuality: Number(r2.toFixed(2)) };

  if (slope > 0.05 && r2 > 0.5) {
    const eta = (limit - current) / slope;
    return {
      ...base,
      status: eta < 15 ? "warning" : "info",
      message: `Rising about ${slope.toFixed(2)} °C/min. If this trend continues it reaches ${limit} °C in roughly ${Math.round(eta)} min.`,
      confidence: Number(r2.toFixed(2)),
      detail
    };
  }
  return { ...base, status: "ok", message: `Temperature is steady (${current.toFixed(1)} °C, ${slope >= 0 ? "+" : ""}${slope.toFixed(2)} °C/min).`, detail };
}

// 2. Stability: large swings in voltage/current while energized can come from a loose contact.
// The 25% and 8% limits are starting values: tune them from your staged "loose connection" tests.
function stabilityInsight(samples, now) {
  const base = { id: "stability", title: "Signal stability" };
  const win = samples.filter(
    (s) => now - s.ts <= MIN && isNum(s.v) && isNum(s.i) && s.v >= THRESHOLDS.VOLTAGE_ENERGIZED_MIN_V
  );
  if (win.length < 15) {
    return { ...base, status: "collecting", unstable: false, message: "Needs about 15 energized samples (transformer on)." };
  }
  const vs = win.map((s) => s.v);
  const is = win.map((s) => s.i);
  const vCv = std(vs) / mean(vs);
  const iCv = mean(is) > 0.1 ? std(is) / mean(is) : 0;
  const detail = { voltageVariation: Number((vCv * 100).toFixed(1)), currentVariation: Number((iCv * 100).toFixed(1)) };
  if (iCv > 0.25 || vCv > 0.08) {
    return {
      ...base,
      status: "warning",
      unstable: true,
      message: `Readings fluctuate (voltage ${detail.voltageVariation}%, current ${detail.currentVariation}% variation). A loose connection or failing contact can cause this.`,
      detail
    };
  }
  return { ...base, status: "ok", unstable: false, message: "Voltage and current are steady.", detail };
}

// 3. Health index: a transparent penalty formula over the last 10 minutes (weights are illustrative)
function healthIndex(samples, now, unstable) {
  const win = samples.filter((s) => now - s.ts <= 10 * MIN);
  if (win.length < 5) return { score: null, label: "Collecting data", breakdown: [] };

  const energized = win.filter((s) => isNum(s.v) && s.v >= THRESHOLDS.VOLTAGE_ENERGIZED_MIN_V);
  const lastTemp = [...win].reverse().find((s) => isNum(s.t));
  const share = (fn) => (energized.length ? energized.filter(fn).length / energized.length : 0);

  const thermal = lastTemp ? clamp((lastTemp.t - 30) / (THRESHOLDS.TEMP_OVERHEAT_C - 30), 0, 1) * 35 : 0;
  const overload = share((s) => isNum(s.i) && s.i > THRESHOLDS.CURRENT_OVERLOAD_A) * 45;
  const stability = unstable ? 20 : 0;

  const score = Math.round(100 - (thermal + overload + stability));
  const label = score >= 90 ? "Good" : score >= 70 ? "Fair" : score >= 50 ? "Needs attention" : "Service advised";
  return {
    score,
    label,
    breakdown: [
      { name: "Temperature", penalty: Math.round(thermal), max: 35 },
      { name: "Current Overload", penalty: Math.round(overload), max: 45 },
      { name: "Instability", penalty: stability, max: 20 }
    ]
  };
}

function computeInsights(samples, now = Date.now()) {
  const heating = heatingInsight(samples, now);
  const stability = stabilityInsight(samples, now);
  return {
    generatedAt: now,
    sampleCount: samples.length,
    insights: [heating, stability].map(({ unstable, ...rest }) => rest),
    health: healthIndex(samples, now, stability.unstable === true)
  };
}

module.exports = { computeInsights };
