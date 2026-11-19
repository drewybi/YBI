// In-browser DTF halftone. No network, no DOM. Colour is kept; only coverage becomes dots.

export const DEFAULTS = {
  tolerance: 14,
  softness: 36,
  bgMode: 'auto',
  bgColor: [255, 255, 255],
  denoise: false,
  sharpen: false,
  brightness: 0,
  contrast: 0,
  gamma: 1,
  lpi: 40,
  angle: 22.5,
  shape: 'round',
  minDot: 16,
  choke: 4,
  solid: 88,
  shading: 80,
  knockout: false,
  knockoutStrength: 70,
  shirt: [0, 0, 0],
  dpi: 300,
  widthMm: 210,
  heightMm: 297,
  unit: 'mm',
  lock: true,
  mirror: true,
  preset: 'A4',
};

export function pagePixels(widthMm, heightMm, dpi) {
  const w = Math.max(1, Math.round((widthMm / 25.4) * dpi));
  const h = Math.max(1, Math.round((heightMm / 25.4) * dpi));
  return { w, h };
}

const MAX_PIXELS = 40e6;
export function fitPagePixels(widthMm, heightMm, dpi) {
  let { w, h } = pagePixels(widthMm, heightMm, dpi);
  const capped = w * h > MAX_PIXELS;
  if (capped) {
    const s = Math.sqrt(MAX_PIXELS / (w * h));
    w = Math.max(1, Math.floor(w * s));
    h = Math.max(1, Math.floor(h * s));
  }
  return { w, h, capped };
}

function dist255(r, g, b, R, G, B) {
  const dr = r - R, dg = g - G, db = b - B;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function edgeBackground(data, w, h) {
  const bins = new Map();
  const step = Math.max(1, Math.floor(Math.max(w, h) / 400));
  const take = (x, y) => {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 250) return;
    const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
    bins.set(key, (bins.get(key) || 0) + 1);
  };
  for (let x = 0; x < w; x += step) { take(x, 0); take(x, h - 1); }
  for (let y = 0; y < h; y += step) { take(0, y); take(w - 1, y); }
  let best = 0, key = 0, total = 0;
  for (const [k, n] of bins) { total += n; if (n > best) { best = n; key = k; } }
  if (!total || best / total < 0.45) return null;
  const colour = [(key >> 8) << 4 | 8, ((key >> 4) & 15) << 4 | 8, (key & 15) << 4 | 8];
  const stride = Math.max(1, Math.floor(Math.min(w, h) / 24));
  let seen = 0, differ = 0;
  for (let y = stride; y < h - 1; y += stride) {
    for (let x = stride; x < w - 1; x += stride) {
      const i = (y * w + x) * 4;
      seen++;
      if (data[i + 3] < 250 || dist255(data[i], data[i + 1], data[i + 2], colour[0], colour[1], colour[2]) > 36) differ++;
    }
  }
  if (!seen || differ / seen < 0.04) return null;
  return colour;
}

function adjustColor(r, g, b, brightness, contrast, gamma) {
  let R = r / 255, G = g / 255, B = b / 255;
  const c = contrast;
  const k = (1 + c) ;
  R = (R - 0.5) * k + 0.5 + brightness;
  G = (G - 0.5) * k + 0.5 + brightness;
  B = (B - 0.5) * k + 0.5 + brightness;
  if (gamma !== 1) {
    const inv = 1 / gamma;
    R = Math.pow(Math.min(1, Math.max(0, R)), inv);
    G = Math.pow(Math.min(1, Math.max(0, G)), inv);
    B = Math.pow(Math.min(1, Math.max(0, B)), inv);
  }
  return [
    Math.max(0, Math.min(255, Math.round(R * 255))),
    Math.max(0, Math.min(255, Math.round(G * 255))),
    Math.max(0, Math.min(255, Math.round(B * 255))),
  ];
}

function blur3(src, w, h) {
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1);
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
  const crcBuf = new Uint8Array(4 + 9);
  crcBuf.set(type, 0);
  crcBuf.set(data, 4);
  const crc = crc32(crcBuf);
  const chunk = new Uint8Array(4 + 4 + 9 + 4);
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

