import { processHalftone, resampleRGBA } from './halftone-core.mjs';

const HARD_CAP = 80_000_000;

self.onmessage = async (e) => {
  const { jobId, bitmap, width, height, settings, purpose } = e.data;
  try {
    if (width < 1 || height < 1 || width * height > HARD_CAP || bitmap.width * bitmap.height > HARD_CAP) {
      throw new Error(`This print is ${width} × ${height} px, which is too large to hold in this browser. Lower the DPI or the print size.`);
    }
    const source = readOriginal(bitmap);
    const pixels = bitmap.width === width && bitmap.height === height
      ? source
      : resampleRGBA(source, bitmap.width, bitmap.height, width, height);
    if (bitmap.close) bitmap.close();
    const placed = new Uint8ClampedArray(pixels);
    const processed = processHalftone(pixels, width, height, settings);
    const transfer = [placed.buffer, processed.rgba.buffer];
    if (processed.cutout.buffer !== processed.rgba.buffer) transfer.push(processed.cutout.buffer);
    self.postMessage({
      jobId, purpose, width, height,
      placed,
      rgba: processed.rgba,
      cutout: processed.cutout,
      semi: processed.semi,
      bg: processed.bg,
      ms: processed.ms,
      full: true,
    }, transfer);
  } catch (err) {
    self.postMessage({ jobId, purpose, error: err && err.message ? err.message : 'Could not render the halftone.' });
  }
};

// Copy the decoded bitmap 1:1. No scaling, so the original pixels are the ones we resample.
function readOriginal(bitmap) {
  const sw = bitmap.width;
  const sh = bitmap.height;
  const data = new Uint8ClampedArray(sw * sh * 4);
  const band = 256;
  for (let y = 0; y < sh; y += band) {
    const n = Math.min(band, sh - y);
    const canvas = new OffscreenCanvas(sw, n);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, y, sw, n, 0, 0, sw, n);
    data.set(ctx.getImageData(0, 0, sw, n).data, y * sw * 4);
  }
  return data;
}
