// Studio download: the proof with numbered sticky markers, plus a checklist
// page of fillable checkboxes (one per change) that staff can tick on screen or in print.
'use strict';
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const INK = rgb(0.035, 0.035, 0.04);
const CREAM = rgb(0.976, 0.973, 0.965);
const GOLD = rgb(0.91, 0.76, 0.48);
const MUTE = rgb(0.42, 0.41, 0.39);
const LINE = rgb(0.75, 0.74, 0.72);

const pdfText = s => String(s || '')
  .replace(/[\u2018\u2019\u2032]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/\u2026/g, '...')
  .replace(/\u00A0/g, ' ')
  .replace(/[^\x09\x0A\x0D\x20-\xFF]/g, '');

function wrap(font, text, size, maxWidth) {
  const words = pdfText(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? line + ' ' + word : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
    else {
      if (line) lines.push(line);
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        let chunk = '';
        for (const ch of word) {
          if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth) { if (chunk) lines.push(chunk); chunk = ch; }
          else chunk += ch;
        }
        line = chunk;
      } else line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function drawMarker(page, font, n, x, y) {
  const r = 11;
  page.drawCircle({ x, y, size: r, color: GOLD, borderColor: INK, borderWidth: 1.4 });
  const label = String(n);
  const tw = font.widthOfTextAtSize(label, 10);
  page.drawText(label, { x: x - tw / 2, y: y - 3.5, size: 10, font, color: INK });
  return r;
}

function drawCallout(page, font, text, mx, my, pageW, pageH) {
  const size = 8;
  const cardW = Math.min(210, Math.max(120, pageW * 0.38));
  const inner = cardW - 12;
  let lines = wrap(font, text, size, inner);
  let clipped = false;
  if (lines.length > 5) { lines = lines.slice(0, 5); lines[4] = lines[4].replace(/\.?$/, '...'); clipped = true; }
  const cardH = 10 + lines.length * 11;
  let x = mx + 18;
  let y = my - cardH / 2;
  if (x + cardW > pageW - 10) x = mx - 18 - cardW;
  if (x < 10) x = 10;
  if (y < 10) y = 10;
  if (y + cardH > pageH - 10) y = pageH - 10 - cardH;
  page.drawRectangle({ x, y, width: cardW, height: cardH, color: CREAM, borderColor: INK, borderWidth: 0.8, opacity: 0.96 });
  lines.forEach((ln, i) => page.drawText(ln, { x: x + 6, y: y + cardH - 14 - i * 11, size, font, color: INK }));
  const tipY = Math.min(y + cardH - 4, Math.max(y + 4, my));
  page.drawLine({ start: { x: mx + (x > mx ? 12 : -12), y: my }, end: { x: x > mx ? x : x + cardW, y: tipY }, thickness: 0.7, color: INK });
  return clipped;
}

function annotatePage(page, font, bold, stickies) {
  const { width, height } = page.getSize();
  const here = stickies.filter(s => (s.page || 1) === page.refPage);
  here.forEach(s => {
    const x = Math.min(width - 14, Math.max(14, s.x * width));
    const y = Math.min(height - 14, Math.max(14, height - s.y * height));
    drawMarker(page, bold, s.n, x, y);
    drawCallout(page, font, s.text, x, y, width, height);
  });
}

function addChecklist(pdf, font, bold, meta, items) {
  const W = 595.28, H = 841.89, M = 46;
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const newPage = () => { page = pdf.addPage([W, H]); y = H - M; };
  const rule = () => { page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: LINE }); y -= 16; };
  page.drawText('YBI CREATIVE', { x: M, y, size: 9, font: bold, color: MUTE });
  y -= 22;
  page.drawText('Changes to make', { x: M, y, size: 22, font: bold, color: INK });
  y -= 18;
  const sub = pdfText(`Job ${meta.jobNumber}  ·  V${meta.version}  ·  ${meta.clientName || ''}${meta.requester ? '  ·  from ' + meta.requester : ''}`);
  wrap(font, sub, 10, W - M * 2).forEach(ln => { page.drawText(ln, { x: M, y, size: 10, font, color: MUTE }); y -= 14; });
  y -= 6;
  page.drawText('Tick the box when that change is done. Numbers match the markers on the proof.', { x: M, y, size: 9, font, color: MUTE });
  y -= 16;
  rule();
  const form = pdf.getForm();
  items.forEach(item => {
    const textW = W - M * 2 - 78;
    const lines = wrap(font, item.text, 11, textW);
    const block = Math.max(28, 8 + lines.length * 14);
    if (y - block < M) { newPage(); page.drawText('Changes to make  ·  continued', { x: M, y, size: 12, font: bold, color: INK }); y -= 22; }
    const box = form.createCheckBox(item.field);
    box.addToPage(page, { x: M, y: y - 16, width: 14, height: 14, borderWidth: 1, borderColor: INK, backgroundColor: rgb(1, 1, 1) });
    const badge = String(item.n);
    page.drawCircle({ x: M + 36, y: y - 9, size: 10, color: GOLD, borderColor: INK, borderWidth: 0.8 });
    const bw = bold.widthOfTextAtSize(badge, 9);
    page.drawText(badge, { x: M + 36 - bw / 2, y: y - 12.2, size: 9, font: bold, color: INK });
    page.drawText(item.where, { x: M + 54, y: y - 4, size: 8, font: bold, color: MUTE });
    lines.forEach((ln, i) => page.drawText(ln, { x: M + 54, y: y - 18 - i * 14, size: 11, font, color: INK }));
    y -= block + 14;
  });
}

