// In-browser DTF halftone. No network and no DOM. Output alpha is only 0 or 255.

export const MAX_SIDE = 12000;
const MAX_DIST = 441.6729559300637;

export const TONE = {
  default: { gain: 0, contrast: 0, gamma: 1, saturation: 1 },
  vibrant: { gain: 4, contrast: 8, gamma: 1.55, saturation: 1.35 },
  dense: { gain: -8, contrast: 10, gamma: 0.72, saturation: 0.85 },
};

export const DEFAULTS = {
  removeBg: true,
  bgColor: [0, 0, 0],
  tolerance: 0.03,
  protect: true,
  ...TONE.vibrant,
  halftone: true,
  shape: 'round',
  lpi: 35,
  angle: 22.5,
  doubleScreen: false,
  shrink: 0,
  specks: 12,
  output: 'original',
  ink: [0, 0, 0],
  minDotMm: 0.10,
  eraseThreshold: 128,
  edgeColorPx: 1,
  smoothEdge: 1.5,
  fillHoles: 6,
  previewErase: false,
  knockout: false,
  knockoutStrength: 80,
  knockoutTarget: 'blacks',
  blackRange: 28,
  protectColours: 20,
  garment: [8, 8, 10],
  dpi: 360,
  screen: 'am',
  denoise: false,
  sharpen: false,
};

const FLAT = {
  ...TONE.default,
  profile: 'default',
  smoothEdge: 0,
  halftone: true,
  doubleScreen: false,
  shape: 'round',
  screen: 'am',
};

export const SUBSTRATES = [
  { id: 'custom', name: 'Custom' },
  { id: 'dtf-dark', name: 'DTF · dark garment', ...FLAT, dpi: 300, lpi: 55, angle: 22.5, output: 'original', minDotMm: 0.10, shrink: 0, specks: 12, garment: 'dark', knockoutTarget: 'blacks', blackRange: 28, protectColours: 20 },
  { id: 'dtf-light', name: 'DTF · light garment', ...FLAT, dpi: 300, lpi: 55, angle: 22.5, output: 'original', minDotMm: 0.10, shrink: 0, specks: 12, garment: 'light', knockoutTarget: 'tones' },
  { id: 'remove-garment', name: 'Remove garment color', ...FLAT, dpi: 300, lpi: 55, angle: 22.5, output: 'original', minDotMm: 0.10, shrink: 0, specks: 12, garment: 'dark', knockout: true, knockoutTarget: 'blacks', blackRange: 28, protectColours: 20 },
  { id: 'dtf-cmyk-dark', name: 'DTF CMYK · dark', ...FLAT, dpi: 600, lpi: 40, angle: 45, output: 'cmyk', minDotMm: 0.15, shrink: 1, specks: 12, garment: 'dark', bgColor: [0, 0, 0], bgAuto: false, knockoutTarget: 'blacks' },
  { id: 'dtf-cmyk-light', name: 'DTF CMYK · light', ...FLAT, dpi: 600, lpi: 45, angle: 45, output: 'cmyk', minDotMm: 0.15, shrink: 1, specks: 12, garment: 'light', bgColor: [0, 0, 0], bgAuto: false, knockoutTarget: 'tones' },
  { id: 'dtg-white', name: 'DTG · white garment', ...FLAT, dpi: 300, lpi: 35, angle: 45, output: 'cmyk', minDotMm: 0.20, shrink: 0, specks: 12, garment: 'light', knockoutTarget: 'tones' },
  { id: 'dtg-dark', name: 'DTG · dark garment', ...FLAT, dpi: 300, lpi: 35, angle: 45, output: 'cmyk', minDotMm: 0.20, shrink: 1, specks: 12, garment: 'dark', knockoutTarget: 'blacks' },
  { id: 'ink-black', name: 'Single black ink', ...FLAT, dpi: 600, lpi: 45, angle: 45, output: 'single', ink: [0, 0, 0], minDotMm: 0.15, shrink: 1, specks: 12, garment: 'light', knockoutTarget: 'tones' },
  { id: 'ink-white', name: 'Single white ink', ...FLAT, dpi: 600, lpi: 45, angle: 45, output: 'single', ink: [255, 255, 255], minDotMm: 0.15, shrink: 1, specks: 12, garment: 'dark', knockoutTarget: 'blacks' },
  { id: 'fm-blue', name: 'FM blue noise', ...FLAT, dpi: 600, lpi: 45, angle: 45, output: 'single', ink: [255, 255, 255], minDotMm: 0.15, shrink: 1, specks: 12, garment: 'dark', screen: 'fm', knockoutTarget: 'blacks' },
];

