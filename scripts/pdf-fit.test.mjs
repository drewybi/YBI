import assert from 'node:assert/strict';
import { PDF_FIT_PAD, imageFitScale, pdfFitScale, pdfStackEdgePad, pdfStackGap } from '../public/assets/common.js';

const pageW = 595.28, pageH = 841.89;
const boxW = 900, boxH = 700;
const scale = pdfFitScale(pageW, pageH, boxW, boxH, 1);
const cssW = pageW * scale, cssH = pageH * scale;
assert.ok(cssW < boxW && cssH < boxH, 'fitted page is inside the stage');
const side = Math.min((boxW - cssW) / boxW, (boxH - cssH) / boxH);
const expectSide = 1 - 1 / PDF_FIT_PAD;
assert.ok(Math.abs(side - expectSide) < 0.012, `tight-axis leftover ${side} should be about ${expectSide}`);
assert.equal(pdfFitScale(pageW, pageH, boxW, boxH, 1.35), scale * 1.35);
assert.equal(pdfFitScale(0, pageH, boxW, boxH, 1), 0);

const wide = pdfFitScale(1000, 400, 800, 900, 1);
const wideW = 1000 * wide;
assert.ok(Math.abs(wideW / 800 - 1 / PDF_FIT_PAD) < 0.001, 'a wide page fits the width, then pulls back');
const H = 780, P = 780 / PDF_FIT_PAD;
const oldBand = pdfStackEdgePad(H, P) * 2;
assert.equal(pdfStackGap(H, P), oldBand / 4);
assert.ok(Math.abs(pdfStackEdgePad(H, P) - (H - P) / 2) < 0.01, 'edge pad still centres the fitted page');
assert.equal(pdfStackGap(H, H + 40), 0);

// A page smaller than the stage stays at native size (1 CSS px per PDF point).
// 100 × 70 mm. The old fit would enlarge it to fill the padded stage.
const mm = n => n * 72 / 25.4;
const small = pdfFitScale(mm(100), mm(70), boxW, boxH, 1);
assert.equal(small, 1, 'a small page is capped at native 100%');
assert.ok(mm(100) < boxW && mm(70) < boxH);
assert.equal(pdfFitScale(mm(100), mm(70), boxW, boxH, 1.35), 1.35, 'manual zoom still multiplies past 100%');
assert.equal(pdfFitScale(mm(100), mm(70), boxW, boxH, 2.4), 2.4);

// Padding still applies when that scale is under 100%. Width is the tight axis.
const padPage = 800, padBox = 900;
const padded = pdfFitScale(padPage, 200, padBox, 900, 1);
assert.ok(padded < 1, 'a large page still scales down');
assert.ok(Math.abs(padPage * padded / padBox - 1 / PDF_FIT_PAD) < 0.001, 'large pages keep the fit padding');
const atCap = pdfFitScale(padBox / PDF_FIT_PAD, 20, padBox, 900, 1);
assert.ok(Math.abs(atCap - 1) < 1e-9, 'the cap starts where padded fit reaches native size');
const justUnder = pdfFitScale(padBox / PDF_FIT_PAD - 1, 20, padBox, 900, 1);
assert.equal(justUnder, 1, 'a page that would upscale even a little stays at 100%');

// Images. Inline fits both axes. Full screen and zoom fit the width. Neither grows past native pixels.
assert.equal(imageFitScale(400, 300, 900, 700, 1, false), 1, 'a small image stays at native size inline');
assert.equal(imageFitScale(400, 300, 900, 700, 1, true), 1, 'a small image stays at native size full screen');
assert.equal(imageFitScale(400, 300, 500, 900, 1, false), 1, 'width that would upscale is capped');
assert.equal(imageFitScale(400, 300, 900, 700, 1.35, true), 1.35, 'image zoom multiplies the capped fit');
assert.equal(imageFitScale(400, 300, 900, 700, 2.4, false), 2.4);
const bigInline = imageFitScale(2000, 3000, 800, 600, 1, false);
assert.ok(Math.abs(bigInline - Math.min(800 / 2000, 600 / 3000)) < 1e-9, 'a large image scales down to fit');
const bigFs = imageFitScale(2000, 3000, 800, 600, 1, true);
assert.ok(Math.abs(bigFs - 800 / 2000) < 1e-9, 'full screen still fits the width of a large image');
assert.ok(Math.abs(imageFitScale(3000, 400, 800, 900, 1, false) - 800 / 3000) < 1e-9, 'a wide image scales down');
assert.equal(imageFitScale(0, 300, 800, 600, 1), 0);
assert.equal(imageFitScale(400, 300, 0, 600, 1), 0);

console.log('pdf fit scale ok');
