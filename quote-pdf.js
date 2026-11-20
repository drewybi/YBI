// Branded quote PDF. Headings use the self-hosted Archivo Black Italic
// at width 125, the free face that matches the YBI FX logo tagline.
'use strict';
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const FONT = path.join(__dirname, 'public/assets/fonts/archivo-black-italic-ext.ttf');
const LOGO = path.join(__dirname, 'public/assets/img/ybifx-logo.png');
const BLUE = rgb(0 / 255, 119 / 255, 195 / 255);
const PINK = rgb(240 / 255, 0 / 255, 144 / 255);
const INK = rgb(0.06, 0.06, 0.07);
const MUTE = rgb(0.35, 0.34, 0.33);

function aud(cents) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format((Number(cents) || 0) / 100);
}
function wrap(text, font, size, width) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

async function buildQuotePdf(quote, totals, brand) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fs.readFileSync(FONT), { subset: true });
  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  let y = height - 36;
  if (brand.id === 'fx' && fs.existsSync(LOGO)) {
    const png = await pdf.embedPng(fs.readFileSync(LOGO));
    const logoW = 210;
    const logoH = logoW * (png.height / png.width);
    page.drawImage(png, { x: 40, y: y - logoH, width: logoW, height: logoH });
    y -= logoH + 8;
  } else {
    page.drawText(brand.name || 'YBI', { x: 40, y: y - 18, size: 18, font, color: INK });
    y -= 28;
  }
  page.drawRectangle({ x: 40, y: y - 3, width: 250, height: 3, color: BLUE });
  page.drawRectangle({ x: 290, y: y - 3, width: 265, height: 3, color: PINK });
  y -= 28;
  page.drawText(`QUOTE  V${quote.version || 1}`, { x: 40, y, size: 22, font, color: INK });
  y -= 22;
  const meta = [
    `Client  ${quote.client || ''}`,
    quote.contactName ? `Contact  ${quote.contactName}` : '',
    `Date  ${quote.date || ''}`,
    `Valid  ${quote.validity || ''}`,
  ].filter(Boolean);
  for (const line of meta) {
    page.drawText(line, { x: 40, y, size: 10, font, color: INK });
    y -= 14;
  }
  y -= 6;
  const desc = wrap(quote.description || '', font, 10, width - 80);
  for (const line of desc.slice(0, 6)) {
    page.drawText(line, { x: 40, y, size: 10, font, color: MUTE });
    y -= 13;
  }
  y -= 8;
  page.drawText('Description', { x: 40, y, size: 9, font, color: BLUE });
  page.drawText('Qty', { x: 360, y, size: 9, font, color: BLUE });
  page.drawText('Price', { x: 410, y, size: 9, font, color: BLUE });
  page.drawText('Amount', { x: 480, y, size: 9, font, color: BLUE });
  y -= 6;
  page.drawRectangle({ x: 40, y, width: width - 80, height: 1, color: PINK });
  y -= 16;
  const lines = (totals.lines || []).filter(line => String(line.description || '').trim() || String(line.price || '').trim());
  for (const line of lines) {
    if (y < 120) break;
    const name = wrap(line.description || '—', font, 10, 300)[0];
    page.drawText(name, { x: 40, y, size: 10, font, color: INK });
    page.drawText(String(line.qty || '1'), { x: 360, y, size: 10, font, color: INK });
    page.drawText(line.price ? String(line.price) : '—', { x: 410, y, size: 10, font, color: INK });
    page.drawText(aud(line.amount), { x: 470, y, size: 10, font, color: INK });
    y -= 16;
  }
  y -= 8;
  const totalsRows = [
    ['Subtotal ex GST', aud(totals.subtotal)],
    ['GST 10%', aud(totals.gst)],
    ['Total inc GST', aud(totals.total)],
  ];
  for (const [label, value] of totalsRows) {
    page.drawText(label, { x: 360, y, size: 10, font, color: label.startsWith('Total') ? PINK : INK });
    page.drawText(value, { x: 470, y, size: 10, font, color: INK });
    y -= 16;
  }
  const foot = [];
  if (quote.notes) foot.push(...wrap(quote.notes, font, 9, width - 80));
  if (quote.terms) foot.push(...wrap(quote.terms, font, 9, width - 80));
  foot.push(brand.id === 'fx'
    ? 'YBI FX  ·  51 Pratts Park Road, Bendigo VIC  ·  (03) 5444 2127  ·  fx@ybicreative.com.au'
    : 'YBI Creative  ·  Bendigo VIC  ·  Williamstown SA');
  y = Math.min(y - 10, 96);
  for (const line of foot.slice(0, 8)) {
    page.drawText(line, { x: 40, y, size: 8, font, color: MUTE });
    y -= 11;
  }
  return Buffer.from(await pdf.save());
}

module.exports = { buildQuotePdf };
