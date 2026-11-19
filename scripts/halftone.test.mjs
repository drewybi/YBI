import assert from 'assert';
import { readFileSync } from 'fs';
import { autoTolerance, cellPixels, detectBackground, formatLength, outputPixels, processHalftone, pngWithDpi, qualityLabel, substrateById, trueDpi } from '../public/assets/halftone-core.mjs';

function fill(w, h, pixel) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, a] = pixel(x, y);
    const i = (y * w + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
  }
  return data;
}
function alphaAt(data, w, x, y) { return data[(y * w + x) * 4 + 3]; }
function opaqueCount(data, x0, x1, y0, y1, w) {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (alphaAt(data, w, x, y) === 255) n++;
  return n;
}
function assertBinary(data) {
  for (let i = 3; i < data.length; i += 4) assert.ok(data[i] === 0 || data[i] === 255);
}

const black = fill(80, 60, () => [0, 0, 0, 255]);
const bg = detectBackground(black, 80, 60);
assert.ok(bg[0] < 20 && bg[1] < 20 && bg[2] < 20, 'a black edge is detected');
assert.strictEqual(autoTolerance(black, 80, 60, bg), 0.03);

const dark = substrateById('dtf-dark');
assert.strictEqual(dark.dpi, 300);
assert.strictEqual(dark.lpi, 55);
assert.strictEqual(dark.angle, 22.5);
assert.strictEqual(dark.minDotMm, 0.10);
assert.strictEqual(dark.gain, 0);
assert.strictEqual(dark.gamma, 1);
assert.strictEqual(dark.smoothEdge, 0);
assert.strictEqual(dark.screen, 'am');
assert.strictEqual(dark.knockoutTarget, 'blacks');
assert.strictEqual(substrateById('dtf-light').knockoutTarget, 'tones');
assert.strictEqual(substrateById('dtf-cmyk-light').lpi, 45);
assert.strictEqual(substrateById('fm-blue').screen, 'fm');
assert.strictEqual(substrateById('ink-white').ink[0], 255);
assert.strictEqual(substrateById('custom').name, 'Custom');

// MAHE's 7.87 in readout at 300 dpi is the 2-decimal display of a 2362 px side.
const widthIn = 2362 / 300;
assert.strictEqual(formatLength(widthIn, 'in'), '7.87');
assert.strictEqual(outputPixels(widthIn, widthIn, 300).w, 2362);
assert.strictEqual(outputPixels(widthIn, widthIn, 300).h, 2362);
const upscaled = outputPixels(12.5, 12.5, 300);
assert.strictEqual(upscaled.w, 3750, '12.5 in at 300 dpi is 3750 px, with no silent downscale');
assert.strictEqual(upscaled.h, 3750);
assert.strictEqual(upscaled.capped, false);
assert.ok(Math.abs(cellPixels(300, 35) - 8.571428) < 0.001, '35 LPI at 300 dpi is about 8.6 px');
assert.strictEqual(Math.round(trueDpi(3000, widthIn)), 381);
assert.strictEqual(qualityLabel(trueDpi(3000, widthIn)), 'Excellent · 381 dpi');

function boxBlur(src, w, h, radius) {
  const r = Math.max(1, radius | 0);
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < r && x < w; x++) sum += src[y * w + x];
    for (let x = 0; x < w; x++) {
      const add = Math.min(w - 1, x + r);
      const sub = x - r - 1;
      sum += src[y * w + add];
      if (sub >= 0) sum -= src[y * w + sub];
      tmp[y * w + x] = sum / (add - Math.max(0, x - r) + 1);
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y < r && y < h; y++) sum += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const add = Math.min(h - 1, y + r);
      const sub = y - r - 1;
      sum += tmp[add * w + x];
      if (sub >= 0) sum -= tmp[sub * w + x];
      out[y * w + x] = sum / (add - Math.max(0, y - r) + 1);
    }
  }
  return out;
}

// Same construction as the 3000 px reference, at a smaller size: orange ellipse,
// gaussian-style blur, blue square, 10-step grey wedge, on black.
function referenceScene(size) {
  const w = size, h = size;
  const mask = new Float32Array(w * h);
  const x0 = Math.round(size * 0.2), x1 = Math.round(size * 0.8);
  const y0 = Math.round(size * 0.2), y1 = Math.round(size * 0.8);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x - cx) / rx, dy = (y - cy) / ry;
    if (dx * dx + dy * dy <= 1) mask[y * w + x] = 1;
  }
  let soft = mask;
  const radius = Math.max(1, Math.round(size * 0.1));
  for (let i = 0; i < 3; i++) soft = boxBlur(soft, w, h, Math.round(radius / 3));
  const data = fill(w, h, (x, y) => {
    const t = Math.max(0, Math.min(1, soft[y * w + x]));
    let r = Math.round(255 * t), g = Math.round(140 * t), b = Math.round(20 * t);
    const s0 = Math.round(size * 0.4), s1 = Math.round(size * 0.6);
    if (x >= s0 && x < s1 && y >= s0 && y < s1) { r = 30; g = 120; b = 255; }
    const wedgeTop = Math.round(size * 0.9);
    if (y >= wedgeTop) {
      const step = Math.min(9, Math.floor((x / w) * 10));
      const v = Math.round(step * 255 / 9);
      r = g = b = v;
    }
    return [r, g, b, 255];
  });
  return data;
}