export function substrateById(id) {
  return SUBSTRATES.find(item => item.id === id) || SUBSTRATES[0];
}

export function outputPixels(widthIn, heightIn, dpi) {
  const w = Math.max(1, Math.round(widthIn * dpi));
  const h = Math.max(1, Math.round(heightIn * dpi));
  return { w, h, capped: false };
}

export function cellPixels(dpi, lpi) {
  return dpi / Math.max(1, lpi);
}

function cubicWeight(t) {
  const a = Math.abs(t);
  if (a <= 1) return 1.5 * a * a * a - 2.5 * a * a + 1;
  if (a < 2) return -0.5 * a * a * a + 2.5 * a * a - 4 * a + 2;
  return 0;
}

// Smooth resample. Never nearest-neighbour. Catmull-Rom, separable, in bands.
export function resampleRGBA(src, sw, sh, dw, dh) {
  if (sw === dw && sh === dh) return new Uint8ClampedArray(src);
  const out = new Uint8ClampedArray(dw * dh * 4);
  const xScale = sw / dw;
  const yScale = sh / dh;
  const band = 48;
  for (let yStart = 0; yStart < dh; yStart += band) {
    const yEnd = Math.min(dh, yStart + band);
    const srcY0 = Math.max(0, Math.floor((yStart + 0.5) * yScale - 0.5) - 1);
    const srcY1 = Math.min(sh, Math.floor(((yEnd - 1) + 0.5) * yScale - 0.5) + 3);
    const rows = Math.max(1, srcY1 - srcY0);
    const tmp = new Float32Array(dw * rows * 4);
    for (let y = srcY0; y < srcY1; y++) {
      const dy = y - srcY0;
      for (let x = 0; x < dw; x++) {
        const srcX = (x + 0.5) * xScale - 0.5;
        const x0 = Math.floor(srcX);
        let r = 0, g = 0, b = 0, a = 0;
        for (let k = -1; k <= 2; k++) {
          const sx = Math.min(sw - 1, Math.max(0, x0 + k));
          const wgt = cubicWeight(srcX - (x0 + k));
          const i = (y * sw + sx) * 4;
          r += src[i] * wgt; g += src[i + 1] * wgt; b += src[i + 2] * wgt; a += src[i + 3] * wgt;
        }
        const o = (dy * dw + x) * 4;
        tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b; tmp[o + 3] = a;
      }
    }
    for (let y = yStart; y < yEnd; y++) {
      const srcY = (y + 0.5) * yScale - 0.5;
      const y0 = Math.floor(srcY);
      for (let x = 0; x < dw; x++) {
        let r = 0, g = 0, b = 0, a = 0;
        for (let k = -1; k <= 2; k++) {
          const sy = Math.min(sh - 1, Math.max(srcY0, y0 + k)) - srcY0;
          const wgt = cubicWeight(srcY - (y0 + k));
          const i = (sy * dw + x) * 4;
          r += tmp[i] * wgt; g += tmp[i + 1] * wgt; b += tmp[i + 2] * wgt; a += tmp[i + 3] * wgt;
        }
        const o = (y * dw + x) * 4;
        out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
      }
    }
  }
  return out;
}

export function medianColorRun(data, w, h, step = 1) {
  const runs = [];
  for (let y = 0; y < h; y += step) {
    let run = 1;
    for (let x = 1; x < w; x++) {
      const i = (y * w + x) * 4;
      const p = i - 4;
      if (data[i] === data[p] && data[i + 1] === data[p + 1] && data[i + 2] === data[p + 2] && data[i + 3] === data[p + 3]) run++;
      else { runs.push(run); run = 1; }
    }
    runs.push(run);
  }
  if (!runs.length) return 0;
  runs.sort((a, b) => a - b);
  return runs[runs.length >> 1];
}

export function formatLength(inches, unit) {
  const n = unit === 'cm' ? inches * 2.54 : inches;
  return (Math.round(n * 100) / 100).toFixed(2);
}

export function trueDpi(sourcePx, inches) {
  if (!inches) return 0;
  return sourcePx / inches;
}

export function qualityLabel(dpi) {
  const n = Math.max(0, Math.round(dpi));
  const word = n >= 250 ? 'Excellent' : n >= 200 ? 'Good' : n >= 150 ? 'Fair' : 'Soft';
  return `${word} · ${n} dpi`;
}

