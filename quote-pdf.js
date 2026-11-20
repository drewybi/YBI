// YBI FX quote PDF. Archivo Black Italic (width 125) for the title, section
// labels and totals. Work Sans for the details, line items and terms.
'use strict';
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const DISPLAY = path.join(__dirname, 'public/assets/fonts/archivo-black-italic-ext.ttf');
const SANS = path.join(__dirname, 'public/assets/fonts/work-sans-regular.ttf');
const SANS_BOLD = path.join(__dirname, 'public/assets/fonts/work-sans-semibold.ttf');
const LOCKUP = path.join(__dirname, 'public/assets/img/ybifx-logo-white.png');
const CYAN = rgb(0 / 255, 196 / 255, 238 / 255);
const CYAN_RGB = [0, 196, 238];
const GREY_RGB = [168, 170, 174];
const INK = rgb(0.07, 0.07, 0.08);
const MUTE = rgb(0.33, 0.32, 0.31);
const HAIR = rgb(0.82, 0.82, 0.84);
const ZEBR = rgb(0.96, 0.96, 0.97);
const WHITE = rgb(1, 1, 1);
const BLACK = rgb(0.035, 0.035, 0.04);

const aud = cents => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format((Number(cents) || 0) / 100);
function showDay(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return iso || '';
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}
function wrap(text, font, size, width) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [];
}
function mix(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }
function gradientBar(page, x, y, w, h) {
  const n = 90;
  const stops = [GREY_RGB, CYAN_RGB];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const c = mix(stops[0], stops[1], t);
    page.drawRectangle({ x: x + (w * i) / n, y, width: (w / n) + 0.35, height: h, color: rgb(c[0] / 255, c[1] / 255, c[2] / 255) });
  }
}

