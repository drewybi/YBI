// YBI FX site-survey PDF. Same masthead, type and services footer as the FX quote.
'use strict';
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');

const DISPLAY = path.join(__dirname, 'public/assets/fonts/archivo-800-ext.ttf');
const SANS = path.join(__dirname, 'public/assets/fonts/work-sans-regular.ttf');
const SANS_BOLD = path.join(__dirname, 'public/assets/fonts/work-sans-semibold.ttf');
const LOCKUP = path.join(__dirname, 'public/assets/img/ybifx-logo-white.png');
const MASTHEAD = path.join(__dirname, 'public/assets/img/engine-masthead.jpg');
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

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;

function showDay(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return '';
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
  return lines;
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
function fit(text, font, size, width) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (font.widthOfTextAtSize(raw, size) <= width) return raw;
  let s = raw;
  while (s.length > 1 && font.widthOfTextAtSize(s + '...', size) > width) s = s.slice(0, -1);
  return s + '...';
}
function ascii(text) {
  return String(text || '').replace(/[^\u0020-\u007e]/g, '').replace(/\s+/g, ' ').trim();
}
function paint(page, text, opts) {
  const clean = String(text || '').replace(/\s+/g, ' ');
  if (!clean) return;
  try { page.drawText(clean, opts); }
  catch { const plain = ascii(clean); if (plain) page.drawText(plain, opts); }
}