function dist01(r, g, b, R, G, B) {
  const dr = r - R, dg = g - G, db = b - B;
  return Math.sqrt(dr * dr + dg * dg + db * db) / MAX_DIST;
}

export function detectBackground(data, w, h) {
  const bins = new Map();
  const step = Math.max(1, Math.floor(Math.max(w, h) / 400));
  const samples = [];
  const take = (x, y) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 16) return;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    samples.push([data[i], data[i + 1], data[i + 2], key]);
    bins.set(key, (bins.get(key) || 0) + 1);
  };
  for (let x = 0; x < w; x += step) { take(x, 0); if (h > 1) take(x, h - 1); }
  for (let y = 0; y < h; y += step) { take(0, y); if (w > 1) take(w - 1, y); }
  if (!samples.length) return [0, 0, 0];
  let best = 0, key = samples[0][3], total = 0;
  for (const [k, count] of bins) { total += count; if (count > best) { best = count; key = k; } }
  let sr = 0, sg = 0, sb = 0, n = 0;
  const useAll = !(total && best / total >= 0.4);
  for (const sample of samples) {
    if (!useAll && sample[3] !== key) continue;
    sr += sample[0]; sg += sample[1]; sb += sample[2]; n++;
  }
  return [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)];
}

export function autoTolerance(data, w, h, bg) {
  const step = Math.max(1, Math.floor(Math.max(w, h) / 300));
  let sum = 0, n = 0;
  const take = (x, y) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 16) return;
    sum += dist01(data[i], data[i + 1], data[i + 2], bg[0], bg[1], bg[2]);
    n++;
  };
  for (let x = 0; x < w; x += step) { take(x, 0); if (h > 1) take(x, h - 1); }
  for (let y = 0; y < h; y += step) { take(0, y); if (w > 1) take(w - 1, y); }
  const mean = n ? sum / n : 0;
  return Math.round(Math.min(0.45, Math.max(0.03, mean * 3 + 0.02)) * 100) / 100;
}

export function hexOf(rgb) {
  return '#' + rgb.map(n => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0')).join('');
}

export function parseHex(value) {
  const m = /^#?([0-9a-f]{6})$/i.exec(value || '');
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function pngWithDpi(png, dpi) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (png[i] !== sig[i]) return png;
  const ppm = Math.max(1, Math.round(dpi / 0.0254));
  const data = new Uint8Array(9);
  const view = new DataView(data.buffer);
  view.setUint32(0, ppm);
  view.setUint32(4, ppm);
  data[8] = 1;
  const type = [112, 72, 89, 115];
  const crcBuf = new Uint8Array(13);
  crcBuf.set(type, 0);
  crcBuf.set(data, 4);
  const crc = crc32(crcBuf);
  const chunk = new Uint8Array(21);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, 9);
  chunk.set(type, 4);
  chunk.set(data, 8);
  cv.setUint32(17, crc);
  let at = 8;
  while (at + 8 <= png.length) {
    const len = new DataView(png.buffer, png.byteOffset + at, 4).getUint32(0);
    const t = String.fromCharCode(png[at + 4], png[at + 5], png[at + 6], png[at + 7]);
    if (t === 'pHYs') return png;
    if (t === 'IDAT' || t === 'IEND') break;
    at += 12 + len;
  }
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, at), 0);
  out.set(chunk, at);
  out.set(png.subarray(at), at + chunk.length);
  return out;
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

function applyTone(r, g, b, s) {
  let R = r / 255, G = g / 255, B = b / 255;
  const contrast = s.contrast / 100;
  const gain = (s.gain / 100) * 0.35;
  R = (R - 0.5) * (1 + contrast) + 0.5 + gain;
  G = (G - 0.5) * (1 + contrast) + 0.5 + gain;
  B = (B - 0.5) * (1 + contrast) + 0.5 + gain;
  if (s.gamma && s.gamma !== 1) {
    const inv = 1 / s.gamma;
    R = Math.pow(clamp01(R), inv);
    G = Math.pow(clamp01(G), inv);
    B = Math.pow(clamp01(B), inv);
  }
  const sat = s.saturation == null ? 1 : s.saturation;
  const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  R = lum + (R - lum) * sat;
  G = lum + (G - lum) * sat;
  B = lum + (B - lum) * sat;
  return [
    Math.max(0, Math.min(255, Math.round(R * 255))),
    Math.max(0, Math.min(255, Math.round(G * 255))),
    Math.max(0, Math.min(255, Math.round(B * 255))),
  ];
}