// src is RGBA. Returns a new RGBA buffer. Dots are fully opaque or fully clear.
export function processHalftone(src, w, h, settings) {
  const s = { ...DEFAULTS, ...settings };
  const bg = s.bgMode === 'auto' ? (edgeBackground(src, w, h) || s.bgColor) : s.bgColor;
  const tol = (s.tolerance / 100) * 441.67;
  const soft = Math.max(1, (s.softness / 100) * 441.67);
  const n = w * h;
  const rgb = new Uint8ClampedArray(n * 3);
  const alpha = new Float32Array(n);
  const tone = new Float32Array(n);
  const keep = s.bgMode === 'keep';
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    let r = src[i], g = src[i + 1], b = src[i + 2], a = src[i + 3] / 255;
    [r, g, b] = adjustColor(r, g, b, s.brightness, s.contrast, s.gamma);
    if (!keep) {
      const d = dist255(r, g, b, bg[0], bg[1], bg[2]);
      let cover = 1;
      if (d <= tol) cover = 0;
      else if (d < tol + soft) cover = (d - tol) / soft;
      a *= cover;
      if (a > 0.001 && a < 0.999 && cover < 1) {
        const inv = 1 / Math.max(a, 0.001);
        r = Math.max(0, Math.min(255, (r - bg[0] * (1 - a)) * inv));
        g = Math.max(0, Math.min(255, (g - bg[1] * (1 - a)) * inv));
        b = Math.max(0, Math.min(255, (b - bg[2] * (1 - a)) * inv));
      }
    }
    if (s.knockout && s.knockoutStrength > 0) {
      const d = dist255(r, g, b, s.shirt[0], s.shirt[1], s.shirt[2]) / 441.67;
      const fade = Math.min(1, d / 0.28);
      a *= 1 - (s.knockoutStrength / 100) * (1 - fade);
    }
    rgb[p * 3] = r; rgb[p * 3 + 1] = g; rgb[p * 3 + 2] = b;
    alpha[p] = Math.max(0, Math.min(1, a));
  }
  const step = Math.max(4, Math.round(Math.min(w, h) / 30));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const a = alpha[p];
      if (a < 0.985) { tone[p] = a; continue; }
      let diff = 0, seen = 0;
      const probe = [[step, 0], [-step, 0], [0, step], [0, -step]];
      for (let q = 0; q < 4; q++) {
        const xx = x + probe[q][0], yy = y + probe[q][1];
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const o = (yy * w + xx) * 3;
        const i3 = p * 3;
        diff += Math.abs(rgb[i3] - rgb[o]) + Math.abs(rgb[i3 + 1] - rgb[o + 1]) + Math.abs(rgb[i3 + 2] - rgb[o + 2]);
        seen++;
      }
      const flat = !seen || diff / seen < 28;
      if (flat) { tone[p] = 1; continue; }
      const r = rgb[p * 3], g = rgb[p * 3 + 1], b = rgb[p * 3 + 2];
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max < 1 ? 0 : (max - min) / max;
      tone[p] = sat < 0.22 ? Math.max(0, 1 - (s.shading / 100) * lum) : 1;
    }
  }
  if (s.denoise || s.sharpen) {
    const packed = new Uint8ClampedArray(n * 4);
    for (let p = 0; p < n; p++) {
      packed[p * 4] = rgb[p * 3];
      packed[p * 4 + 1] = rgb[p * 3 + 1];
      packed[p * 4 + 2] = rgb[p * 3 + 2];
      packed[p * 4 + 3] = 255;
    }
    const blurred = blur3(packed, w, h);
    for (let p = 0; p < n; p++) {
      for (let c = 0; c < 3; c++) {
        const sharp = packed[p * 4 + c] + (packed[p * 4 + c] - blurred[p * 4 + c]) * 0.85;
        const base = s.denoise ? blurred[p * 4 + c] : packed[p * 4 + c];
        const v = s.sharpen ? sharp : base;
        rgb[p * 3 + c] = Math.max(0, Math.min(255, v));
      }
    }
  }

  const out = new Uint8ClampedArray(n * 4);
  if (s.mode === 'cutout') {
    for (let p = 0; p < n; p++) {
      const o = p * 4;
      const a = Math.max(0, Math.min(1, alpha[p]));
      out[o] = rgb[p * 3];
      out[o + 1] = rgb[p * 3 + 1];
      out[o + 2] = rgb[p * 3 + 2];
      out[o + 3] = Math.round(a * 255);
    }
    return out;
  }
  const cell = Math.max(2, s.dpi / Math.max(1, s.lpi));
  const rad = (s.angle * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
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
  const sum = new Float64Array(cols * rows);
  const count = new Uint32Array(cols * rows);
  const choke = s.choke / 100;
  const solidAt = s.solid / 100;
  const minR = s.minDot / 100;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = x * cos + y * sin, gy = -x * sin + y * cos;
      const ix = Math.floor(gx / cell) - minIx;
      const iy = Math.floor(gy / cell) - minIy;
      const k = iy * cols + ix;
      sum[k] += tone[y * w + x];
      count[k]++;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const gx = x * cos + y * sin, gy = -x * sin + y * cos;
      const ix = Math.floor(gx / cell);
      const iy = Math.floor(gy / cell);
      const cx = ix - minIx, cy = iy - minIy;
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) { out[o + 3] = 0; continue; }
      const k = cy * cols + cx;
      let cov = count[k] ? sum[k] / count[k] : 0;
      cov = Math.max(0, cov - choke);
      const o = p * 4;
      const r = rgb[p * 3], g = rgb[p * 3 + 1], b = rgb[p * 3 + 2];
      if (cov <= 0) { out[o + 3] = 0; continue; }
      if (cov >= solidAt) {
        out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255;
        continue;
      }
      const fx = (gx - (ix + 0.5) * cell) / (cell * 0.5);
      const fy = (gy - (iy + 0.5) * cell) / (cell * 0.5);
      const radius = 2 * Math.sqrt(cov / Math.PI);
      if (radius < minR) { out[o + 3] = 0; continue; }
      let inside = false;
      if (s.shape === 'square') inside = Math.max(Math.abs(fx), Math.abs(fy)) <= radius;
      else if (s.shape === 'line') inside = Math.abs(fx) <= radius * 0.55;
      else if (s.shape === 'ellipse') inside = (fx / 1.35) ** 2 + (fy / 0.72) ** 2 <= radius * radius;
      else inside = fx * fx + fy * fy <= radius * radius;
      if (inside) { out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255; }
      else out[o + 3] = 0;
    }
  }
  return out;
}

export function cutoutOnly(src, w, h, settings) {
  return processHalftone(src, w, h, { ...settings, mode: 'cutout' });
}
