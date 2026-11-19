import { processHalftone } from './halftone-core.mjs';

self.onmessage = (e) => {
  const { jobId, bitmap, width, height, settings } = e.data;
  try {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    if (bitmap.close) bitmap.close();
    const src = ctx.getImageData(0, 0, width, height);
    const placed = new Uint8ClampedArray(src.data);
    const result = processHalftone(src.data, width, height, settings);
    const transfer = [placed.buffer, result.rgba.buffer];
    if (result.cutout.buffer !== result.rgba.buffer) transfer.push(result.cutout.buffer);
    self.postMessage({
      jobId, width, height, placed,
      rgba: result.rgba,
      cutout: result.cutout,
      semi: result.semi,
      bg: result.bg,
      ms: result.ms,
      capped: e.data.capped,
    }, transfer);
  } catch (err) {
    self.postMessage({ jobId, error: err && err.message ? err.message : 'Could not render the halftone.' });
  }
};