async function buildSurveyPdf(survey, brand) {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const display = await pdf.embedFont(fs.readFileSync(DISPLAY), { subset: true });
  const sans = await pdf.embedFont(fs.readFileSync(SANS), { subset: true });
  const bold = await pdf.embedFont(fs.readFileSync(SANS_BOLD), { subset: true });
  const logoBytes = fs.existsSync(LOCKUP) ? fs.readFileSync(LOCKUP) : null;
  const logo = logoBytes ? await pdf.embedPng(logoBytes) : null;
  const mastBytes = fs.existsSync(MASTHEAD) ? fs.readFileSync(MASTHEAD) : null;
  const mast = mastBytes ? await pdf.embedJpg(mastBytes) : null;

  const pad = 8 * 72 / 96;
  const logoH = 78 * (126 / 300) * 72 / 96;
  const headerH = pad * 2 + logoH;
  const servicesText = SERVICES.toUpperCase();
  const servicesSize = 8;
  const servicesMax = PAGE_W - MARGIN * 2;
  let tracking = servicesSize * 0.14;
  if (trackedWidth(servicesText, sans, servicesSize, tracking) > servicesMax) {
    const bare = trackedWidth(servicesText, sans, servicesSize, 0);
    tracking = Math.max(0, (servicesMax - bare) / Math.max(1, servicesText.length - 1));
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
  const contentW = PAGE_W - MARGIN * 2;

  let page = null;
  let y = 0;
  let pageNo = 0;

  function drawFooter(pg) {
    pg.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: footH, color: FOOT_BG });
    const labelY = footH - padFoot - 2;
    cols.forEach((col, i) => {
      const x = MARGIN + i * footCol;
      if (col.label) drawTracked(pg, col.label, x, labelY, 7, sans, DIM, 7 * 0.26);
      col.lines.forEach((line, n) => {
        paint(pg, line.t, { x, y: labelY - 16 - n * lead, size: lineSize, font: sans, color: line.c });
      });
    });
    const ruleY = padFoot + servicesSize + 10;
    pg.drawRectangle({ x: MARGIN, y: ruleY, width: servicesMax, height: 0.6, color: FOOT_RULE });
    drawTracked(pg, servicesText, MARGIN, padFoot, servicesSize, sans, DIM, tracking);
  }
  function drawMast(pg) {
    pg.drawRectangle({ x: 0, y: PAGE_H - headerH, width: PAGE_W, height: headerH, color: BG });
    if (mast) pg.drawImage(mast, { x: 0, y: PAGE_H - headerH, width: PAGE_W, height: headerH });
    const rowMid = PAGE_H - headerH / 2;
    if (logo) {
      const logoW = logoH * (logo.width / logo.height);
      pg.drawImage(logo, { x: MARGIN, y: rowMid - logoH / 2, width: logoW, height: logoH });
    }
    const title = 'SURVEY';
    const titleSize = 1.7 * 12;
    const titleTrack = -titleSize * 0.015;
    const titleW = trackedWidth(title, display, titleSize, titleTrack);
    const dotW = display.widthOfTextAtSize('.', titleSize);
    const titleX = PAGE_W - MARGIN - titleW - dotW;
    const titleY = rowMid - titleSize * 0.32;
    drawTracked(pg, title, titleX, titleY, titleSize, display, PAPER, titleTrack);
    pg.drawText('.', { x: titleX + titleW, y: titleY, size: titleSize, font: display, color: ACCENT });
  }
  function drawSlim(pg) {
    const bar = 28;
    pg.drawRectangle({ x: 0, y: PAGE_H - bar, width: PAGE_W, height: bar, color: BG });
    if (logo) {
      const h = 14;
      const w = h * (logo.width / logo.height);
      pg.drawImage(logo, { x: MARGIN, y: PAGE_H - bar + (bar - h) / 2, width: w, height: h });
    }
    const who = fit(survey.client || 'Site survey', sans, 9, 280);
    paint(pg, who, { x: MARGIN + 78, y: PAGE_H - 18, size: 9, font: sans, color: PAPER });
    const tag = `SURVEY  ·  ${pageNo}`;
    const tw = sans.widthOfTextAtSize(tag, 8);
    paint(pg, tag, { x: PAGE_W - MARGIN - tw, y: PAGE_H - 18, size: 8, font: sans, color: ACCENT });
  }
  function addPage(continued) {
    page = pdf.addPage([PAGE_W, PAGE_H]);
    pageNo += 1;
    drawFooter(page);
    if (!continued) {
      drawMast(page);
      y = PAGE_H - headerH - 26;
    } else {
      drawSlim(page);
      y = PAGE_H - 28 - 22;
    }
  }
  function need(h) {
    if (y - h < footH + 14) addPage(true);
  }
  function text(value, x, yy, size, font, color) {
    paint(page, value, { x, y: yy, size, font, color });
  }
  function block(value, size, font, color, gap) {
    const lines = wrap(value, font, size, contentW);
    for (const line of lines) {
      need(size + gap);
      text(line, MARGIN, y, size, font, color);
      y -= size + gap;
    }
  }
  function labelValue(x, width, label, value) {
    text(String(label || '').toUpperCase(), x, y, 7, bold, DIM);
    text(fit(value || '—', sans, 10, width - 4), x, y - 13, 10, sans, INK);
  }

  addPage(false);
  const no = String(survey.surveyNo || 'SV');
  const noW = bold.widthOfTextAtSize(no, 11);
  text(no, PAGE_W - MARGIN - noW, y, 11, bold, INK);
  y -= 4;
  const meta = [
    ['Date', showDay(survey.date)],
    ['Surveyor', survey.surveyor || '—'],
    ['Job', survey.jobNumber || '—']
  ];
  for (const [label, value] of meta) {
    text(label.toUpperCase(), MARGIN, y, 8, bold, DIM);
    text(fit(value, sans, 10, contentW - 100), 130, y - 1, 10, sans, INK);
    y -= 16;
  }
  y -= 8;

  const colW = contentW / 2;
  text('PREPARED FOR', MARGIN, y, 8, bold, DIM);
  text('FROM', MARGIN + colW, y, 8, bold, DIM);
  y -= 16;
  const prepared = [survey.client, survey.contact, survey.address, survey.gps].filter(Boolean);
  const from = [
    brand.name || 'YBI FX',
    brand.address,
    brand.phone ? `Office ${brand.phone}` : '',
    brand.direct ? `Direct ${brand.direct}` : '',
    brand.email ? `Email ${brand.email}` : '',
    siteLabel(brand) ? `Website ${siteLabel(brand)}` : ''
  ].filter(Boolean);
  const rows = Math.max(prepared.length, from.length, 1);
  for (let i = 0; i < rows; i++) {
    need(14);
    if (prepared[i]) text(fit(prepared[i], i === 0 ? bold : sans, 10, colW - 16), MARGIN, y, 10, i === 0 ? bold : sans, INK);
    if (from[i]) text(fit(from[i], i === 0 ? bold : sans, 10, colW - 8), MARGIN + colW, y, 10, i === 0 ? bold : sans, INK);
    y -= 14;
  }
  if (survey.notes) {
    y -= 8;
    block(survey.notes, 10, sans, MUTE, 3);
  }

  const signs = Array.isArray(survey.signs) ? survey.signs : [];
  if (signs.length > 1) {
    y -= 12;
    need(36);
    text('SIGNS', MARGIN, y, 8, bold, DIM);
    y -= 10;
    page.drawRectangle({ x: MARGIN, y, width: contentW, height: 0.6, color: ACCENT });
    y -= 16;
    signs.forEach((sign, i) => {
      need(18);
      if (i % 2 === 0) page.drawRectangle({ x: MARGIN, y: y - 5, width: contentW, height: 18, color: ZEBR });
      const n = String(i + 1).padStart(2, '0');
      text(n, MARGIN + 4, y, 9, bold, INK);
      text(fit(sign.name || 'Sign', sans, 9, 180), MARGIN + 28, y, 9, sans, INK);
      text(fit(sign.typeLabel || '', sans, 9, 80), MARGIN + 220, y, 9, sans, MUTE);
      text(fit(sign.sizeLabel || '—', sans, 9, 140), MARGIN + 310, y, 9, sans, INK);
      const qty = `× ${sign.quantity || 1}`;
      const qw = sans.widthOfTextAtSize(qty, 9);
      text(qty, MARGIN + contentW - qw - 6, y, 9, sans, INK);
      y -= 18;
    });
  }

  for (let i = 0; i < signs.length; i++) {
    const sign = signs[i];
    y -= 18;
    need(78);
    const n = String(i + 1).padStart(2, '0');
    text(`SIGN ${n}`, MARGIN, y, 13, display, INK);
    const name = fit(sign.name || 'Sign', bold, 12, contentW - 90);
    const nameW = bold.widthOfTextAtSize(name, 12);
    text(name, MARGIN + contentW - nameW, y, 12, bold, INK);
    y -= 8;
    page.drawRectangle({ x: MARGIN, y, width: contentW, height: 0.7, color: ACCENT });
    y -= 20;

    const pairs = [
      ['Type', sign.typeLabel || '—'],
      ['Quantity', String(sign.quantity || 1)],
      ['Width', sign.widthMm ? `${sign.widthMm} mm` : '—'],
      ['Height', sign.heightMm ? `${sign.heightMm} mm` : '—'],
      ['Install height', sign.installHeightMm ? `${sign.installHeightMm} mm` : '—'],
      ['Depth', sign.depthMm ? `${sign.depthMm} mm` : '—'],
      ['Illumination', sign.lightLabel || '—'],
      ['Surface', sign.substrate || '—']
    ];
    for (let p = 0; p < pairs.length; p += 2) {
      need(30);
      labelValue(MARGIN, colW - 12, pairs[p][0], pairs[p][1]);
      if (pairs[p + 1]) labelValue(MARGIN + colW, colW - 8, pairs[p + 1][0], pairs[p + 1][1]);
      y -= 32;
    }
    if (sign.location) {
      need(22);
      text('PLACEMENT', MARGIN, y, 7, bold, DIM);
      y -= 14;
      block(sign.location, 10, sans, INK, 3);
      y -= 4;
    }
    if (sign.access) {
      need(22);
      text('ACCESS', MARGIN, y, 7, bold, DIM);
      y -= 14;
      block(sign.access, 10, sans, INK, 3);
      y -= 4;
    }
    if (sign.notes) {
      need(22);
      text('NOTES', MARGIN, y, 7, bold, DIM);
      y -= 14;
      block(sign.notes, 10, sans, MUTE, 3);
      y -= 4;
    }

    const photos = Array.isArray(sign.photos) ? sign.photos : [];
    for (let pi = 0; pi < photos.length; pi++) {
      const photo = photos[pi];
      let img = null;
      try { img = await pdf.embedJpg(photo.bytes); }
      catch { /* skip a file that is not a JPEG */ }
      if (!img) continue;
      let w = contentW;
      let h = w * (img.height / img.width);
      const cap = 340;
      if (h > cap) { h = cap; w = h * (img.width / img.height); }
      const blockH = h + 28;
      if (y - blockH < footH + 14) addPage(true);
      const x = MARGIN + (contentW - w) / 2;
      page.drawRectangle({ x: x - 1, y: y - h - 1, width: w + 2, height: h + 2, borderColor: HAIR, borderWidth: 0.8 });
      page.drawImage(img, { x, y: y - h, width: w, height: h });
      y -= h + 14;
      const capBits = [`Photo ${pi + 1}`];
      if (photo.annotated) capBits.push('marked up');
      if (Array.isArray(photo.labels) && photo.labels.length) capBits.push(photo.labels.join(', '));
      const capText = capBits.join(' · ');
      text(capText, MARGIN, y, 8, sans, DIM);
      y -= 16;
    }
    if (!photos.length) {
      need(16);
      text('No photos on this sign.', MARGIN, y, 9, sans, DIM);
      y -= 16;
    }
  }

  if (!signs.length) {
    y -= 16;
    need(16);
    text('No signs recorded yet.', MARGIN, y, 10, sans, MUTE);
  }

  return Buffer.from(await pdf.save());
}

module.exports = { buildSurveyPdf };
