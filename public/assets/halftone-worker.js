import { processHalftone } from './halftone-core.mjs';

const STRIP_AT = 9_000_000;
const HARD_CAP = 80_000_000;

self.onmessage = async (e) => {
  const { jobId, bitmap, width, height, settings, purpose } = e.data;
  try {
    if (width < 1 || height < 1 || width * height > HARD_CAP) {
      throw new Error(`This print is ${width} × ${height} px, which is too large to hold in this browser. Lower the DPI or the print size.`);
    }
    const resized = await resample(bitmap, width, height);
    const result = width * height > STRIP_AT
      ? renderStrips(resized, width, height, settings)
      : renderWhole(resized, width, height, settings);
    if (resized !== bitmap && resized.close) resized.close();
    if (bitmap.close) bitmap.close();
    const transfer = [result.placed.buffer, result.rgba.buffer];
    if (result.cutout.buffer !== result.rgba.buffer) transfer.push(result.cutout.buffer);
    self.postMessage({
      jobId, purpose, width, height,
      placed: result.placed,
      rgba: result.rgba,
      cutout: result.cutout,
      semi: result.semi,
      bg: result.bg,
      ms: result.ms,
      full: true,
    }, transfer);
  } catch (err) {
    self.postMessage({ jobId, purpose, error: err && err.message ? err.message : 'Could not render the halftone.' });
  }
};

async function resample(bitmap, width, height) {
  if (bitmap.width === width && bitmap.height === height) return bitmap;
  try {
    return await createImageBitmap(bitmap, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
  } catch {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    return canvas.transferToImageBitmap();
  }
}

function drawStrip(bitmap, width, y, height) {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, y, width, height, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

function renderWhole(bitmap, width, height, settings) {
  const src = drawStrip(bitmap, width, 0, height);
  const placed = new Uint8ClampedArray(src.data);
  const processed = processHalftone(src.data, width, height, settings);
  return { placed, ...processed };
}

function globalKill(bitmap, width, height, settings) {
  if (!settings.removeBg) return null;
  const bg = settings.bgColor || [0, 0, 0];
  const tol = settings.tolerance == null ? 0.03 : settings.tolerance;
  const near = new Uint8Array(width * height);
  const band = 256;
  for (let y = 0; y < height; y += band) {
    const sh = Math.min(band, height - y);
    const src = drawStrip(bitmap, width, y, sh);
    const data = src.data;
    for (let i = 0; i < width * sh; i++) {
      const dr = data[i * 4] - bg[0];
      const dg = data[i * 4 + 1] - bg[1];
      const db = data[i * 4 + 2] - bg[2];
      if (Math.sqrt(dr * dr + dg * dg + db * db) / 441.6729559300637 <= tol) near[y * width + i] = 1;
    }
  }
  if (settings.protect === false) return near;
  const keep = new Uint8Array(width * height);
  const qx = new Int32Array(width * height);
  const qy = new Int32Array(width * height);
  let qe = 0, qs = 0;
  const push = (x, y) => {
    const p = y * width + x;
    if (keep[p] || !near[p]) return;
    keep[p] = 1;
    qx[qe] = x;
    qy[qe] = y;
    qe++;
  };
  for (let x = 0; x < width; x++) { push(x, 0); if (height > 1) push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); if (width > 1) push(width - 1, y); }
  while (qs < qe) {
    const x = qx[qs], y = qy[qs];
    qs++;
    if (x > 0) push(x - 1, y);
    if (x + 1 < width) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y + 1 < height) push(x, y + 1);
  }
  return keep;
}

function renderStrips(bitmap, width, height, settings) {
  const overlap = Math.max(48, Math.ceil((settings.dpi || 300) / Math.max(1, settings.lpi || 35)) + 16);
  const strip = 420;
  const kill = globalKill(bitmap, width, height, settings);
  const placed = new Uint8ClampedArray(width * height * 4);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const cutout = new Uint8ClampedArray(width * height * 4);
  let semi = 0;
  let bg = settings.bgColor || [0, 0, 0];
  let ms = 0;
  for (let y = 0; y < height; y += strip) {
    const y0 = Math.max(0, y - overlap);
    const y1 = Math.min(height, y + strip + overlap);
    const src = drawStrip(bitmap, width, y0, y1 - y0);
    const processed = processHalftone(src.data, width, y1 - y0, settings, {
      kill,
      rowOffset: y0,
      edges: { top: y0 === 0, bottom: y1 === height, left: true, right: true },
    });
    bg = processed.bg;
    ms += processed.ms || 0;
    const keep0 = y - y0;
    const keep1 = keep0 + Math.min(strip, height - y);
    for (let row = keep0; row < keep1; row++) {
      const dest = (y0 + row) * width * 4;
      const from = row * width * 4;
      placed.set(src.data.subarray(from, from + width * 4), dest);
      rgba.set(processed.rgba.subarray(from, from + width * 4), dest);
      cutout.set(processed.cutout.subarray(from, from + width * 4), dest);
    }
    if (y0 === 0) semi += processed.semi || 0;
  }
  return { placed, rgba, cutout, semi, bg, ms };
}
