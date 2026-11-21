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
const MASTHEAD = path.join(__dirname, 'public/assets/img/engine-masthead.jpg');
// Same colours as :root in public/assets/app.css: --bg, --g, --dim, --ink.
const BG = rgb(9 / 255, 9 / 255, 10 / 255);
const ACCENT = rgb(167 / 255, 169 / 255, 172 / 255);
const DIM = rgb(111 / 255, 108 / 255, 103 / 255);
const PAPER = rgb(243 / 255, 241 / 255, 236 / 255);
const INK = rgb(9 / 255, 9 / 255, 10 / 255);
const MUTE = rgb(0.33, 0.32, 0.31);
const HAIR = rgb(0.82, 0.82, 0.84);
const ZEBR = rgb(0.96, 0.96, 0.97);
const MUTE_C = rgb(167 / 255, 164 / 255, 158 / 255);
const FOOT_BG = rgb(6 / 255, 6 / 255, 7 / 255);
const FOOT_RULE = rgb(44 / 255, 43 / 255, 43 / 255);
const SERVICES = 'Fleet & Commercial Signage • Hand Painted Truck Art & Signage • Custom Graphics & Wrapping';

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
function siteLabel(brand) {
  return String(brand.siteLabel || 'www.ybifx.com').replace(/^https?:\/\//, '');
}
function trackedWidth(text, font, size, tracking) {
  let w = 0;
  for (const ch of text) w += font.widthOfTextAtSize(ch, size) + tracking;
  return w - (text ? tracking : 0);
}
function drawTracked(page, text, x, y, size, font, color, tracking) {
  let cx = x;
  for (const ch of text) {
    page.drawText(ch, { x: cx, y, size, font, color });
    cx += font.widthOfTextAtSize(ch, size) + tracking;
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
  const margin = 40;
  // Printed YBI masthead: short dark bar, logo left, Quote. on the right.
  // FX wordmark uses the print height (38px). Contact lives in the footer.
  const pad = 8 * 72 / 96;
  const logoH = 38 * 72 / 96;
  const titleSize = 1.7 * 12;
  const headerH = pad * 2 + logoH;
  page.drawRectangle({ x: 0, y: height - headerH, width, height: headerH, color: BG });
  if (fs.existsSync(MASTHEAD)) {
    const mast = await pdf.embedJpg(fs.readFileSync(MASTHEAD));
    page.drawImage(mast, { x: 0, y: height - headerH, width, height: headerH });
  }
  const rowMid = height - headerH / 2;
  if (fs.existsSync(LOCKUP)) {
    const png = await pdf.embedPng(fs.readFileSync(LOCKUP));
    const logoW = logoH * (png.width / png.height);
    page.drawImage(png, { x: margin, y: rowMid - logoH / 2, width: logoW, height: logoH });
  }
  const title = 'QUOTE';
  const titleW = display.widthOfTextAtSize(title, titleSize);
  const dotW = display.widthOfTextAtSize('.', titleSize);
  const titleX = width - margin - titleW - dotW;
  const titleY = rowMid - titleSize * 0.32;
  page.drawText(title, { x: titleX, y: titleY, size: titleSize, font: display, color: PAPER });
  page.drawText('.', { x: titleX + titleW, y: titleY, size: titleSize, font: display, color: ACCENT });

  let y = height - headerH - 28;
  const no = String(quote.quoteNo || `Q-V${quote.version || 1}`);
  const noW = display.widthOfTextAtSize(no, 11);
  page.drawText(no, { x: width - margin - noW, y, size: 11, font: display, color: INK });
  y -= 4;

  const meta = [
    ['Date', showDay(quote.date)],
    ['Valid until', showDay(quote.validUntil)]
  ];
  for (const [label, value] of meta) {
    page.drawText(label.toUpperCase(), { x: 40, y, size: 8, font: display, color: DIM });
    page.drawText(value || '—', { x: 130, y: y - 1, size: 10, font: sans, color: INK });
    y -= 16;
  }
  y -= 10;

  const colW = (width - 80) / 2;
  page.drawText('PREPARED FOR', { x: 40, y, size: 8, font: display, color: DIM });
  page.drawText('FROM', { x: 40 + colW, y, size: 8, font: display, color: DIM });
  y -= 16;
  const prepared = [quote.client, quote.contactName, quote.clientEmail].filter(Boolean);
  const from = [
    brand.name || 'YBI FX',
    brand.address,
    brand.phone ? `Office ${brand.phone}` : '',
    brand.direct ? `Direct ${brand.direct}` : '',
    brand.email ? `Email ${brand.email}` : '',
    siteLabel(brand) ? `Website ${siteLabel(brand)}` : ''
  ].filter(Boolean);
  const blockRows = Math.max(prepared.length, from.length, 1);
  for (let i = 0; i < blockRows; i++) {
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
  page.drawText('DESCRIPTION', { x: xDesc, y, size: 8, font: display, color: DIM });
  page.drawText('QTY', { x: xQty, y, size: 8, font: display, color: DIM });
  const priceLabel = 'UNIT PRICE';
  const priceHeadX = 430;
  page.drawText(priceLabel, { x: priceHeadX, y, size: 8, font: display, color: DIM });
  const amtLabel = 'AMOUNT';
  page.drawText(amtLabel, { x: tableR - display.widthOfTextAtSize(amtLabel, 8), y, size: 8, font: display, color: DIM });
  y -= 8;
  page.drawRectangle({ x: xDesc, y, width: tableR - xDesc, height: 0.6, color: ACCENT });
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
      page.drawRectangle({ x: boxX - 0.4, y: boxBottom - 0.4, width: boxW + 0.8, height: 28, color: BG });
      page.drawText(label.toUpperCase(), { x: boxX + 10, y: boxBottom + 8, size: 8, font: display, color: PAPER });
      const vw = display.widthOfTextAtSize(value, 11);
      page.drawText(value, { x: boxX + boxW - 10 - vw, y: boxBottom + 7, size: 11, font: display, color: PAPER });
    } else {
      page.drawText(label, { x: boxX + 10, y: ty, size: 9, font: sans, color: MUTE });
      const vw = sans.widthOfTextAtSize(value, 10);
      page.drawText(value, { x: boxX + boxW - 10 - vw, y: ty, size: 10, font: bold, color: INK });
      ty -= 18;
    }
  }

  const servicesSize = 7.5;
  const servicesMax = width - margin * 2;
  let tracking = servicesSize * 0.08;
  if (trackedWidth(SERVICES, sans, servicesSize, tracking) > servicesMax) {
    const bare = trackedWidth(SERVICES, sans, servicesSize, 0);
    tracking = Math.max(0, (servicesMax - bare) / Math.max(1, SERVICES.length - 1));
  }
  const footCol = servicesMax / 3;
  const lineSize = 8;
  const lead = 11.5;
  const addressLines = String(brand.address || '').split(/,\s*/).filter(Boolean);
  const cols = [
    { label: 'YBI FX', lines: addressLines.map(t => ({ t, c: MUTE_C })) },
    { label: 'PHONE', lines: [brand.phone && { t: `Office ${brand.phone}`, c: PAPER }, brand.direct && { t: `Direct ${brand.direct}`, c: PAPER }].filter(Boolean) },
    { label: 'GET IN TOUCH', lines: [brand.email && { t: `Email ${brand.email}`, c: PAPER }, siteLabel(brand) && { t: `Website ${siteLabel(brand)}`, c: PAPER }].filter(Boolean) }
  ];
  const bodyLines = Math.max(...cols.map(col => col.lines.length), 1);
  const padFoot = 16;
  const footH = padFoot + 16 + bodyLines * lead + 14 + servicesSize + padFoot;
  page.drawRectangle({ x: 0, y: 0, width, height: footH, color: FOOT_BG });
  const labelY = footH - padFoot - 2;
  cols.forEach((col, i) => {
    const x = margin + i * footCol;
    if (col.label) drawTracked(page, col.label, x, labelY, 6.2, sans, DIM, 6.2 * 0.2);
    col.lines.forEach((line, n) => {
      page.drawText(line.t, { x, y: labelY - 16 - n * lead, size: lineSize, font: sans, color: line.c });
    });
  });
  const ruleY = padFoot + servicesSize + 10;
  page.drawRectangle({ x: margin, y: ruleY, width: servicesMax, height: 0.6, color: FOOT_RULE });
  drawTracked(page, SERVICES, margin, padFoot, servicesSize, sans, DIM, tracking);

  const notes = [];
  if (quote.notes) notes.push(...wrap(quote.notes, sans, 8, width - 80));
  if (quote.terms) notes.push(...wrap(quote.terms, sans, 8, width - 80));
  let fy = footH + 16 + notes.slice(0, 4).length * 11;
  for (const line of notes.slice(0, 4)) {
    fy -= 11;
    page.drawText(line, { x: margin, y: fy, size: 8, font: sans, color: MUTE });
  }
  return Buffer.from(await pdf.save());
}

module.exports = { buildQuotePdf };
