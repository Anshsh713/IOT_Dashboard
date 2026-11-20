import { useEffect, useRef, useState } from "react";
import { useTelemetry } from "../context/TelemetryContext";

/* ==========================================================================
   Small math helpers
   ========================================================================== */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [
  lerp(c1[0], c2[0], t),
  lerp(c1[1], c2[1], t),
  lerp(c1[2], c2[2], t),
];
const rgbStr = (c, a = 1) => {
  const r = clamp(c[0], 0, 255) | 0;
  const g = clamp(c[1], 0, 255) | 0;
  const b = clamp(c[2], 0, 255) | 0;
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
};

// Thermal colour ramp (25 °C -> 55 °C)
const HEAT = [
  [0, [37, 99, 235]],
  [0.25, [8, 189, 214]],
  [0.5, [34, 197, 94]],
  [0.72, [250, 204, 21]],
  [0.88, [249, 115, 22]],
  [1, [239, 68, 68]],
];
const heatRgb = (t) => {
  const k = clamp((t - 25) / 30, 0, 1);
  for (let i = 1; i < HEAT.length; i++) {
    if (k <= HEAT[i][0]) {
      const [k0, c0] = HEAT[i - 1];
      const [k1, c1] = HEAT[i];
      return mix(c0, c1, (k - k0) / (k1 - k0));
    }
  }
  return HEAT[HEAT.length - 1][1];
};

// 2D outlines (x, z) used to extrude prisms
const ringN = (r, n, rot = 0) =>
  Array.from({ length: n }, (_, i) => {
    const a = rot + (i / n) * Math.PI * 2;
    return [r * Math.cos(a), r * Math.sin(a)];
  });

const ringRR = (hw, hd, r, k) => {
  const pts = [];
  const corners = [
    [hw - r, hd - r, 0],
    [-(hw - r), hd - r, Math.PI / 2],
    [-(hw - r), -(hd - r), Math.PI],
    [hw - r, -(hd - r), Math.PI * 1.5],
  ];
  corners.forEach(([cx, cz, a0]) => {
    for (let i = 0; i <= k; i++) {
      const a = a0 + (i / k) * (Math.PI / 2);
      pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
    }
  });
  return pts;
};

const bez = (p0, p1, p2, p3, n = 18) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return [0, 1, 2].map(
      (k) =>
        u * u * u * p0[k] +
        3 * u * u * t * p1[k] +
        3 * u * t * t * p2[k] +
        t * t * t * p3[k],
    );
  });

const pointInPoly = (x, y, pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0],
      yi = pts[i][1],
      xj = pts[j][0],
      yj = pts[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};