function blur3(src, w, h) {
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    const y0 = y > 0 ? y - 1 : 0, y1 = y + 1 < h ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : 0, x1 = x + 1 < w ? x + 1 : w - 1;
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const i = (yy * w + xx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = src[o + 3];
    }
  }
  return out;
}

function keyMask(rgb, w, h, bg, tolerance, protect, edges) {
  const n = w * h;
  const kill = new Uint8Array(n);
  const near = (p) => dist01(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2], bg[0], bg[1], bg[2]) <= tolerance;
  const edge = edges || { top: true, right: true, bottom: true, left: true };
  if (!protect) {
    for (let p = 0; p < n; p++) if (near(p)) kill[p] = 1;
    return kill;
  }
  const qx = new Int32Array(n);
  const qy = new Int32Array(n);
  let qe = 0, qs = 0;
  const push = (x, y) => {
    const p = y * w + x;
    if (kill[p] || !near(p)) return;
    kill[p] = 1;
    qx[qe] = x; qy[qe] = y; qe++;
  };
  if (edge.top) for (let x = 0; x < w; x++) push(x, 0);
  if (edge.bottom && h > 1) for (let x = 0; x < w; x++) push(x, h - 1);
  for (let y = 0; y < h; y++) {
    if (edge.left) push(0, y);
    if (edge.right && w > 1) push(w - 1, y);
  }
  while (qs < qe) {
    const x = qx[qs], y = qy[qs]; qs++;
    if (x > 0) push(x - 1, y);
    if (x + 1 < w) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y + 1 < h) push(x, y + 1);
  }
  return kill;
}

function manhattan(seedClear, w, h) {
  const n = w * h;
  const d = new Float32Array(n);
  const INF = 1e6;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (seedClear[p]) { d[p] = 0; continue; }
      let best = INF;
      if (x) best = d[p - 1] + 1;
      if (y) best = Math.min(best, d[p - w] + 1);
      d[p] = best;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x;
      let best = d[p];
      if (x + 1 < w) best = Math.min(best, d[p + 1] + 1);
      if (y + 1 < h) best = Math.min(best, d[p + w] + 1);
      d[p] = best;
    }
  }
  return d;
}

function boxBlurAlpha(alpha, w, h, radius) {
  const r = Math.max(1, Math.round(radius));
  const tmp = new Float32Array(alpha.length);
  const out = new Float32Array(alpha.length);
  const horiz = (src, dst) => {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      const row = y * w;
      for (let x = 0; x < r; x++) sum += src[row + x];
      for (let x = 0; x < w; x++) {
        const x1 = x + r < w ? x + r : w - 1;
        const x0 = x - r - 1;
        sum += src[row + x1];
        if (x0 >= 0) sum -= src[row + x0];
        const span = x1 - Math.max(0, x - r) + 1;
        dst[row + x] = sum / span;
      }
    }
  };
  horiz(alpha, tmp);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y < r; y++) sum += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const y1 = y + r < h ? y + r : h - 1;
      const y0 = y - r - 1;
      sum += tmp[y1 * w + x];
      if (y0 >= 0) sum -= tmp[y0 * w + x];
      const span = y1 - Math.max(0, y - r) + 1;
      out[y * w + x] = sum / span;
    }
  }
  return out;
}

