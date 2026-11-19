import assert from 'assert';
import { readFileSync } from 'fs';
import { processHalftone, pngWithDpi, fitPagePixels } from '../public/assets/halftone-core.mjs';

function fill(w, h, pixel) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
    }
  }
  return data;
}
function alphaAt(data, w, x, y) {
  return data[(y * w + x) * 4 + 3];
}
function opaqueCount(data, x0, x1, y0, y1, w) {
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (alphaAt(data, w, x, y) === 255) n++;
  return n;
}
function assertBinary(data) {
  for (let i = 3; i < data.length; i += 4) assert.ok(data[i] === 0 || data[i] === 255, 'alpha is only clear or solid');
}

const solid = fill(24, 24, () => [210, 24, 24, 255]);
const solidOut = processHalftone(solid, 24, 24, { bgMode: 'keep', solid: 50, shading: 80, lpi: 40, dpi: 300, angle: 22.5 });
assertBinary(solidOut);
assert.strictEqual(opaqueCount(solidOut, 0, 24, 0, 24, 24), 24 * 24, 'a flat saturated colour stays solid');
assert.strictEqual(solidOut[0], 210);

const fade = fill(80, 40, x => [40, 40, 40, Math.round((x / 79) * 255)]);
const fadeOut = processHalftone(fade, 80, 40, { bgMode: 'keep', shading: 0, lpi: 35, dpi: 300, angle: 22.5, solid: 92, minDot: 8, choke: 0 });
assertBinary(fadeOut);
const faint = opaqueCount(fadeOut, 0, 20, 0, 40, 80);
const strong = opaqueCount(fadeOut, 60, 80, 0, 40, 80);
assert.ok(strong > faint, `the solid end of a fade has more ink (${strong} > ${faint})`);

const grey = fill(48, 48, x => {
  const v = Math.round((x / 47) * 255);
  return [v, v, v, 255];
});
const greyOut = processHalftone(grey, 48, 48, { bgMode: 'keep', shading: 100, lpi: 30, dpi: 240, angle: 0, solid: 96, minDot: 10, choke: 0 });
assertBinary(greyOut);
const darkInk = opaqueCount(greyOut, 0, 16, 0, 48, 48);
const lightInk = opaqueCount(greyOut, 32, 48, 0, 48, 48);
assert.ok(darkInk > lightInk, `neutral shading dots the dark end harder (${darkInk} > ${lightInk})`);

const glow = fill(80, 40, (x, y) => {
  if (x > 58 && x < 74 && y > 12 && y < 28) return [255, 246, 230, 255];
  if (x > 10 && x < 50) {
    const t = (x - 10) / 40;
    return [Math.round(255 * t), Math.round(160 * t), Math.round(40 * t), 255];
  }
  return [0, 0, 0, 255];
});
const glowOut = processHalftone(glow, 80, 40, { bgMode: 'auto', tolerance: 10, softness: 48, shading: 40, knockout: true, knockoutStrength: 40, shirt: [0, 0, 0], lpi: 28, dpi: 180, angle: 0, solid: 92, minDot: 6, choke: 0 });
assertBinary(glowOut);
assert.ok(opaqueCount(glowOut, 60, 72, 14, 26, 80) > 70, 'a flat cream mark on black stays inked');
const glowEdge = opaqueCount(glowOut, 10, 22, 0, 40, 80);
const glowHot = opaqueCount(glowOut, 34, 48, 0, 40, 80);
assert.ok(glowHot > glowEdge, `a glow is denser at the bright end (${glowHot} > ${glowEdge})`);
assert.ok(glowEdge > 0 && glowEdge < 12 * 40, 'the faint end of a glow is dotted, not a solid plate');

const keyed = fill(48, 48, (x, y) => (x > 16 && x < 32 && y > 16 && y < 32 ? [20, 20, 20, 255] : [250, 250, 250, 255]));
const keyedOut = processHalftone(keyed, 48, 48, { bgMode: 'auto', tolerance: 18, softness: 4, shading: 100, lpi: 40, dpi: 300, solid: 80, minDot: 0, choke: 0 });
assert.strictEqual(alphaAt(keyedOut, 48, 1, 1), 0, 'a white edge is removed');
assert.strictEqual(alphaAt(keyedOut, 48, 24, 24), 255, 'the mark on that white field stays');

const split = fill(32, 16, x => (x < 16 ? [0, 0, 0, 255] : [245, 245, 245, 255]));
const splitOut = processHalftone(split, 32, 16, { bgMode: 'keep', knockout: true, knockoutStrength: 100, shirt: [0, 0, 0], shading: 0, solid: 50, minDot: 0, choke: 0, lpi: 20, dpi: 100 });
assert.strictEqual(alphaAt(splitOut, 32, 2, 8), 0, 'shirt knockout clears black');
assert.strictEqual(alphaAt(splitOut, 32, 24, 8), 255, 'shirt knockout keeps the light ink');

const page = fitPagePixels(329, 483, 600);
assert.ok(page.w * page.h <= 40e6, 'A3+ at 600 DPI stays under the pixel cap');
assert.strictEqual(page.capped, true);

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
const empty = new Uint8Array(0);
const ihdrChunk = chunk([73, 72, 68, 82], ihdr);
const idatChunk = chunk([73, 68, 65, 84], new Uint8Array([1, 2, 3, 4]));
const iendChunk = chunk([73, 69, 78, 68], empty);
const base = new Uint8Array(8 + ihdrChunk.length + idatChunk.length + iendChunk.length);
base.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
base.set(ihdrChunk, 8);
base.set(idatChunk, 8 + ihdrChunk.length);
base.set(iendChunk, 8 + ihdrChunk.length + idatChunk.length);
const png = pngWithDpi(base, 300);
let off = 8;
let saw = false;
let sawIdat = false;
while (off < png.length) {
  const len = new DataView(png.buffer, png.byteOffset + off, 4).getUint32(0);
  const type = String.fromCharCode(png[off + 4], png[off + 5], png[off + 6], png[off + 7]);
  if (type === 'IDAT') {
    assert.ok(saw, 'pHYs is written before the pixels so printers read the DPI');
    sawIdat = true;
  }
  if (type === 'pHYs') {
    const ppm = new DataView(png.buffer, png.byteOffset + off + 8, 4).getUint32(0);
    assert.strictEqual(ppm, Math.round(300 / 0.0254));
    assert.strictEqual(png[off + 16], 1);
    saw = true;
  }
  if (type === 'IEND') break;
  off += 12 + len;
}
assert.ok(saw && sawIdat, 'PNG gains a pHYs chunk ahead of the pixels');

const studio = readFileSync(new URL('../public/studio.html', import.meta.url), 'utf8');
const review = readFileSync(new URL('../public/review.html', import.meta.url), 'utf8');
const server = readFileSync(new URL('../server.js', import.meta.url), 'utf8');
assert.ok(studio.includes('/studio/halftone'), 'studio nav links to halftone');
assert.ok(!review.includes('halftone'), 'the client proof page does not mention halftone');
assert.ok(server.includes("'halftone'"), 'halftone is a reserved job number');

console.log('halftone: ok');