async function buildQuotePdf(quote, brand) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const display = await pdf.embedFont(fs.readFileSync(DISPLAY), { subset: true });
  const sans = await pdf.embedFont(fs.readFileSync(SANS), { subset: true });
  const bold = await pdf.embedFont(fs.readFileSync(SANS_BOLD), { subset: true });
  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const headerH = 45 * 72 / 25.4;
  page.drawRectangle({ x: 0, y: height - headerH, width, height: headerH, color: BLACK });
  if (fs.existsSync(LOCKUP)) {
    const png = await pdf.embedPng(fs.readFileSync(LOCKUP));
    const logoH = headerH - 36;
    const logoW = logoH * (png.width / png.height);
    const maxW = width - 80;
    const w = Math.min(logoW, maxW);
    const h = w * (png.height / png.width);
    page.drawImage(png, { x: 40, y: height - headerH + (headerH - h) / 2, width: w, height: h });
  }
  const ruleY = height - headerH - 4;
  gradientBar(page, 0, ruleY, width, 3.2);

  let y = ruleY - 36;
  page.drawText('QUOTE', { x: 40, y, size: 26, font: display, color: INK });
  const no = String(quote.quoteNo || `Q-V${quote.version || 1}`);
  const noW = display.widthOfTextAtSize(no, 11);
  page.drawText(no, { x: width - 40 - noW, y: y + 4, size: 11, font: display, color: CYAN });
  y -= 28;

  const meta = [
    ['Date', showDay(quote.date)],
    ['Valid until', showDay(quote.validUntil)]
  ];
  for (const [label, value] of meta) {
    page.drawText(label.toUpperCase(), { x: 40, y, size: 8, font: display, color: CYAN });
    page.drawText(value || '—', { x: 130, y: y - 1, size: 10, font: sans, color: INK });
    y -= 16;
  }
  y -= 10;

  const colW = (width - 80) / 2;
  page.drawText('PREPARED FOR', { x: 40, y, size: 8, font: display, color: CYAN });
  page.drawText('FROM', { x: 40 + colW, y, size: 8, font: display, color: CYAN });
  y -= 16;
  const prepared = [quote.client, quote.contactName, quote.clientEmail].filter(Boolean);
  const from = [brand.name || 'YBI FX', brand.address, brand.phone, brand.email].filter(Boolean);
  const rows = Math.max(prepared.length, from.length, 1);
  for (let i = 0; i < rows; i++) {
    if (prepared[i]) page.drawText(prepared[i], { x: 40, y, size: 10, font: i === 0 ? bold : sans, color: INK });
    if (from[i]) page.drawText(from[i], { x: 40 + colW, y, size: 10, font: i === 0 ? bold : sans, color: INK });
    y -= 14;
  }
  if (quote.description) {
    y -= 6;
    for (const line of wrap(quote.description, sans, 10, width - 80).slice(0, 3)) {
      page.drawText(line, { x: 40, y, size: 10, font: sans, color: MUTE });
      y -= 13;
    }
  }
  y -= 16;

  const xDesc = 40, xQty = 318, tableR = width - 40;
  page.drawText('DESCRIPTION', { x: xDesc, y, size: 8, font: display, color: CYAN });
  page.drawText('QTY', { x: xQty, y, size: 8, font: display, color: CYAN });
  const priceLabel = 'UNIT PRICE';
  const priceHeadX = 430;
  page.drawText(priceLabel, { x: priceHeadX, y, size: 8, font: display, color: CYAN });
  const amtLabel = 'AMOUNT';
  page.drawText(amtLabel, { x: tableR - display.widthOfTextAtSize(amtLabel, 8), y, size: 8, font: display, color: CYAN });
  y -= 8;
  page.drawRectangle({ x: xDesc, y, width: tableR - xDesc, height: 0.6, color: CYAN });
  y -= 4;

  const lines = (quote.lines || []).filter(line => String(line.description || '').trim() || String(line.price || '').trim());
  lines.forEach((line, i) => {
    const rowH = 22;
    y -= rowH;
    if (i % 2 === 0) page.drawRectangle({ x: xDesc, y: y - 6, width: tableR - xDesc, height: rowH, color: ZEBR });
    const name = wrap(line.description || '—', sans, 10, 270)[0] || '—';
    page.drawText(name, { x: xDesc + 6, y: y, size: 10, font: sans, color: INK });
    page.drawText(String(line.qty || '1'), { x: xQty, y, size: 10, font: sans, color: INK });
    const price = line.price ? aud(Math.round(Number(String(line.price).replace(/[$,]/g, '')) * 100)) : '—';
    const amount = aud(line.amount);
    const priceRight = priceHeadX + display.widthOfTextAtSize(priceLabel, 8);
    page.drawText(price, { x: priceRight - sans.widthOfTextAtSize(price, 10), y, size: 10, font: sans, color: INK });
    page.drawText(amount, { x: tableR - sans.widthOfTextAtSize(amount, 10), y, size: 10, font: sans, color: INK });
    page.drawRectangle({ x: xDesc, y: y - 6, width: tableR - xDesc, height: 0.4, color: HAIR });
  });

  y -= 28;
  const boxW = 230;
  const boxX = tableR - boxW;
  const boxH = 78;
  const boxBottom = y - boxH + 18;
  page.drawRectangle({ x: boxX, y: boxBottom, width: boxW, height: boxH, borderColor: HAIR, borderWidth: 0.8 });
  const totals = [
    ['Subtotal ex GST', aud(quote.subtotal), false],
    ['GST 10%', aud(quote.gst), false],
    ['Total inc GST', aud(quote.total), true]
  ];
  let ty = y + 2;
  for (const [label, value, last] of totals) {
    if (last) {
      page.drawRectangle({ x: boxX - 0.4, y: boxBottom - 0.4, width: boxW + 0.8, height: 28, color: CYAN });
      page.drawText(label.toUpperCase(), { x: boxX + 10, y: boxBottom + 8, size: 8, font: display, color: WHITE });
      const vw = display.widthOfTextAtSize(value, 11);
      page.drawText(value, { x: boxX + boxW - 10 - vw, y: boxBottom + 7, size: 11, font: display, color: WHITE });
    } else {
      page.drawText(label, { x: boxX + 10, y: ty, size: 9, font: sans, color: MUTE });
      const vw = sans.widthOfTextAtSize(value, 10);
      page.drawText(value, { x: boxX + boxW - 10 - vw, y: ty, size: 10, font: bold, color: INK });
      ty -= 18;
    }
  }

  const foot = [];
  if (quote.notes) foot.push(...wrap(quote.notes, sans, 8, width - 80));
  if (quote.terms) foot.push(...wrap(quote.terms, sans, 8, width - 80));
  const contact = [brand.name, brand.address, brand.phone, brand.email].filter(Boolean).join('  ·  ');
  foot.push(contact);
  let fy = 78;
  page.drawRectangle({ x: 40, y: fy + 14, width: width - 80, height: 0.6, color: HAIR });
  for (const line of foot.slice(0, 6)) {
    page.drawText(line, { x: 40, y: fy, size: 8, font: sans, color: MUTE });
    fy -= 11;
  }
  return Buffer.from(await pdf.save());
}

module.exports = { buildQuotePdf };
