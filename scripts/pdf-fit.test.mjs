import assert from 'node:assert/strict';
import { PDF_FIT_PAD, pdfFitScale, pdfStackEdgePad, pdfStackGap } from '../public/assets/common.js';

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
console.log('pdf fit scale ok');