function cleanupMask(rgb, alpha, w, h, s) {
  const n = w * h;
  const semi = 0;
  if (s.shrink) {
    const clear = new Uint8Array(n);
    for (let p = 0; p < n; p++) clear[p] = alpha[p] < 128 ? 1 : 0;
    if (s.shrink > 0) {
      const d = manhattan(clear, w, h);
      for (let p = 0; p < n; p++) if (d[p] <= s.shrink) alpha[p] = 0;
    } else {
      const ink = new Uint8Array(n);
      for (let p = 0; p < n; p++) ink[p] = alpha[p] >= 128 ? 1 : 0;
      const d = manhattan(ink, w, h);
      const grow = -s.shrink;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const p = y * w + x;
          if (alpha[p] >= 128 || d[p] > grow || d[p] === 0) continue;
          let found = false;
          const rad = Math.ceil(d[p]);
          for (let dy = -rad; dy <= rad && !found; dy++) {
            for (let dx = -rad; dx <= rad; dx++) {
              const xx = x + dx, yy = y + dy;
              if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
              const q = yy * w + xx;
              if (alpha[q] >= 128) {
                rgb[p * 3] = rgb[q * 3]; rgb[p * 3 + 1] = rgb[q * 3 + 1]; rgb[p * 3 + 2] = rgb[q * 3 + 2];
                alpha[p] = 255; found = true; break;
              }
            }
          }
        }
      }
    }
  }
  if (s.edgeColorPx > 0) {
    const clear = new Uint8Array(n);
    for (let p = 0; p < n; p++) clear[p] = alpha[p] < 128 ? 1 : 0;
    const d = manhattan(clear, w, h);
    const next = new Uint8ClampedArray(rgb);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (d[p] <= 0 || d[p] > s.edgeColorPx) continue;
        let br = 0, bgc = 0, bb = 0, bn = 0;
        for (let yy = Math.max(0, y - 2); yy <= Math.min(h - 1, y + 2); yy++) {
          for (let xx = Math.max(0, x - 2); xx <= Math.min(w - 1, x + 2); xx++) {
            const q = yy * w + xx;
            if (d[q] <= d[p]) continue;
            br += rgb[q * 3]; bgc += rgb[q * 3 + 1]; bb += rgb[q * 3 + 2]; bn++;
          }
        }
        if (bn) {
          next[p * 3] = br / bn; next[p * 3 + 1] = bgc / bn; next[p * 3 + 2] = bb / bn;
        }
      }
    }
    rgb.set(next);
  }
  const erase = new Uint8Array(n);
  let work = alpha;
  const feather = Math.max(Number(s.smoothEdge) || 0, 0.85);
  if (feather > 0) work = boxBlurAlpha(alpha, w, h, feather);
  const threshold = s.eraseThreshold;
  for (let p = 0; p < n; p++) {
    const v = work === alpha ? alpha[p] : work[p];
    if (v < threshold) {
      if (alpha[p] >= 128 || v > 8) erase[p] = 1;
      alpha[p] = 0;
    } else alpha[p] = 255;
  }
  if (s.specks > 0 || s.fillHoles > 0) components(rgb, alpha, w, h, s.specks, s.fillHoles);
  return { semi, erase };
}

function components(rgb, alpha, w, h, speck, holes) {
  const n = w * h;
  const seen = new Uint8Array(n);
  const qx = new Int32Array(n);
  const qy = new Int32Array(n);
  const members = [];
  for (let start = 0; start < n; start++) {
    if (seen[start]) continue;
    const on = alpha[start] >= 128;
    let qe = 0, qs = 0;
    seen[start] = 1;
    qx[qe] = start % w; qy[qe] = (start / w) | 0; qe++;
    members.length = 0;
    let border = false;
    let cr = 0, cg = 0, cb = 0, cn = 0;
    while (qs < qe) {
      const x = qx[qs], y = qy[qs]; qs++;
      const p = y * w + x;
      members.push(p);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
      if (x > 0) visit(x - 1, y);
      if (x + 1 < w) visit(x + 1, y);
      if (y > 0) visit(x, y - 1);
      if (y + 1 < h) visit(x, y + 1);
    }
    function visit(x, y) {
      const p = y * w + x;
      const ink = alpha[p] >= 128;
      if (ink !== on) {
        if (!on && ink) { cr += rgb[p * 3]; cg += rgb[p * 3 + 1]; cb += rgb[p * 3 + 2]; cn++; }
        return;
      }
      if (seen[p]) return;
      seen[p] = 1;
      qx[qe] = x; qy[qe] = y; qe++;
    }
    if (on && speck > 0 && members.length < speck) {
      for (let i = 0; i < members.length; i++) alpha[members[i]] = 0;
    } else if (!on && holes > 0 && !border && members.length <= holes && cn) {
      const r = cr / cn, g = cg / cn, b = cb / cn;
      for (let i = 0; i < members.length; i++) {
        const p = members[i];
        rgb[p * 3] = r; rgb[p * 3 + 1] = g; rgb[p * 3 + 2] = b; alpha[p] = 255;
      }
    }
  }
}

let blueNoise = null;
function fmValue(x, y) {
  if (!blueNoise) blueNoise = buildBlueNoise(64);
  return blueNoise[(y & 63) * 64 + (x & 63)];
}

function buildBlueNoise(size) {
  const n = size * size;
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i % size, y = (i / size) | 0;
    const a = (0.5 + 0.7548776662466927 * x + 0.5698402909980532 * y) % 1;
    const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    const white = h - Math.floor(h);
    v[i] = (a * 0.65 + white * 0.35) % 1;
  }
  const tmp = new Float32Array(n);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            sum += v[((y + dy) & (size - 1)) * size + ((x + dx) & (size - 1))];
          }
        }
        tmp[y * size + x] = (v[y * size + x] - sum / 9 + 1) % 1;
      }
    }
    v.set(tmp);
  }
  const order = [...v.keys()].sort((a, b) => v[a] - v[b]);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[order[i]] = i / (n - 1);
  return out;
}