const scene = referenceScene(240);
const sceneBg = detectBackground(scene, 240, 240);
const result = processHalftone(scene, 240, 240, {
  ...dark,
  bgColor: sceneBg,
  tolerance: autoTolerance(scene, 240, 240, sceneBg),
  protect: true,
  removeBg: true,
  dpi: 300,
});
assertBinary(result.rgba);
assert.strictEqual(alphaAt(result.rgba, 240, 2, 2), 0, 'the black corner is removed');
const blue = result.rgba.slice((120 * 240 + 120) * 4, (120 * 240 + 120) * 4 + 4);
assert.strictEqual(blue[3], 255, 'the blue square stays ink');
assert.ok(blue[2] > blue[0], 'the square keeps its blue');
const glowDots = opaqueCount(result.rgba, 28, 56, 108, 132, 240);
const glowArea = 28 * 24;
assert.ok(glowDots > 12 && glowDots < glowArea * 0.85, `the glow edge is dotted (${glowDots}/${glowArea})`);
let prev = -1;
for (let step = 2; step <= 8; step++) {
  const x0 = Math.floor(step * 24);
  const count = opaqueCount(result.rgba, x0, x0 + 16, 220, 236, 240);
  assert.ok(count >= prev, `grey step ${step} is at least as dense as the one before (${count} >= ${prev})`);
  prev = count;
}

const ihdr = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(type, 4);
  out.set(data, 8);
  let c = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) {
    c ^= out[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  view.setUint32(8 + data.length, (c ^ 0xffffffff) >>> 0);
  return out;
}
const ihdrChunk = chunk([73, 72, 68, 82], ihdr);
const idatChunk = chunk([73, 68, 65, 84], new Uint8Array([1, 2, 3, 4]));
const iendChunk = chunk([73, 69, 78, 68], new Uint8Array(0));
const base = new Uint8Array(8 + ihdrChunk.length + idatChunk.length + iendChunk.length);
base.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
base.set(ihdrChunk, 8);
base.set(idatChunk, 8 + ihdrChunk.length);
base.set(iendChunk, 8 + ihdrChunk.length + idatChunk.length);
const png = pngWithDpi(base, 300);
let off = 8, saw = false, idat = false;
while (off < png.length) {
  const len = new DataView(png.buffer, png.byteOffset + off, 4).getUint32(0);
  const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
  if (type === 'IDAT') { assert.ok(saw); idat = true; }
  if (type === 'pHYs') {
    assert.strictEqual(new DataView(png.buffer, png.byteOffset + off + 8, 4).getUint32(0), Math.round(300 / 0.0254));
    saw = true;
  }
  if (type === 'IEND') break;
  off += 12 + len;
}
assert.ok(saw && idat);

const studio = readFileSync(new URL('../public/studio.html', import.meta.url), 'utf8');
const review = readFileSync(new URL('../public/review.html', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
assert.ok(studio.includes('/studio/halftone'));
assert.ok(!review.includes('halftone'));
assert.ok(server.includes("'halftone'"));

const art = fill(180, 100, (x, y) => {
  if (x >= 16 && x < 70 && y >= 20 && y < 80) return [20, 70, 220, 255];
  if (x >= 80 && x < 150 && y >= 20 && y < 80) {
    const t = (x - 80) / 69;
    return [Math.round(20 * (1 - t)), Math.round(70 * (1 - t)), Math.round(220 * (1 - t)), 255];
  }
  const dx = x - 40, dy = y - 90;
  const glow = Math.max(0, 1 - Math.hypot(dx, dy) / 18);
  if (glow > 0 && y > 82) return [Math.round(50 * glow), Math.round(50 * glow), Math.round(50 * glow), 255];
  return [0, 0, 0, 255];
});
const screened = processHalftone(art, 180, 100, {
  ...dark, knockoutTarget: 'blacks', blackRange: 45, protectColours: 32, dpi: 300, lpi: 35, tolerance: 0.03, protect: true, removeBg: true,
});
assertBinary(screened.rgba);
const blueArea = 40 * 40;
const blueInk = opaqueCount(screened.rgba, 24, 64, 30, 70, 180);
assert.ok(blueInk > blueArea * 0.98, `solid blue stays solid (${blueInk}/${blueArea})`);
const fadeColour = opaqueCount(screened.rgba, 82, 100, 30, 70, 180);
const fadeBlack = opaqueCount(screened.rgba, 130, 148, 30, 70, 180);
assert.ok(fadeColour > fadeBlack, `a blue-to-black fade screens toward black (${fadeColour} > ${fadeBlack})`);
assert.ok(fadeBlack < 18 * 40 * 0.85, 'the black end of the fade is not a solid plate');
const glowInk = opaqueCount(screened.rgba, 28, 52, 84, 99, 180);
assert.ok(glowInk > 8 && glowInk < 24 * 15, `the black glow becomes dots (${glowInk})`);
const toned = processHalftone(art, 180, 100, {
  ...dark, knockoutTarget: 'tones', dpi: 300, lpi: 35, tolerance: 0.03, protect: true, removeBg: true,
});
const tonedBlue = opaqueCount(toned.rgba, 24, 64, 30, 70, 180);
assert.ok(tonedBlue < blueInk, 'all tones screens the solid blue that blacks-only keeps');

console.log('halftone: ok');