async function loadProof(pdf, kind, bytes, ext) {
  if (kind === 'pdf') return PDFDocument.load(bytes, { ignoreEncryption: false });
  const doc = await PDFDocument.create();
  const image = /png$/i.test(ext) ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  const pageW = 595.28, pageH = 841.89, margin = 28;
  const scale = Math.min((pageW - margin * 2) / image.width, (pageH - margin * 2) / image.height);
  const dw = image.width * scale, dh = image.height * scale;
  const page = doc.addPage([pageW, pageH]);
  const ox = (pageW - dw) / 2, oy = (pageH - dh) / 2;
  page.drawImage(image, { x: ox, y: oy, width: dw, height: dh });
  // Map pin fractions onto the image rectangle, not the paper margin.
  page._ybiImageBox = { ox, oy, dw, dh };
  return doc;
}

async function buildChangesPdf({ kind, bytes, ext, stickies, meta }) {
  const pdf = await loadProof(null, kind, bytes, ext);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pages = pdf.getPages();
  pages.forEach((page, i) => { page.refPage = i + 1; });
  if (pages.length === 1 && pages[0]._ybiImageBox) {
    const box = pages[0]._ybiImageBox;
    const page = pages[0];
    stickies.forEach(s => {
      const x = box.ox + Math.min(0.98, Math.max(0.02, s.x)) * box.dw;
      const y = box.oy + (1 - Math.min(0.98, Math.max(0.02, s.y))) * box.dh;
      drawMarker(page, bold, s.n, x, y);
      drawCallout(page, font, s.text, x, y, page.getSize().width, page.getSize().height);
    });
  } else {
    pages.forEach(page => annotatePage(page, font, bold, stickies));
  }
  const items = [];
  if (meta.note) items.push({ n: '·', field: `ybi_${meta.feedbackId}_note`, where: 'GENERAL NOTE', text: meta.note });
  stickies.forEach(s => items.push({
    n: s.n,
    field: `ybi_${meta.feedbackId}_${s.n}`,
    where: `PAGE ${s.page || 1}`,
    text: s.text
  }));
  addChecklist(pdf, font, bold, meta, items);
  pdf.getForm().updateFieldAppearances(font);
  return Buffer.from(await pdf.save());
}

module.exports = { buildChangesPdf };