function lumaOf(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
function chromaOf(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max < 1 ? 0 : (max - min) / max;
}
function blacksCoverage(r, g, b, s) {
  const lum = lumaOf(r, g, b);
  const sat = chromaOf(r, g, b);
  let darkness = 1 - lum;
  if (s.knockout && s.garment) {
    const near = 1 - dist01(r, g, b, s.garment[0], s.garment[1], s.garment[2]);
    darkness = Math.max(darkness, near);
  }
  const range = Math.max(0.04, (s.blackRange == null ? 28 : s.blackRange) / 100);
  const protect = (s.protectColours == null ? 20 : s.protectColours) / 100;
  // Anything at least this light stays solid: white, chrome, light blue.
  if (lum >= range) return 1;
  // Saturated colour stays solid until it is much closer to black.
  if (sat >= protect && lum >= range * (1 - Math.min(0.82, sat))) return 1;
  const floor = sat >= protect ? range * (1 - Math.min(0.82, sat)) : range;
  const t = (floor - lum) / Math.max(0.04, floor);
  return Math.max(0, Math.min(1, 1 - t));
}

function coverageOf(r, g, b, a, bg, s) {
  if (a < 128) return 0;
  if (s.output !== 'single' && s.output !== 'cmyk' && s.knockoutTarget !== 'tones') return blacksCoverage(r, g, b, s);
  if (!s.removeBg) return 1;
  const d = dist01(r, g, b, bg[0], bg[1], bg[2]);
  const peak = Math.max(r, g, b) / 255;
  const bgLum = (bg[0] + bg[1] + bg[2]) / 765;
  let tone = bgLum < 0.45 ? Math.max(d * 1.2, peak) : Math.max(d * 1.35, 1 - peak);
  if (s.output === 'single') {
    const inkLum = (0.2126 * s.ink[0] + 0.7152 * s.ink[1] + 0.0722 * s.ink[2]) / 255;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    tone = inkLum > 0.6 ? lum : 1 - lum;
  }
  if (s.knockout && s.knockoutStrength > 0) {
    const gd = dist01(r, g, b, s.garment[0], s.garment[1], s.garment[2]);
    const keep = Math.min(1, gd / 0.32);
    tone *= 1 - (s.knockoutStrength / 100) * (1 - keep);
  }
  return tone < 0 ? 0 : tone > 1 ? 1 : tone;
}

function cmykOf(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255;
  const k = 1 - Math.max(R, G, B);
  if (k > 0.999) return [0, 0, 0, 1];
  return [(1 - R - k) / (1 - k), (1 - G - k) / (1 - k), (1 - B - k) / (1 - k), k];
}

function screenDots(rgb, alpha, w, h, s, bg) {
  const n = w * h;
  const out = new Uint8ClampedArray(n * 4);
  const dpi = s.dpi || 300;
  const lpi = Math.max(1, s.lpi || 35);
  const cell = Math.max(2, dpi / lpi);
  const minPx = (s.minDotMm / 25.4) * dpi;
  const minCov = Math.min(0.45, (minPx / cell) * (minPx / cell));
  const solidAt = 0.94;
  const angle = (s.angle * Math.PI) / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  if (s.screen === 'fm') {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (alpha[p] < 128) continue;
        const r = rgb[p * 3], g = rgb[p * 3 + 1], b = rgb[p * 3 + 2];
        let cov = coverageOf(r, g, b, 255, bg, s);
        if (cov < minCov) continue;
        const on = cov >= solidAt || cov > fmValue(x, y);
        if (!on) continue;
        const o = p * 4;
        if (s.output === 'single') { out[o] = s.ink[0]; out[o + 1] = s.ink[1]; out[o + 2] = s.ink[2]; }
        else { out[o] = r; out[o + 1] = g; out[o + 2] = b; }
        out[o + 3] = 255;
      }
    }
    return out;
  }
  if (s.output === 'cmyk') return screenCmyk(rgb, alpha, w, h, s, minCov, solidAt);
  const grids = [[angle, lpi, 1]];
  if (s.doubleScreen) grids.push([angle + 37 * Math.PI / 180, lpi * 1.5, 0.72]);
  const hit = new Uint8Array(n);
  for (let pass = 0; pass < grids.length; pass++) {
    const ang = grids[pass][0], freq = grids[pass][1], scale = grids[pass][2];
    const csz = Math.max(2, dpi / freq);
    const ccos = Math.cos(ang), csin = Math.sin(ang);
    stamp(rgb, alpha, w, h, s, bg, out, hit, csz, ccos, csin, scale, minCov, solidAt, false);
  }
  return out;
}

