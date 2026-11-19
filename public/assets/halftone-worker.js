import { processHalftone, cutoutOnly } from './halftone-core.mjs';

self.onmessage = (e) => {
  const { jobId, bitmap, width, height, settings, mirror, wantCutout } = e.data;
  try {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (mirror) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    const scale = Math.min(width / bitmap.width, height / bitmap.height);
    const dw = Math.max(1, Math.round(bitmap.width * scale));
    const dh = Math.max(1, Math.round(bitmap.height * scale));
    const ox = Math.floor((width - dw) / 2);
    const oy = Math.floor((height - dh) / 2);
    ctx.drawImage(bitmap, ox, oy, dw, dh);
    bitmap.close && bitmap.close();
    const src = ctx.getImageData(0, 0, width, height);
    const placed = new Uint8ClampedArray(src.data);
    const halftone = processHalftone(src.data, width, height, settings);
    const cutout = wantCutout ? cutoutOnly(src.data, width, height, settings) : null;
    const transfer = [placed.buffer, halftone.buffer];
    if (cutout) transfer.push(cutout.buffer);
    self.postMessage({ jobId, width, height, placed, halftone, cutout, capped: e.data.capped }, transfer);
  } catch (err) {
    self.postMessage({ jobId, error: err && err.message ? err.message : 'Could not render the halftone.' });
  }
};
