"use client";

import { useEffect, useRef } from "react";

/**
 * Animated topographic-contour background.
 *
 * Renders flowing elevation contours by sampling a cheap 3D value-noise field
 * (the 3rd axis is time, so the "terrain" slowly morphs) and extracting iso-lines
 * with marching squares. Sits fixed behind the page content; pointer-transparent;
 * honours prefers-reduced-motion.
 */

// --- cheap deterministic 3D value noise ---
function hash(x: number, y: number, z: number): number {
  let n = (x | 0) * 374761393 + (y | 0) * 668265263 + (z | 0) * 1274126177;
  n = (n ^ (n >> 13)) >>> 0;
  n = (Math.imul(n, 1274126177)) >>> 0;
  return (n & 0xffff) / 0xffff;
}
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function vnoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = smooth(xf), v = smooth(yf), w = smooth(zf);
  const c000 = hash(xi, yi, zi), c100 = hash(xi + 1, yi, zi);
  const c010 = hash(xi, yi + 1, zi), c110 = hash(xi + 1, yi + 1, zi);
  const c001 = hash(xi, yi, zi + 1), c101 = hash(xi + 1, yi, zi + 1);
  const c011 = hash(xi, yi + 1, zi + 1), c111 = hash(xi + 1, yi + 1, zi + 1);
  const x00 = lerp(c000, c100, u), x10 = lerp(c010, c110, u);
  const x01 = lerp(c001, c101, u), x11 = lerp(c011, c111, u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

export default function TopoBackground() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const STEP = 26; // px between samples (coarser = faster)
    const NOISE_SCALE = 0.04; // lower = larger, softer terrain forms
    const SPEED = 0.05; // morph speed
    // elevation bands -> contour lines (the central band is a brighter index line)
    const LEVELS = [0.34, 0.42, 0.47, 0.5, 0.53, 0.58, 0.66];

    let w = 0, h = 0, cols = 0, rows = 0;
    let field = new Float32Array(0);
    let raf = 0;
    let t = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas!.width = Math.floor(w * dpr);
      canvas!.height = Math.floor(h * dpr);
      canvas!.style.width = w + "px";
      canvas!.style.height = h + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / STEP) + 1;
      rows = Math.ceil(h / STEP) + 1;
      field = new Float32Array(cols * rows);
    }

    function computeField() {
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          field[j * cols + i] = vnoise(i * STEP * NOISE_SCALE, j * STEP * NOISE_SCALE, t);
        }
      }
    }

    // marching squares for one iso level
    function drawLevel(level: number) {
      ctx!.beginPath();
      for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
          const tl = field[j * cols + i];
          const tr = field[j * cols + i + 1];
          const br = field[(j + 1) * cols + i + 1];
          const bl = field[(j + 1) * cols + i];
          let c = 0;
          if (tl > level) c |= 8;
          if (tr > level) c |= 4;
          if (br > level) c |= 2;
          if (bl > level) c |= 1;
          if (c === 0 || c === 15) continue;
          const x = i * STEP, y = j * STEP;
          // edge crossing points (linear interpolation)
          const top = () => [x + STEP * ((level - tl) / (tr - tl)), y] as const;
          const right = () => [x + STEP, y + STEP * ((level - tr) / (br - tr))] as const;
          const bottom = () => [x + STEP * ((level - bl) / (br - bl)), y + STEP] as const;
          const left = () => [x, y + STEP * ((level - tl) / (bl - tl))] as const;
          const seg = (a: readonly [number, number], b: readonly [number, number]) => {
            ctx!.moveTo(a[0], a[1]);
            ctx!.lineTo(b[0], b[1]);
          };
          switch (c) {
            case 1: case 14: seg(left(), bottom()); break;
            case 2: case 13: seg(bottom(), right()); break;
            case 3: case 12: seg(left(), right()); break;
            case 4: case 11: seg(top(), right()); break;
            case 6: case 9: seg(top(), bottom()); break;
            case 7: case 8: seg(left(), top()); break;
            case 5: seg(left(), top()); seg(bottom(), right()); break;
            case 10: seg(left(), bottom()); seg(top(), right()); break;
          }
        }
      }
      ctx!.stroke();
    }

    function frame() {
      computeField();
      ctx!.clearRect(0, 0, w, h);
      for (let k = 0; k < LEVELS.length; k++) {
        const mid = k === 3; // central band = brighter index contour
        const accent = k === 5; // one teal accent band for contrast
        ctx!.lineWidth = mid ? 1.2 : 0.85;
        ctx!.strokeStyle = mid
          ? "rgba(167,139,250,0.26)" // violet-400 index line
          : accent
            ? "rgba(45,212,191,0.10)" // teal accent
            : "rgba(139,92,246,0.09)"; // violet-500, faint
        drawLevel(LEVELS[k]);
      }
      t += SPEED * (1 / 60);
      if (!reduce) raf = requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener("resize", resize);
    if (reduce) {
      computeField();
      frame(); // single static render
    } else {
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[linear-gradient(155deg,#160f2b_0%,#0c0a16_55%,#050509_100%)]">
      <canvas ref={ref} className="absolute inset-0" style={{ filter: "blur(0.6px)" }} />
      {/* purple glows + vignette for depth */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_45%_at_15%_10%,rgba(139,92,246,0.16),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_45%_40%_at_85%_75%,rgba(45,212,191,0.07),transparent_60%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_25%,rgba(5,5,9,0.9)_100%)]" />
    </div>
  );
}