function stamp(rgb, alpha, w, h, s, bg, out, hit, cell, cos, sin, scale, minCov, solidAt, cmykChannel) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
  for (const [x, y] of corners) {
    const gx = x * cos + y * sin, gy = -x * sin + y * cos;
    minX = Math.min(minX, gx); maxX = Math.max(maxX, gx);
    minY = Math.min(minY, gy); maxY = Math.max(maxY, gy);
  }
  const minIx = Math.floor(minX / cell) - 1;
  const maxIx = Math.floor(maxX / cell) + 1;
  const minIy = Math.floor(minY / cell) - 1;
  const maxIy = Math.floor(maxY / cell) + 1;
  const cols = maxIx - minIx + 1;
  const rows = maxIy - minIy + 1;
  const acc = new Float64Array(cols * rows);
  const cnt = new Uint32Array(cols * rows);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (alpha[p] < 128) continue;
      const gx = x * cos + y * sin, gy = -x * sin + y * cos;
      const ix = Math.floor(gx / cell) - minIx;
      const iy = Math.floor(gy / cell) - minIy;
      if (ix < 0 || iy < 0 || ix >= cols || iy >= rows) continue;
      const k = iy * cols + ix;
      acc[k] += cmykChannel ? cmykChannel(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]) : coverageOf(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2], 255, bg, s);
      cnt[k]++;
    }
  }
  const shape = s.shape === 'circle' ? 'round' : s.shape;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (alpha[p] < 128) continue;
      const gx = x * cos + y * sin, gy = -x * sin + y * cos;
      const ix = Math.floor(gx / cell);
      const iy = Math.floor(gy / cell);
      const cx = ix - minIx, cy = iy - minIy;
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
      const k = cy * cols + cx;
      if (!cnt[k]) continue;
      let cov = acc[k] / cnt[k];
      if (cov < minCov) continue;
      const fx = (gx - (ix + 0.5) * cell) / (cell * 0.5);
      const fy = (gy - (iy + 0.5) * cell) / (cell * 0.5);
      let on = false;
      const scaled = Math.min(1, cov * scale);
      const radius = 2 * Math.sqrt(Math.max(scaled, 0) / Math.PI);
      const inside = (px, py) => {
        if (shape === 'line') return Math.abs(px) <= scaled;
        if (shape === 'ellipse') return (px / 1.35) ** 2 + (py / 0.72) ** 2 <= radius * radius;
        if (shape === 'diamond') return Math.abs(px) + Math.abs(py) <= radius * 1.15;
        if (shape === 'square') return Math.max(Math.abs(px), Math.abs(py)) <= radius;
        if (shape === 'euclidean') {
          if (scaled < 0.5) return px * px + py * py <= (Math.sqrt((scaled * 2) / Math.PI)) ** 2;
          const hole = Math.sqrt(((1 - scaled) * 2) / Math.PI);
          return px * px + py * py > hole * hole;
        }
        return px * px + py * py <= radius * radius;
      };
      if (cov >= solidAt) on = true;
      else {
        const dpx = radius * cell;
        if (dpx < (s.minDotMm / 25.4) * (s.dpi || 300)) continue;
        if (shape === 'round' || shape === 'circle') {
          const px = 2 / cell;
          let hits = 0;
          for (let sy = 0; sy < 4; sy++) {
            for (let sx = 0; sx < 4; sx++) {
              const ox = ((sx + 0.5) / 4 - 0.5) * px;
              const oy = ((sy + 0.5) / 4 - 0.5) * px;
              if (inside(fx + ox, fy + oy)) hits++;
            }
          }
          on = hits >= 8;
        } else on = inside(fx, fy);
      }
      if (!on) continue;
      hit[p] = 1;
      const o = p * 4;
      if (s.output === 'single') { out[o] = s.ink[0]; out[o + 1] = s.ink[1]; out[o + 2] = s.ink[2]; }
      else { out[o] = rgb[p * 3]; out[o + 1] = rgb[p * 3 + 1]; out[o + 2] = rgb[p * 3 + 2]; }
      out[o + 3] = 255;
    }
  }
  return { acc, cnt, cols, rows, minIx, minIy, cos, sin, cell };
}

