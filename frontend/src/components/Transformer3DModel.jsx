import { useEffect, useRef, useState } from "react";
import { useTelemetry } from "../context/TelemetryContext";

export default function Transformer3DModel() {
  const canvasRef = useRef(null);
  const { readings, connected, fanActive, faults, connectionClosed } = useTelemetry();

  const [rotX, setRotX] = useState(0.38);
  const [rotY, setRotY] = useState(-0.62);
  const [zoom, setZoom] = useState(1.0);
  const [autoRotate, setAutoRotate] = useState(true);
  const [viewMode, setViewMode] = useState("realistic"); // "realistic" | "flux" | "thermal" | "schematic"
  const [inspectedPart, setInspectedPart] = useState(null);

  const isDraggingRef = useRef(false);
  const lastMouseRef = useRef({ x: 0, y: 0 });

  const voltage = readings?.voltageRms ?? 12.0;
  const primaryV = readings?.primaryVoltageRms ?? 230.0;
  const current = readings?.currentRms ?? 0.0;
  const temp = readings?.temperatureC ?? 28.0;
  const isOverheated = temp >= 40.0;
  const hasFault = (faults && faults.length > 0) || connectionClosed;

  // Center-tapped secondary voltages
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
    let rect = canvas.getBoundingClientRect();
    let currentW = rect.width > 0 ? rect.width : (canvas.clientWidth || 640);
    let currentH = rect.height > 0 ? rect.height : (canvas.clientHeight || 440);
    canvas.width = currentW * dpr;
    canvas.height = currentH * dpr;
    ctx.scale(dpr, dpr);

    const handleResize = () => {
      if (!canvas) return;
      rect = canvas.getBoundingClientRect();
      currentW = rect.width > 0 ? rect.width : (canvas.clientWidth || 640);
      currentH = rect.height > 0 ? rect.height : (canvas.clientHeight || 440);
      canvas.width = currentW * dpr;
      canvas.height = currentH * dpr;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
    };
    window.addEventListener("resize", handleResize);

    // Particle system for electromagnetic flux streamlines
    const fluxParticles = Array.from({ length: 56 }, () => ({
      pos: Math.random(),
      speed: 0.007 + Math.random() * 0.015,
      track: Math.floor(Math.random() * 4),
      size: 1.2 + Math.random() * 2.2,
      depth: (Math.random() - 0.5) * 60,
    }));

    // Thermal convection smoke particles
    const heatParticles = Array.from({ length: 32 }, () => ({
      x: (Math.random() - 0.5) * 140,
      y: 20 + Math.random() * 40,
      z: (Math.random() - 0.5) * 80,
      vy: 0.7 + Math.random() * 1.3,
      vx: (Math.random() - 0.5) * 0.4,
      life: Math.random(),
      size: 2 + Math.random() * 4,
    }));

    // Airflow particles from cooling fan
    const fanAirflow = Array.from({ length: 24 }, () => ({
      x: 130 + Math.random() * 20,
      y: -50 + (Math.random() - 0.5) * 35,
      z: 40 + (Math.random() - 0.5) * 35,
      vx: 1.5 + Math.random() * 2.5,
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
      const dist = 520;
      const fov = dist / (dist + z2);
      return {
        x: cx + x1 * fov * zoom,
        y: cy + y2 * fov * zoom,
        z: z2,
        scale: fov * zoom,
      };
    }

    // Advanced 3D box renderer with directional lighting & specular highlights
    function drawDetailedBox(ctx, cx, cy, w, h, d, ox, oy, oz, baseColor, edgeColor, options = {}) {
      const hw = w / 2, hh = h / 2, hd = d / 2;
      const vertices = [
        [-hw, -hh, -hd], [hw, -hh, -hd], [hw, hh, -hd], [-hw, hh, -hd], // front (0,1,2,3)
        [-hw, -hh,  hd], [hw, -hh,  hd], [hw, hh,  hd], [-hw, hh,  hd], // back (4,5,6,7)
      ].map(([x, y, z]) => project(x + ox, y + oy, z + oz, cx, cy));

      // Light vector from top-right-front
      const lx = 0.45, ly = -0.75, lz = -0.48;

      const faces = [
        { indices: [0, 1, 2, 3], norm: [0, 0, -1] }, // front
        { indices: [5, 4, 7, 6], norm: [0, 0, 1] },  // back
        { indices: [4, 0, 3, 7], norm: [-1, 0, 0] }, // left
        { indices: [1, 5, 6, 2], norm: [1, 0, 0] },  // right
        { indices: [4, 5, 1, 0], norm: [0, -1, 0] }, // top
        { indices: [3, 2, 6, 7], norm: [0, 1, 0] },  // bottom
      ];

      // Calculate rotated normals and depth
      const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX), sinX = Math.sin(rotX);

      const sortedFaces = faces.map(face => {
        // Rotate normal vector
        const [nx, ny, nz] = face.norm;
        const nx1 = nx * cosY - nz * sinY;
        const nz1 = nz * cosY + nx * sinY;
        const ny2 = ny * cosX - nz1 * sinX;
        const nz2 = nz1 * cosX + ny * sinX;

        // Diffuse dot product
        const dot = Math.max(0.2, (nx1 * lx + ny2 * ly + nz2 * lz));
        const avgZ = face.indices.reduce((sum, idx) => sum + vertices[idx].z, 0) / 4;

        return {
          ...face,
          diffuse: dot,
          avgZ,
          isVisible: nz2 < 0.25, // backface culling
        };
      }).filter(f => f.isVisible);

      sortedFaces.sort((a, b) => b.avgZ - a.avgZ);

      sortedFaces.forEach(face => {
        ctx.beginPath();
        face.indices.forEach((idx, i) => {
          const pt = vertices[idx];
          if (i === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.closePath();

        // Shaded color calculation
        ctx.fillStyle = shadeColor(baseColor, face.diffuse, options.metal);
        ctx.fill();

        if (edgeColor) {
          ctx.strokeStyle = edgeColor;
          ctx.lineWidth = options.edgeWidth || 1;
          ctx.stroke();
        }
      });
    }

    function shadeColor(hex, factor, isMetal) {
      // Parse hex color
      let r = 70, g = 70, b = 70;
      if (hex.startsWith("#")) {
        const num = parseInt(hex.slice(1), 16);
        r = (num >> 16) & 255;
        g = (num >> 8) & 255;
        b = num & 255;
      }
      const brightness = isMetal ? Math.pow(factor, 0.7) : factor;
      const sr = Math.min(255, Math.floor(r * brightness + (isMetal ? factor * 45 : 0)));
      const sg = Math.min(255, Math.floor(g * brightness + (isMetal ? factor * 35 : 0)));
      const sb = Math.min(255, Math.floor(b * brightness + (isMetal ? factor * 25 : 0)));
      return `rgb(${sr}, ${sg}, ${sb})`;
    }

    function render() {
      time += 0.025;
      if (autoRotate && !isDraggingRef.current) {
        setRotY(prev => prev + 0.004);
      }

      ctx.clearRect(0, 0, currentW, currentH);
      const cx = currentW / 2;
      const cy = currentH / 2 + 15;

      // 1. Ambient Background Glow reflecting active system status
      const glowGrad = ctx.createRadialGradient(cx, cy, 30, cx, cy, 320);
      if (hasFault) {
        glowGrad.addColorStop(0, "rgba(239, 68, 68, 0.22)");
        glowGrad.addColorStop(1, "rgba(239, 68, 68, 0)");
      } else if (connected) {
        glowGrad.addColorStop(0, "rgba(14, 165, 233, 0.2)");
        glowGrad.addColorStop(1, "rgba(14, 165, 233, 0)");
      } else {
        glowGrad.addColorStop(0, "rgba(16, 185, 129, 0.18)");
        glowGrad.addColorStop(1, "rgba(16, 185, 129, 0)");
      }
      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, 0, currentW, currentH);

      // Subtle isometric ground grid
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
      ctx.lineWidth = 1;
      for (let g = -240; g <= 240; g += 40) {
        const p1 = project(g, 90, -240, cx, cy);
        const p2 = project(g, 90, 240, cx, cy);
        ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
        const p3 = project(-240, 90, g, cx, cy);
        const p4 = project(240, 90, g, cx, cy);
        ctx.beginPath(); ctx.moveTo(p3.x, p3.y); ctx.lineTo(p4.x, p4.y); ctx.stroke();
      }
      ctx.restore();

      // 2. Transformer Base Mounting Chassis Frame (Stamped Steel with bolt slots)
      drawDetailedBox(ctx, cx, cy, 230, 14, 124, 0, 80, 0, "#1e293b", "#475569", { metal: true });
      // Left and right mounting feet flanges
      drawDetailedBox(ctx, cx, cy, 28, 6, 134, -114, 84, 0, "#334155", "#64748b", { metal: true });
      drawDetailedBox(ctx, cx, cy, 28, 6, 134, 114, 84, 0, "#334155", "#64748b", { metal: true });

      // Chassis Mounting Bolts (4 Corners)
      const boltCoords = [
        [-114, 81, -50], [-114, 81, 50], [114, 81, -50], [114, 81, 50]
      ];
      boltCoords.forEach(([bx, by, bz]) => {
        const bp = project(bx, by, bz, cx, cy);
        ctx.beginPath();
        ctx.arc(bp.x, bp.y, 4.5 * bp.scale, 0, Math.PI * 2);
        ctx.fillStyle = "#94a3b8";
        ctx.fill();
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      // 3. E-I Silicon Steel Laminated Core Stacks
      const coreBaseColor = viewMode === "thermal" && isOverheated ? "#991b1b" : "#475569";
      const coreEdgeColor = "#64748b";

      // Left Limb
      drawDetailedBox(ctx, cx, cy, 34, 136, 92, -84, 5, 0, coreBaseColor, coreEdgeColor, { metal: true });
      // Right Limb
      drawDetailedBox(ctx, cx, cy, 34, 136, 92, 84, 5, 0, coreBaseColor, coreEdgeColor, { metal: true });
      // Top Yoke Stack
      drawDetailedBox(ctx, cx, cy, 202, 28, 92, 0, -50, 0, coreBaseColor, coreEdgeColor, { metal: true });
      // Bottom Yoke Stack
      drawDetailedBox(ctx, cx, cy, 202, 28, 92, 0, 58, 0, coreBaseColor, coreEdgeColor, { metal: true });
      // Central Steel Core Limb (inside bobbin)
      drawDetailedBox(ctx, cx, cy, 44, 82, 88, 0, 4, 0, "#1e293b", "#334155", { metal: true });

      // Lamination Plate Edges (Realistic steel sheet lines)
      ctx.save();
      for (let s = -42; s <= 42; s += 8) {
        const pl1 = project(-101, -64, s, cx, cy);
        const pl2 = project(101, -64, s, cx, cy);
        ctx.beginPath();
        ctx.moveTo(pl1.x, pl1.y);
        ctx.lineTo(pl2.x, pl2.y);
        ctx.strokeStyle = "rgba(15, 23, 42, 0.75)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();

      // Core Corner Thru-Bolts (Hexagonal Nuts holding laminations)
      const coreBolts = [
        [-84, -48, -47], [-84, 56, -47], [84, -48, -47], [84, 56, -47],
        [-84, -48, 47],  [-84, 56, 47],  [84, -48, 47],  [84, 56, 47]
      ];
      coreBolts.forEach(([bx, by, bz]) => {
        const cp = project(bx, by, bz, cx, cy);
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, 4 * cp.scale, 0, Math.PI * 2);
        ctx.fillStyle = "#cbd5e1";
        ctx.fill();
        ctx.strokeStyle = "#1e293b";
        ctx.lineWidth = 1;
        ctx.stroke();
      });

      // 4. Central Bobbin & Coils (Dual Chamber)
      // Bobbin Plastic Spool Ends (Molded Black Phenolic)
      drawDetailedBox(ctx, cx, cy, 84, 8, 102, 0, -34, 0, "#0f172a", "#1e293b");
      drawDetailedBox(ctx, cx, cy, 84, 8, 102, 0, 42, 0, "#0f172a", "#1e293b");

      // Primary Winding (Top Chamber: High Voltage 230V AC Copper)
      const copperTone = isOverheated ? "#c2410c" : "#b45309";
      drawDetailedBox(ctx, cx, cy, 80, 34, 98, 0, -14, 0, copperTone, "#d97706", { metal: true });

      // Copper wire winding ridges on primary
      for (let wr = -28; wr <= 0; wr += 4.5) {
        const w1 = project(-40, wr, -50, cx, cy);
        const w2 = project(40, wr, -50, cx, cy);
        ctx.beginPath();
        ctx.moveTo(w1.x, w1.y);
        ctx.lineTo(w2.x, w2.y);
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Yellow Mylar Insulation Barrier Tape
      drawDetailedBox(ctx, cx, cy, 84, 6, 102, 0, 4, 0, "#eab308", "#ca8a04");

      // Secondary Center-Tapped Winding (Bottom Chamber: 12-0-12V AC)
      drawDetailedBox(ctx, cx, cy, 80, 32, 98, 0, 23, 0, "#d97706", "#f59e0b", { metal: true });

      // Copper wire winding ridges on secondary (thicker gauge wire)
      for (let wr = 10; wr <= 36; wr += 6) {
        const w1 = project(-40, wr, -50, cx, cy);
        const w2 = project(40, wr, -50, cx, cy);
        ctx.beginPath();
        ctx.moveTo(w1.x, w1.y);
        ctx.lineTo(w2.x, w2.y);
        ctx.strokeStyle = "#fde047";
        ctx.lineWidth = 2.2;
        ctx.stroke();
      }

      // Printed Nameplate Tape on Front Face
      const npP = project(0, -14, -50, cx, cy);
      ctx.save();
      ctx.translate(npP.x, npP.y);
      ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
      ctx.fillRect(-38 * npP.scale, -10 * npP.scale, 76 * npP.scale, 20 * npP.scale);
      ctx.strokeStyle = "#eab308";
      ctx.lineWidth = 1;
      ctx.strokeRect(-38 * npP.scale, -10 * npP.scale, 76 * npP.scale, 20 * npP.scale);
      ctx.fillStyle = "#fef08a";
      ctx.font = `bold ${Math.max(7, Math.floor(8 * npP.scale))}px JetBrains Mono, monospace`;
      ctx.textAlign = "center";
      ctx.fillText("12-0-12V CT", 0, 0);
      ctx.font = `${Math.max(6, Math.floor(6.5 * npP.scale))}px JetBrains Mono, monospace`;
      ctx.fillText("230V PRI", 0, 7 * npP.scale);
      ctx.restore();

      // 5. Primary Input Leads (230V AC Live & Neutral) - Left Side
      const primP1 = project(-40, -18, -48, cx, cy);
      const primLiveEnd = project(-135, -35, -60, cx, cy);
      const primNeutEnd = project(-135, -5, -60, cx, cy);

      // Red Wire: 230V Live
      ctx.beginPath();
      ctx.moveTo(primP1.x, primP1.y - 4);
      ctx.bezierCurveTo(primP1.x - 45, primP1.y - 4, primLiveEnd.x + 35, primLiveEnd.y, primLiveEnd.x, primLiveEnd.y);
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 4;
      ctx.stroke();

      // Black Wire: 230V Neutral
      ctx.beginPath();
      ctx.moveTo(primP1.x, primP1.y + 6);
      ctx.bezierCurveTo(primP1.x - 45, primP1.y + 6, primNeutEnd.x + 35, primNeutEnd.y, primNeutEnd.x, primNeutEnd.y);
      ctx.strokeStyle = "#020617";
      ctx.lineWidth = 4;
      ctx.stroke();

      // Brass spade terminals
      [primLiveEnd, primNeutEnd].forEach((end) => {
        ctx.beginPath();
        ctx.arc(end.x, end.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#fbbf24";
        ctx.fill();
        ctx.strokeStyle = "#78350f";
        ctx.stroke();
      });

      // 6. Secondary Output Leads (12-0-12 Center Tap) - Right Side
      const secP1 = project(40, 22, -48, cx, cy);
      const secAEnd  = project(138, 0, -60, cx, cy);   // Phase A (+12V Blue)
      const secCTEnd = project(145, 24, -60, cx, cy);  // Center Tap (0V Black GND)
      const secBEnd  = project(138, 48, -60, cx, cy);  // Phase B (-12V Yellow)

      // Phase A Lead (Blue Wire)
      ctx.beginPath();
      ctx.moveTo(secP1.x, secP1.y - 8);
      ctx.bezierCurveTo(secP1.x + 40, secP1.y - 8, secAEnd.x - 30, secAEnd.y, secAEnd.x, secAEnd.y);
      ctx.strokeStyle = "#0284c7";
      ctx.lineWidth = 3.8;
      ctx.stroke();

      // Center-Tap Lead (Black Ground Wire with Ring Lug)
      ctx.beginPath();
      ctx.moveTo(secP1.x, secP1.y);
      ctx.bezierCurveTo(secP1.x + 40, secP1.y, secCTEnd.x - 30, secCTEnd.y, secCTEnd.x, secCTEnd.y);
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 4.2;
      ctx.stroke();

      // Phase B Lead (Yellow Wire)
      ctx.beginPath();
      ctx.moveTo(secP1.x, secP1.y + 8);
      ctx.bezierCurveTo(secP1.x + 40, secP1.y + 8, secBEnd.x - 30, secBEnd.y, secBEnd.x, secBEnd.y);
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 3.8;
      ctx.stroke();

      // Eyelet lugs on secondary terminals
      [secAEnd, secCTEnd, secBEnd].forEach((end) => {
        ctx.beginPath();
        ctx.arc(end.x, end.y, 4.5, 0, Math.PI * 2);
        ctx.fillStyle = "#fde047";
        ctx.fill();
        ctx.strokeStyle = "#92400e";
        ctx.stroke();
      });

      // 7. Electromagnetic Flux Loop Simulation (View mode: realistic or flux)
      if (viewMode === "realistic" || viewMode === "flux") {
        const fluxSpeed = 0.008 + (current > 0 ? Math.min(0.045, current * 0.02) : 0.01);
        fluxParticles.forEach(p => {
          p.pos = (p.pos + fluxSpeed) % 1;
          let px = 0, py = 0;
          const phase = p.pos * 4;
          if (phase < 1) { // Top limb -> right
            px = -66 + phase * 132;
            py = -50;
          } else if (phase < 2) { // Right limb -> down
            px = 66;
            py = -50 + (phase - 1) * 108;
          } else if (phase < 3) { // Bottom limb -> left
            px = 66 - (phase - 2) * 132;
            py = 58;
          } else { // Center limb -> up through coils
            px = -66 + (phase - 3) * 66;
            py = 58 - (phase - 3) * 108;
          }

          const pt = project(px, py, p.depth, cx, cy);
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, p.size * pt.scale, 0, Math.PI * 2);
          ctx.fillStyle = hasFault
            ? "rgba(248, 113, 113, 0.9)"
            : connected
              ? "rgba(56, 189, 248, 0.9)"
              : "rgba(52, 211, 153, 0.9)";
          ctx.shadowColor = hasFault ? "#ef4444" : connected ? "#0ea5e9" : "#10b981";
          ctx.shadowBlur = 8;
          ctx.fill();
          ctx.shadowBlur = 0;
        });
      }

      // 8. Thermal Convection Smoke (when overheated >= 40°C)
      if (isOverheated || viewMode === "thermal") {
        heatParticles.forEach(hp => {
          hp.y -= hp.vy;
          hp.x += hp.vx;
          hp.life += 0.018;
          if (hp.y < -100 || hp.life > 1) {
            hp.y = 20;
            hp.life = 0;
            hp.x = (Math.random() - 0.5) * 140;
          }
          const hpPt = project(hp.x, hp.y, hp.z, cx, cy);
          ctx.beginPath();
          ctx.arc(hpPt.x, hpPt.y, hp.size * (1 + hp.life * 2) * hpPt.scale, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(239, 68, 68, ${0.45 * (1 - hp.life)})`;
          ctx.fill();
        });
      }

      // 9. Relay D23 Industrial Cooling Fan Visualizer (Mounted on right bracket)
      const fanBasePt = project(124, -42, 35, cx, cy);
      // Fan Shroud Bracket
      drawDetailedBox(ctx, cx, cy, 14, 52, 52, 126, -42, 35, "#1e293b", "#38bdf8", { metal: true });

      // Spinning aerofoil rotor
      const fanAngle = fanActive ? time * 12 : 0;
      ctx.save();
      ctx.translate(fanBasePt.x, fanBasePt.y);
      ctx.beginPath();
      ctx.arc(0, 0, 20 * fanBasePt.scale, 0, Math.PI * 2);
      ctx.strokeStyle = fanActive ? "rgba(56, 189, 248, 0.75)" : "rgba(100, 116, 139, 0.5)";
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // 5 Blade aerofoil assembly
      for (let b = 0; b < 5; b++) {
        const ang = fanAngle + (b * Math.PI * 2) / 5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(Math.cos(ang) * 17 * fanBasePt.scale, Math.sin(ang) * 17 * fanBasePt.scale);
        ctx.strokeStyle = fanActive ? "#38bdf8" : "#94a3b8";
        ctx.lineWidth = 3.5;
        ctx.stroke();
      }

      // Fan center motor hub
      ctx.beginPath();
      ctx.arc(0, 0, 5 * fanBasePt.scale, 0, Math.PI * 2);
      ctx.fillStyle = fanActive ? "#0ea5e9" : "#475569";
      ctx.fill();
      ctx.restore();

      // Airflow stream ribbons when fan is ON
      if (fanActive) {
        fanAirflow.forEach(ap => {
          ap.x += ap.vx;
          ap.life += 0.03;
          if (ap.x > 210 || ap.life > 1) {
            ap.x = 132;
            ap.life = 0;
          }
          const apPt = project(ap.x, ap.y, ap.z, cx, cy);
          ctx.beginPath();
          ctx.arc(apPt.x, apPt.y, 2 * apPt.scale, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(56, 189, 248, ${0.7 * (1 - ap.life)})`;
          ctx.fill();
        });
      }

      animId = requestAnimationFrame(render);
    }

    render();

    return () => {
      window.removeEventListener("resize", handleResize);
      cancelAnimationFrame(animId);
    };
  }, [rotX, rotY, zoom, autoRotate, viewMode, connected, fanActive, hasFault, voltage, current, temp]);

  // Orbit drag controls
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
    setRotX((prev) => Math.max(-1.15, Math.min(1.15, prev + dy * 0.012)));
  };

  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  const handleWheel = (e) => {
    e.preventDefault();
    setZoom((prev) => Math.max(0.65, Math.min(1.65, prev - e.deltaY * 0.0012)));
  };

  return (
    <div className="transformer-3d-card">
      <div className="t3d-top-bar">
        <div className="t3d-branding">
          <span className="t3d-live-chip">
            <span className="dot" />
            12-0-12 DIGITAL TWIN
          </span>
          <h2 className="t3d-title">Step-Down Center-Tapped Transformer</h2>
        </div>

        <div className="t3d-mode-toggles">
          <button
            className={`t3d-mode-btn ${viewMode === "realistic" ? "active" : ""}`}
            onClick={() => setViewMode("realistic")}
          >
            Realistic 3D
          </button>
          <button
            className={`t3d-mode-btn ${viewMode === "flux" ? "active" : ""}`}
            onClick={() => setViewMode("flux")}
          >
            Magnetic Flux
          </button>
          <button
            className={`t3d-mode-btn ${viewMode === "thermal" ? "active" : ""}`}
            onClick={() => setViewMode("thermal")}
          >
            Thermal Heatmap
          </button>
          <button
            className={`t3d-mode-btn ${viewMode === "schematic" ? "active" : ""}`}
            onClick={() => setViewMode("schematic")}
          >
            Vector Wiring
          </button>

          <button
            className={`t3d-action-btn ${autoRotate ? "active" : ""}`}
            onClick={() => setAutoRotate(!autoRotate)}
            title="Toggle Continuous Rotation"
          >
            {autoRotate ? "⏸ Pause" : "▶ Spin"}
          </button>
          <button
            className="t3d-action-btn"
            onClick={() => {
              setRotX(0.38);
              setRotY(-0.62);
              setZoom(1.0);
            }}
            title="Reset Perspective"
          >
            ⟲ Reset
          </button>
        </div>
      </div>

      <div className="t3d-viewport">
        {viewMode !== "schematic" ? (
          <div className="t3d-canvas-container">
            <canvas
              ref={canvasRef}
              className="t3d-webgl-canvas"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onWheel={handleWheel}
            />

            {/* Live Interactive Telemetry Overlays */}
            <div className="t3d-hud-layer">
              {/* Primary 230V Side */}
              <div className="t3d-terminal-hud left">
                <div className="t3d-hud-card primary">
                  <div className="hud-tag">PRIMARY INPUT (230V AC)</div>
                  <div className="hud-val">{primaryV.toFixed(1)} <span className="u">V RMS</span></div>
                  <div className="hud-pins">Red (Live) • Black (Neutral)</div>
                </div>
                <div className="t3d-sensor-chip">
                  <span className="dot zmpt" /> ZMPT101B Voltage Isolation
                </div>
              </div>

              {/* Secondary 12-0-12 Side */}
              <div className="t3d-terminal-hud right">
                <div className="t3d-hud-card secondary">
                  <div className="hud-tag">12-0-12 CENTER-TAPPED SECONDARY</div>
                  <div className="ct-row">
                    <span className="leg">+12V Phase A:</span>
                    <strong>{vSecA.toFixed(2)} V</strong>
                  </div>
                  <div className="ct-row ct">
                    <span className="leg">0V Center Tap:</span>
                    <strong>0.00 V (Ref GND)</strong>
                  </div>
                  <div className="ct-row">
                    <span className="leg">-12V Phase B:</span>
                    <strong>{vSecB.toFixed(2)} V</strong>
                  </div>
                  <div className="ct-total">
                    <span>Full Span (12V-12V):</span>
                    <strong>{vTotal.toFixed(2)} V AC</strong>
                  </div>
                </div>
                <div className="t3d-sensor-chip">
                  <span className="dot acs" /> ACS712 Current Sensor Tap
                </div>
              </div>

              {/* Bottom Quick Bar */}
              <div className="t3d-hud-bottom">
                <div className="hud-pill">
                  <span className="lbl">Core Temp</span>
                  <span className="num" style={{ color: isOverheated ? "var(--accent-red)" : undefined }}>
                    {temp.toFixed(1)} °C
                  </span>
                </div>
                <div className="hud-pill">
                  <span className="lbl">Load Current</span>
                  <span className="num">{current.toFixed(2)} A RMS</span>
                </div>
                <div className="hud-pill">
                  <span className="lbl">Relay Fan (D23)</span>
                  <span className="num" style={{ color: fanActive ? "var(--status-theme-color)" : "#64748b" }}>
                    {fanActive ? "FORCED COOLING ON" : "STANDBY"}
                  </span>
                </div>
                <div className="hud-pill hint">
                  <span>🖱️ Drag to rotate 3D • Scroll to zoom</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="t3d-schematic-wrapper">
            <div className="sch-card">
              <h3>Center-Tapped 12-0-12 Transformer Topology</h3>
              <p>
                The 12-0-12V secondary coil features a central ground tap that produces two balanced 12V AC phase legs with 180° phase shift. Across both outer terminals, the total voltage reaches 24V AC RMS.
              </p>

              <div className="sch-grid-boxes">
                <div className="sch-box">
                  <div className="sch-box-title">Primary Side (230V AC)</div>
                  <div className="sch-row live">Live Phase (Red wire) → 230V Mains</div>
                  <div className="sch-row neutral">Neutral Return (Black wire)</div>
                  <div className="sch-spec">Ratio: 230:12 turns step-down</div>
                </div>

                <div className="sch-box core-box">
                  <div className="sch-box-title">Magnetic Core</div>
                  <div className="sch-row">Silicon Steel E-I Laminations</div>
                  <div className="sch-row">Hysteresis &amp; Eddy current suppression</div>
                  <div className="sch-spec">Class B Varnish Thermal Isolation</div>
                </div>

                <div className="sch-box">
                  <div className="sch-box-title">12-0-12 Secondary Output</div>
                  <div className="sch-row sec-a">+12V Phase A (Blue wire) → Pin D35</div>
                  <div className="sch-row sec-ct">0V Center Tap (Black wire) → System GND</div>
                  <div className="sch-row sec-b">-12V Phase B (Yellow wire) → Pin D34</div>
                  <div className="sch-spec">Total AC Amplitude: 24.0V RMS</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