// Flux loops through the E-I core (centre limb splits into two return paths)
const FLUX_LOOPS = [
  [
    [0, 58],
    [0, -58],
    [-85, -58],
    [-85, 58],
  ],
  [
    [0, 58],
    [0, -58],
    [85, -58],
    [85, 58],
  ],
];
const loopPoint = (loop, t) => {
  const n = loop.length;
  const lens = loop.map((p, i) => {
    const q = loop[(i + 1) % n];
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
  const total = lens.reduce((a, b) => a + b, 0);
  let d = (((t % 1) + 1) % 1) * total;
  for (let i = 0; i < n; i++) {
    if (d <= lens[i]) {
      const p = loop[i],
        q = loop[(i + 1) % n];
      const k = d / lens[i];
      return [lerp(p[0], q[0], k), lerp(p[1], q[1], k)];
    }
    d -= lens[i];
  }
  return loop[0];
};

/* ==========================================================================
   Component
   ========================================================================== */
export default function Transformer3DModel() {
  const canvasRef = useRef(null);
  const { readings, connected, fanActive, faults, connectionClosed } =
    useTelemetry();

  const [autoRotate, setAutoRotate] = useState(true);
  const [viewMode, setViewMode] = useState("realistic"); // "realistic" | "flux" | "thermal" | "schematic"
  const [inspectedPart, setInspectedPart] = useState(null);

  // Camera lives in a ref so orbiting never re-creates the render loop
  const viewRef = useRef({ rotX: 0.38, rotY: -0.62, zoom: 1.0 });

  const voltage = readings?.voltageRms ?? 12.0;
  const primaryV = readings?.primaryVoltageRms ?? 230.0;
  const current = readings?.currentRms ?? 0.0;
  const temp = readings?.temperatureC ?? 28.0;
  const isOverheated = temp >= 40.0;
  const hasFault = (faults && faults.length > 0) || !!connectionClosed;

  const vSecA = voltage;
  const vSecB = voltage;

  // Latest live values, read by the animation loop every frame
  const live = useRef({});
  live.current = {
    viewMode,
    autoRotate,
    connected: !!connected,
    fanActive: !!fanActive,
    hasFault,
    isOverheated,
    current,
    temp,
  };

  const partInfo = {
    core: {
      name: "E-I silicon-steel core",
      text: `Stacked 0.35 mm laminations cut eddy-current loss. Core temperature ${temp.toFixed(1)} °C.`,
    },
    primary: {
      name: "Primary winding (230 V)",
      text: `Fine enamelled copper, ~19:1 step-down ratio. Input ${primaryV.toFixed(1)} V RMS.`,
    },
    secondary: {
      name: "Secondary winding (12-0-12 V)",
      text: `Heavier gauge, centre-tapped. Each half ${vSecA.toFixed(2)} V, load ${current.toFixed(2)} A.`,
    },
    bobbin: {
      name: "Bobbin and Mylar barrier",
      text: "Phenolic flanges hold the coils; the yellow Mylar tape insulates primary from secondary.",
    },
    frame: {
      name: "Clamp frame and through-bolts",
      text: "Steel channels and zinc-plated bolts preload the stack so the laminations do not buzz.",
    },
    chassis: {
      name: "Chassis plate",
      text: "Stamped steel base with four M5 mounting bolts.",
    },
    terminals: {
      name: "Screw terminal blocks",
      text: "Left: primary L / N. Right: secondary A (D35), CT (GND), B (D34). Sensor taps: ZMPT101B and ACS712.",
    },
    fan: {
      name: "Cooling fan (relay D23)",
      text: fanActive
        ? "Forced cooling is running. The relay switches on above the temperature threshold."
        : "Standby. The relay switches the fan on when the core runs hot.",
    },
  };

  /* ------------------------------------------------------------------------
     Render loop: a small software 3D engine (depth-sorted polygon soup)
     ------------------------------------------------------------------------ */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    let animId;
    let W = 640,
      H = 520,
      dpr = 1;
    let cx = 0,
      cy = 0;
    let time = 0;
    let fanAngle = 0,
      fanSpeed = 0;

    let cam = null;
    let lv = live.current;
    let ghost = false,
      thermal = false;
    let partTemp = {};
    let hover = null;
    const items = [];
    let hits = [];

    const fit = () => {
      const r = canvas.getBoundingClientRect();
      W = r.width || canvas.clientWidth || 640;
      H = r.height || canvas.clientHeight || 520;
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);

    /* ---------- particles ---------- */
    const fluxParticles = Array.from({ length: 64 }, (_, i) => ({
      loop: i % 2,
      t: Math.random(),
      speed: 0.8 + Math.random() * 0.5,
      side: Math.random() < 0.5 ? -1 : 1,
      zIn: (Math.random() - 0.5) * 66,
      size: 1.4 + Math.random() * 1.8,
    }));
    const heatParticles = Array.from({ length: 30 }, () => ({
      x: (Math.random() - 0.5) * 150,
      y: -76 - Math.random() * 30,
      z: (Math.random() - 0.5) * 70,
      vy: 0.5 + Math.random() * 0.9,
      vx: (Math.random() - 0.5) * 0.3,
      life: Math.random(),
      size: 4 + Math.random() * 5,
    }));
    const airflow = Array.from({ length: 34 }, () => ({
      x: 132 - Math.random() * 260,
      y: 43 + (Math.random() - 0.5) * 42,
      z: (Math.random() - 0.5) * 42,
      vx: 2 + Math.random() * 1.6,
      life: Math.random(),
    }));

    /* ---------- camera ---------- */
    const makeCam = (v, zoom) => {
      const cY = Math.cos(v.rotY),
        sY = Math.sin(v.rotY);
      const cX = Math.cos(v.rotX),
        sX = Math.sin(v.rotX);
      const dist = 560;
      return {
        dist,
        view: (p) => {
          const x1 = p[0] * cY - p[2] * sY;
          const z1 = p[2] * cY + p[0] * sY;
          return [x1, p[1] * cX - z1 * sX, z1 * cX + p[1] * sX];
        },
        proj: (v3) => {
          const f = (dist / (dist + v3[2])) * zoom;
          return [cx + v3[0] * f, cy + v3[1] * f, f];
        },
      };
    };
    const P = (p) => cam.proj(cam.view(p));

    /* ---------- lighting ---------- */
    const L1 = norm([-0.35, -0.8, -0.5]);
    const L2 = norm([0.75, 0.35, -0.35]);
    const H1 = norm([L1[0], L1[1], L1[2] - 1]);
    const shade = (rgb, n, metal) => {
      const d1 = Math.max(0, dot(n, L1));
      const d2 = Math.max(0, dot(n, L2));
      const lum = 0.26 + 0.8 * d1 + 0.16 * d2;
      const sp =
        Math.pow(Math.max(0, dot(n, H1)), metal ? 26 : 48) *
        (metal ? 0.55 : 0.12);
      return [
        rgb[0] * lum + sp * 255,
        rgb[1] * lum + sp * 255,
        rgb[2] * lum + sp * 255,
      ];
    };

    /* ---------- primitives ---------- */
    function addPoly(world, nrm, rgb, o = {}) {
      const vs = world.map((p) => cam.view(p));
      let mx = 0,
        my = 0,
        mz = 0;
      for (const v of vs) {
        mx += v[0];
        my += v[1];
        mz += v[2];
      }
      const k = vs.length;
      mx /= k;
      my /= k;
      mz /= k;

      let n = nrm
        ? cam.view(nrm)
        : norm(cross(sub(vs[1], vs[0]), sub(vs[2], vs[0])));
      const facing = -n[0] * mx - n[1] * my - n[2] * (mz + cam.dist);
      if (facing <= 0) {
        if (!o.two) return;
        n = [-n[0], -n[1], -n[2]];
      }

      const pts = vs.map((v) => cam.proj(v));
      let fill;
      let alpha = false;
      if (o.raw) {
        fill = o.raw;
      } else {
        let base = rgb;
        if (thermal && o.part && partTemp[o.part] !== undefined) {
          base = mix(rgb, heatRgb(partTemp[o.part]), 0.88);
        }
        if (hover && o.part === hover) base = mix(base, [120, 230, 255], 0.3);
        alpha = ghost && !!o.ghost;
        fill = rgbStr(shade(base, n, o.metal), alpha ? 0.3 : 1);
      }

      const seg = (e) => [cam.proj(cam.view(e[0])), cam.proj(cam.view(e[1]))];
      items.push({
        k: "p",
        z: mz + (o.bias || 0),
        pts,
        fill,
        alpha,
        stroke: o.stroke,
        lw: o.lw,
        edge: o.edge,
        edges: o.edges ? o.edges.map(seg) : null,
        lines: o.lines ? o.lines.map(seg) : null,
        part: o.part,
        nohit: o.nohit,
      });
    }

    // Box with optional tessellation (for better depth sorting) and lamination lines
    function box(x, y, z, w, h, d, rgb, o = {}) {
      const hw = w / 2,
        hh = h / 2,
        hd = d / 2;
      const T = o.tess || 0;
      const faces = [
        [[0, 0, -1], [1, 0, 0], [0, 1, 0], hw, hh, [0, 0, -hd]],
        [[0, 0, 1], [1, 0, 0], [0, 1, 0], hw, hh, [0, 0, hd]],
        [[-1, 0, 0], [0, 0, 1], [0, 1, 0], hd, hh, [-hw, 0, 0]],
        [[1, 0, 0], [0, 0, 1], [0, 1, 0], hd, hh, [hw, 0, 0]],
        [[0, -1, 0], [1, 0, 0], [0, 0, 1], hw, hd, [0, -hh, 0]],
        [[0, 1, 0], [1, 0, 0], [0, 0, 1], hw, hd, [0, hh, 0]],
      ];
      faces.forEach(([n, ua, va, a, b, off]) => {
        const nu = T ? Math.max(1, Math.ceil((2 * a) / T)) : 1;
        const nv = T ? Math.max(1, Math.ceil((2 * b) / T)) : 1;
        const pt = (u, v) => [
          x + off[0] + ua[0] * u + va[0] * v,
          y + off[1] + ua[1] * u + va[1] * v,
          z + off[2] + ua[2] * u + va[2] * v,
        ];
        const zIsU = ua[2] !== 0;
        for (let i = 0; i < nu; i++) {
          for (let j = 0; j < nv; j++) {
            const u0 = -a + (2 * a * i) / nu,
              u1 = -a + (2 * a * (i + 1)) / nu;
            const v0 = -b + (2 * b * j) / nv,
              v1 = -b + (2 * b * (j + 1)) / nv;
            const c = [pt(u0, v0), pt(u1, v0), pt(u1, v1), pt(u0, v1)];
            const edges = [];
            if (j === 0) edges.push([c[0], c[1]]);
            if (i === nu - 1) edges.push([c[1], c[2]]);
            if (j === nv - 1) edges.push([c[2], c[3]]);
            if (i === 0) edges.push([c[3], c[0]]);

            let lines = null;
            if (o.lam && n[2] === 0) {
              lines = [];
              const lo = zIsU ? u0 : v0,
                hi = zIsU ? u1 : v1;
              for (let kk = 1; kk < o.lam; kk++) {
                const zk = -hd + (kk * d) / o.lam;
                if (zk > lo && zk < hi) {
                  lines.push(
                    zIsU ? [pt(zk, v0), pt(zk, v1)] : [pt(u0, zk), pt(u1, zk)],
                  );
                }
              }
            }
            addPoly(c, n, rgb, { ...o, edges, lines });
          }
        }
      });
    }

    // Extrude a 2D ring (x,z) along an axis
    function prism(ring, a0, a1, c, axis, rgb, o = {}) {
      const map = (lx, la, lz) =>
        axis === "y"
          ? [c[0] + lx, c[1] + la, c[2] + lz]
          : axis === "x"
            ? [c[0] + la, c[1] + lx, c[2] + lz]
            : [c[0] + lx, c[1] + lz, c[2] + la];
      const dmap = (lx, la, lz) =>
        axis === "y"
          ? [lx, la, lz]
          : axis === "x"
            ? [la, lx, lz]
            : [lx, lz, la];
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const p = ring[i],
          q = ring[(i + 1) % n];
        const dx = q[0] - p[0],
          dz = q[1] - p[1];
        const len = Math.hypot(dx, dz);
        if (len < 1e-6) continue;
        addPoly(
          [
            map(p[0], a0, p[1]),
            map(q[0], a0, q[1]),
            map(q[0], a1, q[1]),
            map(p[0], a1, p[1]),
          ],
          dmap(dz / len, 0, -dx / len),
          rgb,
          o,
        );
      }
      if (o.capTop)
        addPoly(
          ring.map((p) => map(p[0], a0, p[1])),
          dmap(0, -1, 0),
          rgb,
          { ...o, bias: o.capBias || 0 },
        );
      if (o.capBot)
        addPoly(
          ring.map((p) => map(p[0], a1, p[1])),
          dmap(0, 1, 0),
          rgb,
          { ...o, bias: o.capBias || 0 },
        );
    }

    // Insulated lead wire, drawn as depth-sorted tube segments
    function wire(pts, rgb, width) {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = cam.view(pts[i]),
          b = cam.view(pts[i + 1]);
        items.push({
          k: "l",
          z: (a[2] + b[2]) / 2 - 10,
          a: cam.proj(a),
          b: cam.proj(b),
          w: width,
          c: rgbStr(rgb),
          c2: rgbStr(mix(rgb, [255, 255, 255], 0.35)),
        });
      }
    }

    function glowLine(p, q, color, width) {
      const a = cam.view(p),
        b = cam.view(q);
      items.push({
        k: "l",
        z: (a[2] + b[2]) / 2 - 6,
        a: cam.proj(a),
        b: cam.proj(b),
        w: width,
        c: color,
        c2: null,
      });
    }

    function dotItem(p, r, color, glow, bias = -8) {
      const v = cam.view(p);
      const pr = cam.proj(v);
      items.push({
        k: "d",
        z: v[2] + bias,
        x: pr[0],
        y: pr[1],
        r: r * pr[2],
        c: color,
        glow,
      });
    }

    // Flat label drawn in the plane of a surface
    function decal(center, ux, uy, normal, drawFn, bias = -4) {
      const v = cam.view(center);
      const n = cam.view(normal);
      if (-n[0] * v[0] - n[1] * v[1] - n[2] * (v[2] + cam.dist) <= 0) return;
      const p0 = P(center);
      const pu = P([center[0] + ux[0], center[1] + ux[1], center[2] + ux[2]]);
      const pv = P([center[0] + uy[0], center[1] + uy[1], center[2] + uy[2]]);
      items.push({
        k: "t",
        z: v[2] + bias,
        m: [
          pu[0] - p0[0],
          pu[1] - p0[1],
          pv[0] - p0[0],
          pv[1] - p0[1],
          p0[0],
          p0[1],
        ],
        draw: drawFn,
      });
    }

    /* ---------- scene ---------- */
    function buildScene() {
      const steel = [122, 132, 148];
      const steelDark = [60, 68, 82];
      const zinc = [204, 212, 222];
      const brass = [214, 168, 70];
      const phenolic = [28, 28, 33];
      const mylar = [236, 182, 12];
      const kraft = [168, 134, 86];
      const cuPrimary =
        lv.isOverheated && !thermal ? [206, 92, 22] : [190, 104, 30];

      // ----- Chassis plate + mounting bolts -----
      box(0, 78, 0, 330, 8, 180, [54, 64, 78], {
        part: "chassis",
        metal: true,
        tess: 60,
        edge: "rgba(160,174,192,0.35)",
      });
      [
        [-150, -72],
        [-150, 72],
        [150, -72],
        [150, 72],
      ].forEach(([bx, bz]) => {
        prism(ringN(8, 10), 73.2, 74, [bx, 0, bz], "y", [30, 36, 46], {
          part: "chassis",
          metal: true,
        });
        prism(ringN(6.2, 6), 69.8, 73.2, [bx, 0, bz], "y", zinc, {
          part: "chassis",
          metal: true,
          capTop: true,
        });
      });

      // ----- Core clamp channels -----
      box(0, 72, 0, 208, 4, 92, [74, 84, 98], {
        part: "frame",
        metal: true,
        tess: 70,
        edge: "rgba(200,210,225,0.3)",
      });
      box(0, -72, 0, 208, 4, 92, [74, 84, 98], {
        part: "frame",
        metal: true,
        tess: 70,
        edge: "rgba(200,210,225,0.3)",
      });

      // ----- E-I laminated core -----
      const core = {
        part: "core",
        metal: true,
        ghost: true,
        tess: 60,
        lam: 26,
        edge: "rgba(210,220,235,0.22)",
      };
      box(0, -58, 0, 200, 24, 80, steel, core);
      box(0, 58, 0, 200, 24, 80, steel, core);
      box(-85, 0, 0, 30, 92, 80, steel, core);
      box(85, 0, 0, 30, 92, 80, steel, core);
      if (ghost) box(0, 0, 0, 60, 92, 80, steel, core); // centre limb (hidden by the coil otherwise)

      // ----- Through-bolts with washers and hex nuts (both ends) -----
      [
        [-85, -58],
        [85, -58],
        [-85, 58],
        [85, 58],
      ].forEach(([bx, by]) => {
        [-1, 1].forEach((s) => {
          const z0 = s * 40,
            z1 = s * 41.2,
            z2 = s * 47;
          const a0 = Math.min(z0, z1),
            a1 = Math.max(z0, z1);
          prism(ringN(7.6, 14), a0, a1, [bx, by, 0], "z", zinc, {
            part: "frame",
            metal: true,
            capTop: s > 0 ? false : true,
            capBot: s > 0,
          });
          const b0 = Math.min(z1, z2),
            b1 = Math.max(z1, z2);
          prism(ringN(5.6, 6, 0.3), b0, b1, [bx, by, 0], "z", [168, 176, 188], {
            part: "frame",
            metal: true,
            capTop: s < 0,
            capBot: s > 0,
          });
        });
      });

      // ----- Coil former, windings and insulation -----
      const HW = 64,
        HD = 56,
        R = 16;
      const ring = ringRR(HW, HD, R, 4);
      const flangeRing = ringRR(HW + 3, HD + 3, R + 3, 4);
      const mylarRing = ringRR(HW + 1.5, HD + 1.5, R + 1.5, 4);

      const bandsOf = (y0, spec, part) => {
        let y = y0;
        spec.forEach(([h, rgb, metal]) => {
          prism(ring, y, y + h, [0, 0, 0], "y", rgb, {
            part,
            metal,
            ghost: true,
            stroke: "rgba(0,0,0,0.22)",
            lw: 0.6,
          });
          y += h;
        });
      };

      // bobbin flanges (caps are drawn behind everything to avoid sort artefacts)
      prism(flangeRing, -45, -43, [0, 0, 0], "y", phenolic, {
        part: "bobbin",
        ghost: true,
        capTop: true,
        capBias: 90,
      });
      prism(flangeRing, 43, 45, [0, 0, 0], "y", phenolic, {
        part: "bobbin",
        ghost: true,
        capBot: true,
        capBias: 90,
      });
      // mylar interwinding barrier
      prism(mylarRing, -3, 3, [0, 0, 0], "y", mylar, {
        part: "bobbin",
        ghost: true,
        stroke: "rgba(120,80,0,0.4)",
        lw: 0.7,
      });

      // primary: kraft edge, fine copper turns, kraft edge
      const pBands = [[3, kraft, false]];
      for (let i = 0; i < 10; i++)
        pBands.push([
          3.4,
          i % 2 ? mix(cuPrimary, [0, 0, 0], 0.14) : cuPrimary,
          true,
        ]);
      pBands.push([3, kraft, false]);
      bandsOf(-43, pBands, "primary");

      // secondary: heavier gauge
      const cuSec = [224, 146, 44];
      const sBands = [[2.5, kraft, false]];
      for (let i = 0; i < 7; i++)
        sBands.push([5, i % 2 ? mix(cuSec, [0, 0, 0], 0.12) : cuSec, true]);
      sBands.push([2.5, kraft, false]);
      bandsOf(3, sBands, "secondary");

      // nameplate on the front of the primary coil
      decal([0, -22, -56.8], [1, 0, 0], [0, 1, 0], [0, 0, -1], (c) => {
        c.fillStyle = "rgba(10,14,22,0.92)";
        c.fillRect(-30, -10, 60, 20);
        c.strokeStyle = "#eab308";
        c.lineWidth = 0.8;
        c.strokeRect(-30, -10, 60, 20);
        c.fillStyle = "#fef08a";
        c.textAlign = "center";
        c.textBaseline = "middle";
        c.font = "700 6.4px 'JetBrains Mono', monospace";
        c.fillText("12-0-12V  CT", 0, -3.2);
        c.font = "500 4.4px 'JetBrains Mono', monospace";
        c.fillStyle = "#fde68a";
        c.fillText("230V PRI  50Hz", 0, 3.4);
        c.fillText(`${(24 * 1.5).toFixed(0)}VA  CLASS B`, 0, 7.6);
      });

      // ----- Terminal blocks -----
      const blockRGB = [30, 32, 38];
      box(-96, 67.5, -68, 52, 13, 20, blockRGB, {
        part: "terminals",
        tess: 60,
        edge: "rgba(255,255,255,0.12)",
      });
      box(96, 67.5, -68, 76, 13, 20, blockRGB, {
        part: "terminals",
        tess: 60,
        edge: "rgba(255,255,255,0.12)",
      });
      const primT = [-108, -84];
      const secT = [76, 96, 116];
      [...primT, ...secT].forEach((tx) => {
        prism(ringN(4.2, 10), 57, 61, [tx, 0, -68], "y", brass, {
          part: "terminals",
          metal: true,
          capTop: true,
        });
        prism(ringN(6, 14), 55.2, 57, [tx, 0, -68], "y", [230, 205, 120], {
          part: "terminals",
          metal: true,
          capTop: true,
        });
        prism(ringN(3.2, 6), 52.8, 55.2, [tx, 0, -68], "y", brass, {
          part: "terminals",
          metal: true,
          capTop: true,
        });
      });
      const label = (x, txt) =>
        decal([x, 67.5, -78.3], [1, 0, 0], [0, 1, 0], [0, 0, -1], (c) => {
          c.fillStyle = "#e2e8f0";
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.font = "700 5.2px 'JetBrains Mono', monospace";
          c.fillText(txt, 0, 0);
        });
      label(-108, "L");
      label(-84, "N");
      label(76, "A");
      label(96, "CT");
      label(116, "B");

      // ----- Lead wires (3D Bezier curves) -----
      const lead = (p0, p1, p2, p3, rgb, w) =>
        wire(bez(p0, p1, p2, p3), rgb, w);
      lead(
        [-64, -30, -34],
        [-96, -36, -54],
        [-114, 8, -72],
        [-108, 55.5, -68],
        [226, 48, 48],
        3.4,
      );
      lead(
        [-64, -20, -34],
        [-92, -22, -54],
        [-96, 14, -74],
        [-84, 55.5, -68],
        [20, 22, 28],
        3.4,
      );
      lead(
        [64, 8, -34],
        [92, 4, -54],
        [82, 22, -74],
        [76, 55.5, -68],
        [30, 120, 220],
        3.2,
      );
      lead(
        [64, 23, -34],
        [96, 20, -54],
        [100, 30, -74],
        [96, 55.5, -68],
        [24, 26, 32],
        3.4,
      );
      lead(
        [64, 38, -34],
        [102, 38, -54],
        [122, 30, -74],
        [116, 55.5, -68],
        [236, 170, 20],
        3.2,
      );

      // ----- Cooling fan (12 V, relay D23) -----
      const fx = 142,
        fy = 43;
      const active = lv.fanActive;
      const frameRGB = [30, 41, 59];
      const frameO = {
        part: "fan",
        metal: true,
        tess: 40,
        edge: active ? "rgba(56,189,248,0.6)" : "rgba(148,163,184,0.3)",
      };
      box(fx, fy - 27, 0, 16, 6, 60, frameRGB, frameO);
      box(fx, fy + 27, 0, 16, 6, 60, frameRGB, frameO);
      box(fx, fy, -27, 16, 54, 6, frameRGB, frameO);
      box(fx, fy, 27, 16, 54, 6, frameRGB, frameO);
      [-1, 1].forEach((sy) =>
        [-1, 1].forEach((sz) => {
          prism(
            ringN(2.2, 8),
            fx - 8.8,
            fx - 8,
            [0, fy + sy * 24, sz * 24],
            "x",
            zinc,
            { part: "fan", metal: true, capTop: true },
          );
        }),
      );
      // mounting feet
      [-22, 22].forEach((fz) =>
        box(fx, 73, fz, 20, 2, 12, [70, 80, 94], { part: "fan", metal: true }),
      );
      // hub and motor can
      prism(
        ringN(7.5, 14),
        fx - 6,
        fx + 6,
        [0, fy, 0],
        "x",
        active ? [14, 116, 144] : [71, 85, 105],
        { part: "fan", metal: true, capTop: true, capBot: true },
      );
      // blades
      const bladeRGB = active
        ? mix([51, 65, 85], [56, 189, 248], 0.55)
        : [58, 70, 90];
      for (let b = 0; b < 7; b++) {
        const a = fanAngle + (b * Math.PI * 2) / 7;
        const ry = Math.cos(a),
          rz = Math.sin(a),
          ty = -rz,
          tz = ry;
        const Q = (r, t) => [
          fx + 0.5 * t,
          fy + r * ry + t * ty,
          r * rz + t * tz,
        ];
        addPoly(
          [Q(7, -3.2), Q(22, -6.4), Q(22, 3.2), Q(7, 3.2)],
          null,
          bladeRGB,
          {
            part: "fan",
            metal: true,
            two: true,
            edge: "rgba(255,255,255,0.1)",
          },
        );
      }
      if (fanSpeed > 0.22) {
        const disc = ringN(23, 28).map(([u, v]) => [fx - 8.4, fy + u, v]);
        addPoly(disc, [-1, 0, 0], null, {
          raw: `rgba(56,189,248,${Math.min(0.16, fanSpeed * 0.28).toFixed(3)})`,
          two: true,
          bias: -24,
          nohit: true,
        });
      }

      // ----- Particles -----
      const sc = lv.hasFault
        ? [248, 113, 113]
        : lv.connected
          ? [56, 189, 248]
          : [255, 255, 255];
      const fluxMul = 0.0016 + Math.min(0.01, lv.current * 0.004);

      if (!thermal) {
        fluxParticles.forEach((p) => {
          p.t = (p.t + fluxMul * p.speed) % 1;
          const z = ghost ? p.zIn : p.side * 41.6;
          for (let tr = 2; tr >= 0; tr--) {
            const [px, py] = loopPoint(FLUX_LOOPS[p.loop], p.t - tr * 0.012);
            dotItem(
              [px, py, z],
              p.size * (1 - tr * 0.22),
              rgbStr(sc, [1, 0.6, 0.3][tr]),
              tr === 0 ? rgbStr(sc) : null,
              ghost ? -4 : -3,
            );
          }
        });
        if (ghost) {
          FLUX_LOOPS.forEach((lp) => {
            for (let i = 0; i < lp.length; i++) {
              const p = lp[i],
                q = lp[(i + 1) % lp.length];
              glowLine([p[0], p[1], 0], [q[0], q[1], 0], rgbStr(sc, 0.22), 1.4);
            }
          });
        }
      }

      if (thermal || lv.isOverheated) {
        heatParticles.forEach((h) => {
          h.y -= h.vy;
          h.x += h.vx;
          h.life += 0.012;
          if (h.life > 1) {
            h.y = -76;
            h.life = 0;
            h.x = (Math.random() - 0.5) * 150;
          }
          dotItem(
            [h.x, h.y, h.z],
            h.size * (1 + h.life * 1.8),
            `rgba(255,${(120 - h.life * 60) | 0},60,${(0.32 * (1 - h.life)).toFixed(3)})`,
            null,
            -2,
          );
        });
      }

      if (fanSpeed > 0.12) {
        airflow.forEach((a) => {
          a.x -= a.vx * fanSpeed * 2;
          a.life += 0.011;
          if (a.x < -150 || a.life > 1) {
            a.x = fx - 10;
            a.life = 0;
            a.y = fy + (Math.random() - 0.5) * 42;
            a.z = (Math.random() - 0.5) * 42;
          }
          dotItem(
            [a.x, a.y, a.z],
            1.7,
            `rgba(125,211,252,${(0.7 * (1 - a.life) * Math.min(1, fanSpeed * 2.4)).toFixed(3)})`,
            null,
            -6,
          );
        });
      }
    }

    /* ---------- background & overlay ---------- */
    function drawBackground() {
      const rgb = lv.hasFault
        ? "255,77,109"
        : lv.connected
          ? "0,229,255"
          : "255,255,255";
      const g = ctx.createRadialGradient(
        cx,
        cy,
        20,
        cx,
        cy,
        Math.max(W, H) * 0.55,
      );
      g.addColorStop(0, `rgba(${rgb},0.2)`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      for (let g2 = -240; g2 <= 240; g2 += 40) {
        const a = P([g2, 83, -240]),
          b = P([g2, 83, 240]);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.stroke();
        const c = P([-240, 83, g2]),
          d = P([240, 83, g2]);
        ctx.beginPath();
        ctx.moveTo(c[0], c[1]);
        ctx.lineTo(d[0], d[1]);
        ctx.stroke();
      }
      ctx.strokeStyle = `rgba(${rgb},0.4)`;
      ctx.setLineDash([6, 10]);
      ctx.lineDashOffset = -time * 24;
      ctx.beginPath();
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        const p = P([Math.cos(a) * 235, 83, Math.sin(a) * 235]);
        if (i === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
      ctx.restore();
    }

    function drawItems() {
      hits = [];
      for (const it of items) {
        if (it.k === "p") {
          ctx.beginPath();
          it.pts.forEach((p, i) =>
            i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]),
          );
          ctx.closePath();
          ctx.fillStyle = it.fill;
          ctx.fill();
          if (!it.alpha) {
            ctx.strokeStyle = it.stroke || it.fill; // closes anti-alias seams between tiles
            ctx.lineWidth = it.lw || 0.8;
            ctx.lineJoin = "round";
            ctx.stroke();
          }
          if (it.lines && it.lines.length) {
            ctx.strokeStyle = "rgba(8,12,20,0.34)";
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            it.lines.forEach(([a, b]) => {
              ctx.moveTo(a[0], a[1]);
              ctx.lineTo(b[0], b[1]);
            });
            ctx.stroke();
          }
          if (it.edges && it.edges.length && it.edge) {
            ctx.strokeStyle = it.edge;
            ctx.lineWidth = 0.9;
            ctx.beginPath();
            it.edges.forEach(([a, b]) => {
              ctx.moveTo(a[0], a[1]);
              ctx.lineTo(b[0], b[1]);
            });
            ctx.stroke();
          }
          if (it.part && !it.nohit) hits.push(it);
        } else if (it.k === "l") {
          ctx.lineCap = "round";
          ctx.strokeStyle = it.c;
          ctx.lineWidth = Math.max(0.8, it.w * it.a[2]);
          ctx.beginPath();
          ctx.moveTo(it.a[0], it.a[1]);
          ctx.lineTo(it.b[0], it.b[1]);
          ctx.stroke();
          if (it.c2) {
            ctx.strokeStyle = it.c2;
            ctx.lineWidth = Math.max(0.5, it.w * it.a[2] * 0.28);
            ctx.beginPath();
            ctx.moveTo(it.a[0], it.a[1] - 0.6);
            ctx.lineTo(it.b[0], it.b[1] - 0.6);
            ctx.stroke();
          }
        } else if (it.k === "d") {
          ctx.beginPath();
          ctx.arc(it.x, it.y, Math.max(0.5, it.r), 0, Math.PI * 2);
          ctx.fillStyle = it.c;
          if (it.glow) {
            ctx.shadowColor = it.glow;
            ctx.shadowBlur = 9;
          }
          ctx.fill();
          if (it.glow) ctx.shadowBlur = 0;
        } else if (it.k === "t") {
          ctx.save();
          ctx.transform(it.m[0], it.m[1], it.m[2], it.m[3], it.m[4], it.m[5]);
          it.draw(ctx);
          ctx.restore();
        }
      }
    }

    function drawLegend() {
      if (!thermal || W < 560) return;
      const bw = 190,
        bx = cx - bw / 2,
        by = 14;
      const lg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
      HEAT.forEach(([k, c]) => lg.addColorStop(k, rgbStr(c)));
      ctx.fillStyle = lg;
      ctx.fillRect(bx, by, bw, 8);
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.strokeRect(bx, by, bw, 8);
      ctx.fillStyle = "#9fb4d9";
      ctx.font = "10px 'JetBrains Mono', monospace";
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillText("25°C", bx, by + 12);
      ctx.textAlign = "right";
      ctx.fillText("55°C", bx + bw, by + 12);
      const mx = bx + clamp((lv.temp - 25) / 30, 0, 1) * bw;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.moveTo(mx, by - 2);
      ctx.lineTo(mx - 4, by - 8);
      ctx.lineTo(mx + 4, by - 8);
      ctx.closePath();
      ctx.fill();
      ctx.textAlign = "center";
      ctx.fillText(`core ${lv.temp.toFixed(1)}°C`, mx, by + 12);
    }

    /* ---------- main loop ---------- */
    const frame = () => {
      lv = live.current;
      const v = viewRef.current;
      time += 1 / 60;
      if (lv.autoRotate && !drag) v.rotY += 0.0035;
      fanSpeed += ((lv.fanActive ? 0.5 : 0) - fanSpeed) * 0.04;
      fanAngle += fanSpeed;

      mode = lv.viewMode;
      ghost = mode === "flux";
      thermal = mode === "thermal";
      partTemp = thermal
        ? {
            core: lv.temp,
            primary: lv.temp + 5,
            secondary: lv.temp + 3,
            bobbin: lv.temp + 2,
            frame: lv.temp - 2,
            chassis: lv.temp - 6,
            terminals: lv.temp - 8,
            fan: lv.temp - 7,
          }
        : {};

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      cx = W / 2;
      cy = H / 2 + 14;
      const fitZoom = clamp(Math.min(W / 760, H / 500), 0.5, 1.4);
      cam = makeCam(v, v.zoom * fitZoom);

      items.length = 0;
      drawBackground();
      buildScene();
      items.sort((a, b) => b.z - a.z);
      drawItems();
      drawLegend();

      animId = requestAnimationFrame(frame);
    };
    let mode = "realistic";

    /* ---------- pointer controls ---------- */
    let drag = false;
    let last = [0, 0];
    const setCursor = () => {
      canvas.style.cursor = drag ? "grabbing" : hover ? "pointer" : "grab";
    };
    const onDown = (e) => {
      drag = true;
      last = [e.clientX, e.clientY];
      canvas.setPointerCapture?.(e.pointerId);
      setAutoRotate(false);
      setCursor();
    };
    const onMove = (e) => {
      const v = viewRef.current;
      if (drag) {
        v.rotY += (e.clientX - last[0]) * 0.011;
        v.rotX = clamp(v.rotX + (e.clientY - last[1]) * 0.011, -1.2, 1.2);
        last = [e.clientX, e.clientY];
        return;
      }
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left,
        y = e.clientY - r.top;
      let found = null;
      for (let i = hits.length - 1; i >= 0; i--) {
        if (pointInPoly(x, y, hits[i].pts)) {
          found = hits[i].part;
          break;
        }
      }
      if (found !== hover) {
        hover = found;
        setInspectedPart(found);
        setCursor();
      }
    };
    const onUp = (e) => {
      drag = false;
      canvas.releasePointerCapture?.(e.pointerId);
      setCursor();
    };
    const onLeave = () => {
      if (!drag && hover) {
        hover = null;
        setInspectedPart(null);
        setCursor();
      }
    };
    const onWheel = (e) => {
      e.preventDefault();
      const v = viewRef.current;
      v.zoom = clamp(v.zoom - e.deltaY * 0.0012, 0.55, 1.9);
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    setCursor();

    frame();

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [viewMode]);

  const info = inspectedPart ? partInfo[inspectedPart] : null;

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
            className={`t3d-action-btn ${autoRotate ? "active" : ""}`}
            onClick={() => setAutoRotate(!autoRotate)}
            title="Toggle Continuous Rotation"
          >
            {autoRotate ? "⏸ Pause" : "▶ Spin"}
          </button>
        </div>
      </div>

      <div className="t3d-viewport">
        {viewMode !== "schematic" ? (
          <div className="t3d-canvas-container">
            <canvas
              ref={canvasRef}
              className="t3d-webgl-canvas"
              style={{ touchAction: "none" }}
            />

            {/* Live Interactive Telemetry Overlays */}
            <div className="t3d-hud-layer">
              {/* Primary 230V Side */}
              <div className="t3d-terminal-hud left">
                <div className="t3d-hud-card primary">
                  <div className="hud-tag">PRIMARY INPUT (230V AC)</div>
                  <div className="hud-val">
                    {primaryV.toFixed(1)} <span className="u">V RMS</span>
                  </div>
                </div>
              </div>

              {/* Secondary 12-0-12 Side */}
              <div className="t3d-terminal-hud right">
                <div className="t3d-hud-card secondary">
                  <div className="hud-tag">SECONDARY OUTPUT (12 V PER LEG)</div>
                  <div className="ct-row">
                    <span className="leg">+12 V leg:</span>
                    <strong>{vSecA.toFixed(2)} V</strong>
                  </div>
                  <div className="ct-row ct">
                    <span className="leg">Center tap:</span>
                    <strong>0.00 V</strong>
                  </div>
                  <div className="ct-row">
                    <span className="leg">−12 V leg:</span>
                    <strong>{vSecB.toFixed(2)} V</strong>
                  </div>
                </div>
              </div>

              {/* Part inspector (hover a part of the model) */}
              {info && (
                <div
                  className="t3d-hud-card"
                  style={{
                    position: "absolute",
                    right: 16,
                    bottom: 14,
                    width: "min(270px, 46%)",
                    borderLeft: "3px solid var(--status-theme-color, #0ea5e9)",
                    pointerEvents: "none",
                  }}
                >
                  <div className="hud-tag">Inspecting</div>
                  <div
                    style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}
                  >
                    {info.name}
                  </div>
                  <div className="hud-pins" style={{ lineHeight: 1.45 }}>
                    {info.text}
                  </div>
                </div>
              )}

              {/* Bottom Quick Bar */}
              <div className="t3d-hud-bottom">
                <div className="hud-pill">
                  <span className="lbl">Core Temp</span>
                  <span
                    className="num"
                    style={{
                      color: isOverheated ? "var(--accent-red)" : undefined,
                    }}
                  >
                    {temp.toFixed(1)} °C
                  </span>
                </div>
                <div className="hud-pill">
                  <span className="lbl">Load Current</span>
                  <span className="num">{current.toFixed(2)} A RMS</span>
                </div>
                <div className="hud-pill">
                  <span className="lbl">Relay Fan (D23)</span>
                  <span
                    className="num"
                    style={{
                      color: fanActive
                        ? "var(--status-theme-color)"
                        : "#64748b",
                    }}
                  >
                    {fanActive ? "FORCED COOLING ON" : "STANDBY"}
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="t3d-schematic-wrapper">
            <div className="sch-card">
              <h3>Center-Tapped 12-0-12 Transformer Topology</h3>
              <p>
                The 12-0-12V secondary coil features a central ground tap that
                produces two balanced 12V AC phase legs with 180° phase shift.
              </p>

              <div className="sch-grid-boxes">
                <div className="sch-box">
                  <div className="sch-box-title">Primary Side (230V AC)</div>
                  <div className="sch-row live">
                    Live Phase (Red wire) → 230V Mains
                  </div>
                  <div className="sch-row neutral">
                    Neutral Return (Black wire)
                  </div>
                  <div className="sch-spec">Ratio: 230:12 turns step-down</div>
                </div>

                <div className="sch-box core-box">
                  <div className="sch-box-title">Magnetic Core</div>
                  <div className="sch-row">Silicon Steel E-I Laminations</div>
                  <div className="sch-row">
                    Hysteresis &amp; Eddy current suppression
                  </div>
                  <div className="sch-spec">
                    Class B Varnish Thermal Isolation
                  </div>
                </div>

                <div className="sch-box">
                  <div className="sch-box-title">12-0-12 Secondary Output</div>
                  <div className="sch-row sec-a">
                    +12V Phase A (Blue wire) → Pin D35
                  </div>
                  <div className="sch-row sec-ct">
                    0V Center Tap (Black wire) → System GND
                  </div>
                  <div className="sch-row sec-b">
                    -12V Phase B (Yellow wire) → Pin D34
                  </div>
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