function screenCmyk(rgb, alpha, w, h, s, minCov, solidAt) {
  const n = w * h;
  const out = new Uint8ClampedArray(n * 4);
  const hit = new Uint8Array(n);
  const angles = [s.angle * Math.PI / 180 - 0.52, s.angle * Math.PI / 180 + 0.52, s.angle * Math.PI / 180 - 0.79, s.angle * Math.PI / 180];
  const on = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
  for (let ch = 0; ch < 4; ch++) {
    const fake = new Uint8ClampedArray(n * 4);
    const marker = new Uint8Array(n);
    stamp(rgb, alpha, w, h, { ...s, output: 'original', shape: s.shape === 'line' ? 'line' : 'round' }, [0, 0, 0], fake, marker, Math.max(2, (s.dpi || 300) / s.lpi), Math.cos(angles[ch]), Math.sin(angles[ch]), 1, minCov, solidAt, (r, g, b) => cmykOf(r, g, b)[ch]);
    on[ch] = marker;
  }
  for (let p = 0; p < n; p++) {
    const C = on[0][p], M = on[1][p], Y = on[2][p], K = on[3][p];
    if (!C && !M && !Y && !K) continue;
    const o = p * 4;
    out[o] = 255 * (1 - C) * (1 - K);
    out[o + 1] = 255 * (1 - M) * (1 - K);
    out[o + 2] = 255 * (1 - Y) * (1 - K);
    out[o + 3] = 255;
    hit[p] = 1;
  }
  return out;
}

export function processHalftone(src, w, h, settings, opt = {}) {
  const s = { ...DEFAULTS, ...settings };
  const started = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const n = w * h;
  const rgb = new Uint8ClampedArray(n * 3);
  const alpha = new Float32Array(n);
  let semiSrc = 0;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    let r = src[i], g = src[i + 1], b = src[i + 2], a = src[i + 3];
    if (a > 2 && a < 253) semiSrc++;
    if (s.denoise || s.sharpen) { /* applied below */ }
    [r, g, b] = applyTone(r, g, b, s);
    rgb[p * 3] = r; rgb[p * 3 + 1] = g; rgb[p * 3 + 2] = b;
    alpha[p] = a;
  }
  if (s.denoise || s.sharpen) {
    const packed = new Uint8ClampedArray(n * 4);
    for (let p = 0; p < n; p++) {
      packed[p * 4] = rgb[p * 3]; packed[p * 4 + 1] = rgb[p * 3 + 1]; packed[p * 4 + 2] = rgb[p * 3 + 2]; packed[p * 4 + 3] = 255;
    }
    const blurred = blur3(packed, w, h);
    for (let p = 0; p < n; p++) {
      for (let c = 0; c < 3; c++) {
        const base = s.denoise ? blurred[p * 4 + c] : packed[p * 4 + c];
        const sharp = packed[p * 4 + c] + (packed[p * 4 + c] - blurred[p * 4 + c]) * 0.85;
        rgb[p * 3 + c] = Math.max(0, Math.min(255, s.sharpen ? sharp : base));
      }
    }
  }
  const bg = s.bgColor || [0, 0, 0];
  if (s.removeBg) {
    const kill = opt.kill || keyMask(rgb, w, h, bg, s.tolerance, s.protect !== false, opt.edges);
    const origin = opt.rowOffset || 0;
    for (let p = 0; p < n; p++) if (kill[origin * w + p]) alpha[p] = 0;
  }
  const cleaned = cleanupMask(rgb, alpha, w, h, s);
  const cutout = new Uint8ClampedArray(n * 4);
  for (let p = 0; p < n; p++) {
    const o = p * 4;
    if (alpha[p] < 128) continue;
    cutout[o] = rgb[p * 3]; cutout[o + 1] = rgb[p * 3 + 1]; cutout[o + 2] = rgb[p * 3 + 2]; cutout[o + 3] = 255;
  }
  let rgba = cutout;
  if (s.halftone !== false) rgba = screenDots(rgb, alpha, w, h, s, bg);
  if (s.previewErase) {
    for (let p = 0; p < n; p++) {
      if (!cleaned.erase[p]) continue;
      const o = p * 4;
      rgba[o] = 255; rgba[o + 1] = 0; rgba[o + 2] = 180; rgba[o + 3] = 255;
    }
  }
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = rgba[i] >= 128 ? 255 : 0;
  return {
    rgba,
    cutout,
    semi: semiSrc,
    bg,
    ms: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started,
  };
}
