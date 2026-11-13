import { useEffect, useRef, useState } from "react";
import { useTelemetry } from "../context/TelemetryContext";

export default function Transformer3DModel() {
  const canvasRef = useRef(null);
  const { readings, connected, fanActive, faults } = useTelemetry();

  const [rotX, setRotX] = useState(0.42);
  const [rotY, setRotY] = useState(-0.65);
  const [zoom, setZoom] = useState(1.0);
  const [autoRotate, setAutoRotate] = useState(true);
  const [activeTab, setActiveTab] = useState("3d"); // "3d" | "vectors" | "schematic"
  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  const voltage = readings?.voltageRms ?? 12.0;
  const primaryV = readings?.primaryVoltageRms ?? 230.0;
  const current = readings?.currentRms ?? 0.0;
  const temp = readings?.temperatureC ?? 28.0;
  const isOverheated = temp >= 40.0;
  const hasFault = faults.length > 0;

  // Center-tapped secondary voltages:
  // Phase 1 to center tap = Vsec
  // Center tap to Phase 2 = Vsec
  // Across outer leads (12V to 12V) = 2 * Vsec
  const vSecA = voltage;
  const vSecB = voltage;
  const vTotal = voltage * 2.0;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animId;
    let time = 0;

    // Handle high-DPI crisp rendering
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    // Particle system for electromagnetic flux
    const fluxParticles = Array.from({ length: 42 }, () => ({
      pos: Math.random(),
      speed: 0.008 + Math.random() * 0.012,
      track: Math.floor(Math.random() * 4), // top, right, bottom, left limbs
      size: 1.5 + Math.random() * 2,
    }));

    // Heat convection particles
    const heatParticles = Array.from({ length: 24 }, () => ({
      x: (Math.random() - 0.5) * 140,
      y: 30 + Math.random() * 30,
      z: (Math.random() - 0.5) * 80,
      vy: 0.8 + Math.random() * 1.2,
      life: Math.random(),
    }));

    function project(x, y, z, cx, cy) {
      // Rotate around Y
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const x1 = x * cosY - z * sinY;
      const z1 = z * cosY + x * sinY;

      // Rotate around X
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);
      const y2 = y * cosX - z1 * sinX;
      const z2 = z1 * cosX + y * sinX;

      // Perspective projection
      const dist = 480;
      const fov = dist / (dist + z2);
      return {
        x: cx + x1 * fov * zoom,
        y: cy + y2 * fov * zoom,
        z: z2,
        scale: fov * zoom,
      };
    }

    function drawBox(ctx, cx, cy, w, h, d, ox, oy, oz, fillStyle, strokeStyle) {
      const hw = w / 2, hh = h / 2, hd = d / 2;
      const vertices = [
        [-hw, -hh, -hd], [hw, -hh, -hd], [hw, hh, -hd], [-hw, hh, -hd], // front
        [-hw, -hh,  hd], [hw, -hh,  hd], [hw, hh,  hd], [-hw, hh,  hd], // back
      ].map(([x, y, z]) => project(x + ox, y + oy, z + oz, cx, cy));

      const faces = [
        { indices: [0, 1, 2, 3], z: (vertices[0].z + vertices[1].z + vertices[2].z + vertices[3].z) / 4, norm: [0, 0, -1] },
        { indices: [5, 4, 7, 6], z: (vertices[4].z + vertices[5].z + vertices[6].z + vertices[7].z) / 4, norm: [0, 0, 1] },
        { indices: [4, 0, 3, 7], z: (vertices[4].z + vertices[0].z + vertices[3].z + vertices[7].z) / 4, norm: [-1, 0, 0] },
        { indices: [1, 5, 6, 2], z: (vertices[1].z + vertices[5].z + vertices[6].z + vertices[2].z) / 4, norm: [1, 0, 0] },
        { indices: [4, 5, 1, 0], z: (vertices[4].z + vertices[5].z + vertices[1].z + vertices[0].z) / 4, norm: [0, -1, 0] },
        { indices: [3, 2, 6, 7], z: (vertices[3].z + vertices[2].z + vertices[6].z + vertices[7].z) / 4, norm: [0, 1, 0] },
      ];

      // Painter's algorithm
      faces.sort((a, b) => b.z - a.z);

      faces.forEach(face => {
        ctx.beginPath();
        face.indices.forEach((idx, i) => {
          const pt = vertices[idx];
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.closePath();
        ctx.fillStyle = fillStyle;
        ctx.fill();
        if (strokeStyle) {
          ctx.strokeStyle = strokeStyle;
          ctx.stroke();
        }
      });
    }

    function render() {
      time += 0.03;
      if (autoRotate && !isDraggingRef.current) {
        setRotY(prev => prev + 0.005);
      }

      ctx.clearRect(0, 0, rect.width, rect.height);
      const cx = rect.width / 2;
      const cy = rect.height / 2 + 10;

      // Dynamic ambient back glow
      const glowGrad = ctx.createRadialGradient(cx, cy, 20, cx, cy, 240);
      if (hasFault) {
        glowGrad.addColorStop(0, "rgba(239, 68, 68, 0.18)");
        glowGrad.addColorStop(1, "rgba(239, 68, 68, 0)");
      } else if (connected) {
        glowGrad.addColorStop(0, "rgba(14, 165, 233, 0.16)");
        glowGrad.addColorStop(1, "rgba(14, 165, 233, 0)");
      } else {
        glowGrad.addColorStop(0, "rgba(16, 185, 129, 0.15)");
        glowGrad.addColorStop(1, "rgba(16, 185, 129, 0)");
      }
      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, 0, rect.width, rect.height);

      // 1. Transformer Mount Base Bracket (Steel Plate)
      drawBox(ctx, cx, cy, 210, 12, 110, 0, 75, 0, "#2c313a", "#475569");

      // 2. Laminated E-I Silicon Steel Outer Core
      // Left limb
      drawBox(ctx, cx, cy, 32, 130, 85, -82, 0, 0, "#334155", "#475569");
      // Right limb
      drawBox(ctx, cx, cy, 32, 130, 85, 82, 0, 0, "#334155", "#475569");
      // Top yoke
      drawBox(ctx, cx, cy, 196, 26, 85, 0, -52, 0, "#3a4759", "#475569");
      // Bottom yoke
      drawBox(ctx, cx, cy, 196, 26, 85, 0, 52, 0, "#334155", "#475569");

      // Core Lamination Stacking Lines
      for (let l = -38; l <= 38; l += 14) {
        const p1 = project(-98, -65, l, cx, cy);
        const p2 = project(98, -65, l, cx, cy);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = "rgba(15, 23, 42, 0.6)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // 3. Central Bobbin with Copper Windings (Primary 230V + Secondary 12-0-12V)
      // Central steel limb
      drawBox(ctx, cx, cy, 42, 80, 80, 0, 0, 0, "#1e293b", "#334155");

      // Primary Coil (Wrapped in high-gloss copper)
      const copperGrad = isOverheated ? "#c2410c" : "#b45309";
      drawBox(ctx, cx, cy, 78, 42, 92, 0, -18, 0, copperGrad, "#d97706");

      // Secondary Center-Tapped Coil (Yellow insulating tape & copper)
      drawBox(ctx, cx, cy, 78, 42, 92, 0, 18, 0, "#d97706", "#f59e0b");

      // Insulating barrier between primary and secondary
      drawBox(ctx, cx, cy, 82, 6, 96, 0, 0, 0, "#fde047", "#eab308");

      // 4. Primary Input Leads (230V AC) - Left side
      const primP1 = project(-40, -25, -45, cx, cy);
      const primP2 = project(-115, -40, -70, cx, cy);
      const primP3 = project(-115, -15, -70, cx, cy);

      ctx.beginPath();
      ctx.moveTo(primP1.x, primP1.y);
      ctx.bezierCurveTo(primP1.x - 30, primP1.y, primP2.x + 20, primP2.y, primP2.x, primP2.y);
      ctx.strokeStyle = "#ef4444"; // Red (Live 230V)
      ctx.lineWidth = 3.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(primP1.x, primP1.y + 12);
      ctx.bezierCurveTo(primP1.x - 30, primP1.y + 12, primP3.x + 20, primP3.y, primP3.x, primP3.y);
      ctx.strokeStyle = "#0f172a"; // Black (Neutral 230V)
      ctx.lineWidth = 3.5;
      ctx.stroke();

      // 5. Secondary Output Leads (12V - 0 - 12V Center Tap) - Right side
      const secP1 = project(40, 15, -45, cx, cy);
      const secA  = project(125, -5, -60, cx, cy);  // +12V Phase A (Blue)
      const secCT = project(130, 20, -60, cx, cy);  // 0V Center Tap (Black GND)
      const secB  = project(125, 45, -60, cx, cy);  // -12V Phase B (Yellow)

      // Lead 1: +12V Phase
      ctx.beginPath();
      ctx.moveTo(secP1.x, secP1.y - 8);
      ctx.bezierCurveTo(secP1.x + 30, secP1.y - 8, secA.x - 20, secA.y, secA.x, secA.y);
      ctx.strokeStyle = "#38bdf8"; // Light Blue
      ctx.lineWidth = 3;
      ctx.stroke();

      // Lead 2: 0V Center Tap (GND)
      ctx.beginPath();
      ctx.moveTo(secP1.x, secP1.y + 2);
      ctx.bezierCurveTo(secP1.x + 30, secP1.y + 2, secCT.x - 20, secCT.y, secCT.x, secCT.y);
      ctx.strokeStyle = "#0f172a"; // Black Ground
      ctx.lineWidth = 3.5;
      ctx.stroke();

      // Lead 3: -12V Phase
      ctx.beginPath();
      ctx.moveTo(secP1.x, secP1.y + 12);
      ctx.bezierCurveTo(secP1.x + 30, secP1.y + 12, secB.x - 20, secB.y, secB.x, secB.y);
      ctx.strokeStyle = "#facc15"; // Yellow
      ctx.lineWidth = 3;
      ctx.stroke();

      // 6. Magnetic Flux Particle Simulation
      const fluxSpeed = 0.006 + (current > 0 ? Math.min(0.04, current * 0.015) : 0.008);
      fluxParticles.forEach(p => {
        p.pos = (p.pos + fluxSpeed) % 1;
        // Rectangular path around the core limbs
        let px = 0, py = 0;
        const phase = p.pos * 4;
        if (phase < 1) { // Top limb (moving right)
          px = -65 + phase * 130;
          py = -52;
        } else if (phase < 2) { // Right limb (moving down)
          px = 65;
          py = -52 + (phase - 1) * 104;
        } else if (phase < 3) { // Bottom limb (moving left)
          px = 65 - (phase - 2) * 130;
          py = 52;
        } else { // Central limb (moving up)
          px = -65 + (phase - 3) * 65;
          py = 52 - (phase - 3) * 104;
        }

        const pt = project(px, py, 0, cx, cy);
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, p.size * pt.scale, 0, Math.PI * 2);
        ctx.fillStyle = hasFault
          ? "rgba(248, 113, 113, 0.85)"
          : connected
            ? "rgba(56, 189, 248, 0.85)"
            : "rgba(52, 211, 153, 0.85)";
        ctx.shadowColor = hasFault ? "#ef4444" : connected ? "#0ea5e9" : "#10b981";
        ctx.shadowBlur = 6;
        ctx.fill();
        ctx.shadowBlur = 0;
      });

      // 7. Thermal Heat Dissipation Aura
      if (isOverheated) {
        heatParticles.forEach(hp => {
          hp.y -= hp.vy;
          hp.life += 0.02;
          if (hp.y < -90 || hp.life > 1) {
            hp.y = 30;
            hp.life = 0;
            hp.x = (Math.random() - 0.5) * 130;
          }
          const hpPt = project(hp.x, hp.y, hp.z, cx, cy);
          ctx.beginPath();
          ctx.arc(hpPt.x, hpPt.y, (3 + hp.life * 4) * hpPt.scale, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(239, 68, 68, ${0.4 * (1 - hp.life)})`;
          ctx.fill();
        });
      }

      // 8. Cooling Fan Relay Activity Visualizer (Pin D23)
      if (fanActive) {
        const fanCenter = project(120, -50, 40, cx, cy);
        const fanAngle = time * 8;
        ctx.save();
        ctx.translate(fanCenter.x, fanCenter.y);
        ctx.beginPath();
        ctx.arc(0, 0, 24 * fanCenter.scale, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(56, 189, 248, 0.6)";
        ctx.lineWidth = 2;
        ctx.stroke();

        // 4 Spinning blades
        for (let b = 0; b < 4; b++) {
          const ang = fanAngle + (b * Math.PI) / 2;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(Math.cos(ang) * 20 * fanCenter.scale, Math.sin(ang) * 20 * fanCenter.scale);
          ctx.strokeStyle = "#38bdf8";
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        ctx.restore();
      }

      animId = requestAnimationFrame(render);
    }

    render();

    return () => cancelAnimationFrame(animId);
  }, [rotX, rotY, zoom, autoRotate, connected, fanActive, hasFault, voltage, current, temp]);

  // Mouse interaction handlers for 3D rotation
  const handleMouseDown = (e) => {
    isDraggingRef.current = true;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };
    setAutoRotate(false);
  };

  const handleMouseMove = (e) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - lastMouseRef.current.x;
    const dy = e.clientY - lastMouseRef.current.y;
    lastMouseRef.current = { x: e.clientX, y: e.clientY };

    setRotY((prev) => prev + dx * 0.012);
    setRotX((prev) => Math.max(-1.1, Math.min(1.1, prev + dy * 0.012)));
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e) => {
    e.preventDefault();
    setZoom((prev) => Math.max(0.65, Math.min(1.6, prev - e.deltaY * 0.0012)));
  };

  return (
    <div className="transformer-3d-panel">
      <div className="t3d-header">
        <div className="t3d-title-group">
          <span className="t3d-badge">12-0-12 STEP-DOWN</span>
          <h3>Center-Tapped Transformer &amp; Magnetic Core</h3>
        </div>

        <div className="t3d-controls">
          <div className="t3d-tab-bar">
            <button
              className={`t3d-tab ${activeTab === "3d" ? "active" : ""}`}
              onClick={() => setActiveTab("3d")}
            >
              3D Physical Model
            </button>
            <button
              className={`t3d-tab ${activeTab === "vectors" ? "active" : ""}`}
              onClick={() => setActiveTab("vectors")}
            >
              Center-Tap Voltages
            </button>
            <button
              className={`t3d-tab ${activeTab === "schematic" ? "active" : ""}`}
              onClick={() => setActiveTab("schematic")}
            >
              Circuit Wiring
            </button>
          </div>

          <button
            className={`t3d-toggle-btn ${autoRotate ? "active" : ""}`}
            onClick={() => setAutoRotate(!autoRotate)}
            title="Toggle 3D Auto-Rotation"
          >
            {autoRotate ? "⏸ Pause Spin" : "▶ Auto-Spin"}
          </button>
          <button
            className="t3d-reset-btn"
            onClick={() => {
              setRotX(0.42);
              setRotY(-0.65);
              setZoom(1.0);
            }}
            title="Reset Camera View"
          >
            ⟲ Reset
          </button>
        </div>
      </div>

      <div className="t3d-body">
        {activeTab === "3d" && (
          <div className="t3d-canvas-wrap">
            <canvas
              ref={canvasRef}
              className="t3d-canvas"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onWheel={handleWheel}
            />

            <div className="t3d-canvas-overlay">
              <div className="t3d-pin-hud left">
                <div className="t3d-pin-chip red">
                  <span className="dot" />
                  <strong>Primary (230V AC)</strong>
                  <span>{primaryV.toFixed(0)} V RMS</span>
                </div>
                <span className="t3d-pin-hint">E-I Laminated Silicon Core</span>
              </div>

              <div className="t3d-pin-hud right">
                <div className="t3d-pin-chip blue">
                  <span className="dot" />
                  <strong>+12V Phase A</strong>
                  <span>{vSecA.toFixed(1)} V</span>
                </div>
                <div className="t3d-pin-chip black">
                  <span className="dot" />
                  <strong>0V Center Tap</strong>
                  <span>0.0 V (GND)</span>
                </div>
                <div className="t3d-pin-chip yellow">
                  <span className="dot" />
                  <strong>-12V Phase B</strong>
                  <span>{vSecB.toFixed(1)} V</span>
                </div>
              </div>

              <div className="t3d-bottom-stats">
                <div className="stat-pill">
                  <span className="label">Total Span (12V-12V)</span>
                  <span className="val">{vTotal.toFixed(1)} V AC</span>
                </div>
                <div className="stat-pill">
                  <span className="label">Load Flux</span>
                  <span className="val">{current.toFixed(2)} A</span>
                </div>
                <div className="stat-pill">
                  <span className="label">Core Temp</span>
                  <span className="val" style={{ color: isOverheated ? "#ef4444" : undefined }}>
                    {temp.toFixed(1)} °C
                  </span>
                </div>
                <div className="stat-pill">
                  <span className="label">Cooling Fan D23</span>
                  <span className="val" style={{ color: fanActive ? "var(--accent-primary)" : "#64748b" }}>
                    {fanActive ? "ACTIVE BLOWING" : "STANDBY"}
                  </span>
                </div>
              </div>

              <div className="t3d-drag-hint">
                <span>🖱️ Click &amp; drag to rotate 3D view • Scroll to zoom</span>
              </div>
            </div>
          </div>
        )}

        {activeTab === "vectors" && (
          <div className="t3d-vectors-view">
            <div className="vector-card">
              <h4>Center-Tapped AC Voltage Distribution</h4>
              <p>
                The 12-0-12 center-tapped secondary winding splits the magnetic induction into two symmetrical 180° out-of-phase secondary legs around the zero-voltage center tap (0V GND).
              </p>
              <div className="vector-grid">
                <div className="vector-cell">
                  <span className="v-label">Phase A to Center Tap</span>
                  <span className="v-value">{vSecA.toFixed(1)} V RMS</span>
                  <span className="v-sub">Terminal Blue ↔ Black (0V)</span>
                </div>
                <div className="vector-cell highlight">
                  <span className="v-label">Center Tap Ground</span>
                  <span className="v-value">0.00 V (Ref)</span>
                  <span className="v-sub">Neutral / Common Reference</span>
                </div>
                <div className="vector-cell">
                  <span className="v-label">Phase B to Center Tap</span>
                  <span className="v-value">{vSecB.toFixed(1)} V RMS</span>
                  <span className="v-sub">Terminal Yellow ↔ Black (0V)</span>
                </div>
                <div className="vector-cell total">
                  <span className="v-label">Full Span (Phase A to Phase B)</span>
                  <span className="v-value">{vTotal.toFixed(1)} V RMS</span>
                  <span className="v-sub">Measured Across Extremes ($12\,\text{V} + 12\,\text{V}$)</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "schematic" && (
          <div className="t3d-schematic-view">
            <div className="schematic-diagram">
              <div className="sch-block primary">
                <div className="sch-title">Primary Side</div>
                <div className="sch-wire live">230V Mains Live (Red)</div>
                <div className="sch-coil">Primary Winding (230V AC)</div>
                <div className="sch-wire neutral">230V Mains Neutral (Black)</div>
              </div>

              <div className="sch-core">
                <span>Silicon Steel</span>
                <strong>E-I Core</strong>
                <span>Magnetic Coupling</span>
              </div>

              <div className="sch-block secondary">
                <div className="sch-title">12-0-12 Secondary</div>
                <div className="sch-wire sec-a">+12V AC Output (Blue) → ZMPT101B Pin D35</div>
                <div className="sch-wire sec-ct">0V Center Tap GND (Black)</div>
                <div className="sch-wire sec-b">-12V AC Output (Yellow) → ACS712 Pin D34</div>
              </div>

              <div className="sch-block relay">
                <div className="sch-title">Cooling &amp; Safety</div>
                <div className="sch-wire fan">Cooling Fan Relay → GPIO 23</div>
                <div className="sch-wire dht">DHT22 Ambient Temp → GPIO 4</div>
                <div className="sch-wire led">Status Alarm LED → GPIO 2</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
