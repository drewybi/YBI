// Shared helpers + proof viewer (PDF.js vendored in /vendor/pdfjs)
export const B = window.BASE || '';
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const STATUS = { draft: 'No proof yet', awaiting_review: 'Awaiting review', changes_requested: 'Changes requested', approved: 'Approved' };
export const chip = s => `<span class="chip chip--${s}">${STATUS[s] || s}</span>`;
export const fmtDate = iso => iso ? new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
export const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

export async function api(url, opts = {}) {
  const o = { ...opts, headers: { ...(opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) } };
  const r = await fetch(url, o); let j = null; try { j = await r.json(); } catch {}
  if (!r.ok) throw Object.assign(new Error((j && j.error) || r.statusText), { status: r.status });
  return j;
}
// raw-body upload with progress
export function upload(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest(); x.open('POST', url);
    x.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    x.upload.onprogress = e => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
    x.onload = () => { let j = null; try { j = JSON.parse(x.responseText); } catch {} x.status < 300 ? resolve(j) : reject(new Error((j && j.error) || 'Upload failed')); };
    x.onerror = () => reject(new Error('Network error during upload'));
    x.send(file);
  });
}
let tt; export function toast(t) { let el = $('.toast'); if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.append(el); } el.textContent = t; el.classList.add('on'); clearTimeout(tt); tt = setTimeout(() => el.classList.remove('on'), 2400); }
export async function copy(text) { try { await navigator.clipboard.writeText(text); } catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); } toast('Link copied'); }

// drop-zone wiring: el contains <input type=file>; calls onFiles(FileList)
export function dropzone(el, onFiles) {
  const inp = $('input[type=file]', el);
  el.addEventListener('click', e => { if (e.target !== inp) inp.click(); });
  el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
  inp.addEventListener('change', () => { if (inp.files.length) onFiles([...inp.files]); inp.value = ''; });
  ['dragenter', 'dragover'].forEach(t => el.addEventListener(t, e => { e.preventDefault(); el.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach(t => el.addEventListener(t, e => { e.preventDefault(); el.classList.remove('is-over'); }));
  el.addEventListener('drop', e => e.dataTransfer.files.length && onFiles([...e.dataTransfer.files]));
}

let pdfjsP;
const pdfjs = () => pdfjsP ||= import(B + '/vendor/pdfjs/pdf.min.mjs').then(m => { m.GlobalWorkerOptions.workerSrc = B + '/vendor/pdfjs/pdf.worker.min.mjs'; return m; });

const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Harry Hogge strip from ybicreative.com.au. Plays once per page load; later renders (dashboard poll) stay open.
export function harryStrip() {
  const instant = prefersReduced() || document.documentElement.dataset.harry === '1';
  const src = `${B}/assets/img`;
  return `<section class="hstrip rv-strip${instant ? ' is-in' : ''}" data-hstrip>
    <div class="hstrip__media"><img src="${src}/harry-1280.webp" srcset="${src}/harry-640.webp 640w, ${src}/harry-1280.webp 1280w, ${src}/harry-1920.webp 1920w, ${src}/harry-2560.webp 2560w" sizes="100vw" width="2560" height="958" alt="Pit crew chief in a black and yellow City Chevrolet race suit and headset on pit road, from Days of Thunder" decoding="async" style="object-position:62% 40%"></div>
    <div class="wrap hstrip__in"><p class="hstrip__t" aria-label="We're dropping the hammer Harry..."><span class="w" aria-hidden="true"><span style="--i:0">We're</span></span> <span class="w" aria-hidden="true"><span style="--i:1">dropping</span></span> <span class="w" aria-hidden="true"><span style="--i:2">the</span></span> <span class="w" aria-hidden="true"><span style="--i:3">hammer</span></span> <span class="w" aria-hidden="true"><span class="ol" style="--i:4">Harry...</span></span></p></div>
  </section>`;
}
export function mountHarry(root = document) {
  root.querySelectorAll('.hstrip:not(.is-in)').forEach(el => {
    const arm = () => { el.classList.add('is-in'); document.documentElement.dataset.harry = '1'; };
    // Two frames so the closed clip-path / word offset paints before the transition.
    requestAnimationFrame(() => requestAnimationFrame(arm));
  });
}

// Proof viewer. version = { kind:'pdf'|'image', url, originalName }
// ⤢ opens a real viewport-sized stage. opts.place lets the client drop numbered stickies.
// opts.pins = [{id,n,page,x,y,text}] with x/y as 0–1 fractions of the page.
const ZOOMS = [1, 1.35, 1.8, 2.4];
export function pinsFrom(f) {
  return (f?.stickies || []).map(s => ({ id: `${f.id}-${s.n}`, n: s.n, page: s.page || 1, x: +s.x, y: +s.y, text: s.text || '' }));
}
export async function mountViewer(root, version, opts = {}) {
  if (window.__ybiViewerClean) window.__ybiViewerClean();
  const fileUrl = version.url;
  const dl = fileUrl + (fileUrl.includes('?') ? '&' : '?') + 'download';
  root.innerHTML = `<div class="viewer" data-viewer-root>
    <div class="viewer__bar">
      <div class="grp"><button class="ibtn" type="button" data-prev aria-label="Previous page">‹</button><span class="pg" data-pg>—</span><button class="ibtn" type="button" data-next aria-label="Next page">›</button></div>
      <div class="grp"><span class="small dim" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(version.originalName)}</span><span class="pin-hint" data-hint hidden>Click or tap the proof to mark a change</span></div>
      <div class="grp">
        <button class="ibtn" type="button" data-zout aria-label="Zoom out" title="Zoom out">−</button>
        <button class="ibtn" type="button" data-zin aria-label="Zoom in" title="Zoom in">+</button>
        <button class="ibtn" type="button" data-expand aria-pressed="false" aria-label="Full screen" title="Full screen">⤢</button>
        <a class="ibtn" href="${dl}" aria-label="Download" title="Download file" style="text-decoration:none">↓</a>
        <a class="ibtn" href="${fileUrl}" target="_blank" rel="noopener" aria-label="Open in new tab" title="Open in new tab" style="text-decoration:none">↗</a>
      </div>
    </div>
    <div class="stage" data-stage><span class="loading">Loading proof…</span></div>
    <div class="pin-dock" data-dock hidden><span class="note__n" data-dock-n>1</span><textarea data-dock-text rows="2" placeholder="What should change here?"></textarea><button type="button" class="note__x" data-dock-del aria-label="Remove this note">✕</button></div>
    <div class="thumbs" data-thumbs hidden></div></div>`;
  const viewer = $('[data-viewer-root]', root), stage = $('[data-stage]', root), pg = $('[data-pg]', root);
  const prev = $('[data-prev]', root), next = $('[data-next]', root), thumbs = $('[data-thumbs]', root);
  const expandBtn = $('[data-expand]', root), zin = $('[data-zin]', root), zout = $('[data-zout]', root);
  const hint = $('[data-hint]', root), dock = $('[data-dock]', root), dockText = $('[data-dock-text]', root), dockN = $('[data-dock-n]', root);
  let zoomLevel = 0, expanded = false, render = null, page = 1, n = 1, lastKey = '';
  let pins = (opts.pins || []).slice(), active = opts.active || null;
  const placing = !!opts.place;

  const syncZoom = () => {
    zin.disabled = zoomLevel >= ZOOMS.length - 1;
    zout.disabled = zoomLevel <= 0;
    stage.classList.toggle('is-zoomed', zoomLevel > 0);
    const label = zoomLevel === 0 ? 'Fit width' : Math.round(ZOOMS[zoomLevel] * 100) + '%';
    zin.title = `Zoom in (${label})`;
    zout.title = `Zoom out (${label})`;
  };
  const setZoom = dir => {
    const z = Math.min(ZOOMS.length - 1, Math.max(0, zoomLevel + dir));
    if (z === zoomLevel) return;
    zoomLevel = z; syncZoom(); if (render) render();
  };
  zin.onclick = () => setZoom(1);
  zout.onclick = () => setZoom(-1);
  syncZoom();

  const setExpanded = on => {
    expanded = on;
    viewer.classList.toggle('is-fs', on);
    document.body.classList.toggle('viewer-open', on);
    expandBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    expandBtn.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen');
    expandBtn.title = on ? 'Exit full screen (Esc)' : 'Full screen';
    expandBtn.innerHTML = on ? '✕<span class="fs-x">Close</span>' : '⤢';
    if (on) expandBtn.focus();
    requestAnimationFrame(() => requestAnimationFrame(() => { if (render) render(); }));
  };
  expandBtn.onclick = () => setExpanded(!expanded);

  const onDocKey = e => {
    if (!expanded) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Escape') { e.preventDefault(); setExpanded(false); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prev.click(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); next.click(); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); setZoom(1); }
    else if (e.key === '-' || e.key === '_') { e.preventDefault(); setZoom(-1); }
  };
  document.addEventListener('keydown', onDocKey);
  root.tabIndex = 0;
  root.addEventListener('keydown', e => {
    if (expanded) return;
    if (e.key === 'ArrowLeft') prev.click();
    if (e.key === 'ArrowRight') next.click();
  });

  const availBox = () => {
    const cs = getComputedStyle(stage);
    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    return { w: Math.max(200, stage.clientWidth - padX), h: Math.max(200, stage.clientHeight - padY) };
  };
  let roTimer, lastBox = '';
  const ro = new ResizeObserver(() => {
    const key = stage.clientWidth + 'x' + stage.clientHeight;
    if (key === lastBox) return;
    lastBox = key;
    clearTimeout(roTimer);
    roTimer = setTimeout(() => { if (root.isConnected && render) render(); }, 60);
  });
  ro.observe(stage);
  window.__ybiViewerClean = () => {
    document.removeEventListener('keydown', onDocKey);
    clearTimeout(roTimer);
    ro.disconnect();
    document.body.classList.remove('viewer-open');
    window.__ybiViewerClean = null;
  };

  const sheetOf = () => $('[data-sheet]', stage);
  function layoutPins() {
    const sheet = sheetOf();
    if (!sheet) return;
    $$('.pin', sheet).forEach(el => el.remove());
    pins.filter(p => (p.page || 1) === page).forEach(p => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pin' + (p.id === active ? ' on' : '');
      b.dataset.id = p.id;
      b.style.left = (p.x * 100) + '%';
      b.style.top = (p.y * 100) + '%';
      b.textContent = p.n;
      b.title = p.text ? `${p.n}. ${p.text}` : `Note ${p.n}`;
      b.setAttribute('aria-label', b.title);
      b.onclick = e => { e.stopPropagation(); e.preventDefault(); select(p.id); };
      sheet.append(b);
    });
    if (hint) hint.hidden = !placing || pins.length > 0;
    syncDock();
  }
  function focusPin(id) {
    const el = sheetOf()?.querySelector(`.pin[data-id="${CSS.escape(id)}"]`);
    if (!el) return;
    const sr = stage.getBoundingClientRect(), er = el.getBoundingClientRect();
    if (er.top < sr.top + 8 || er.bottom > sr.bottom - 8) stage.scrollTop += er.top - sr.top - sr.height / 2 + er.height / 2;
    if (er.left < sr.left + 8 || er.right > sr.right - 8) stage.scrollLeft += er.left - sr.left - sr.width / 2 + er.width / 2;
  }
  function syncDock() {
    const p = pins.find(x => x.id === active);
    const show = !!(placing && expanded && p);
    dock.hidden = !show;
    if (!p) return;
    dockN.textContent = p.n;
    if (document.activeElement !== dockText) dockText.value = p.text || '';
  }
  function ensureSheet(node) {
    const existing = node.parentElement && node.parentElement.matches?.('[data-sheet]') ? node.parentElement : null;
    if (existing && existing.parentElement === stage) { existing.classList.toggle('is-place', placing); layoutPins(); return existing; }
    const sheet = document.createElement('div');
    sheet.className = 'sheet'; sheet.dataset.sheet = '';
    sheet.classList.toggle('is-place', placing);
    sheet.addEventListener('click', e => {
      if (!placing || e.target.closest('.pin')) return;
      const r = sheet.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      if (x < 0 || y < 0 || x > 1 || y > 1) return;
      opts.onPlace && opts.onPlace({ page, x, y });
    });
    sheet.append(node);
    stage.replaceChildren(sheet);
    layoutPins();
    return sheet;
  }
  async function select(id) {
    active = id;
    const p = pins.find(x => x.id === id);
    if (p && (p.page || 1) !== page && version.kind === 'pdf' && p.page >= 1 && p.page <= n) {
      page = p.page; lastKey = ''; await render();
    } else layoutPins();
    focusPin(id);
    opts.onSelect && opts.onSelect(id);
  }
  dockText.oninput = () => { const p = pins.find(x => x.id === active); if (p) { p.text = dockText.value; opts.onText && opts.onText(dockText.value); } };
  $('[data-dock-del]', root).onclick = () => opts.onRemove && opts.onRemove(active);
  const api = {
    setPins(list) { pins = (list || []).slice(); if (active && !pins.some(p => p.id === active)) active = null; layoutPins(); },
    select,
    setText(id, text) { const p = pins.find(x => x.id === id); if (p) p.text = text; const el = sheetOf()?.querySelector(`.pin[data-id="${CSS.escape(id)}"]`); if (el) el.title = text ? `${p.n}. ${text}` : `Note ${p.n}`; if (id === active) syncDock(); },
    focusDock() { if (!expanded) return; dock.hidden = false; syncDock(); dockText.focus(); }
  };
  // Hand the api over before the first await so a click during thumbnail load uses this viewer.
  opts.onReady && opts.onReady(api);

  if (version.kind === 'image') {
    prev.hidden = next.hidden = true; stage.classList.add('is-image');
    const img = new Image(); img.alt = version.originalName || 'Proof'; img.src = version.url;
    render = () => {
      if (!img.naturalWidth || !stage.clientWidth) return;
      const box = availBox();
      const fitW = box.w / img.naturalWidth, fitH = box.h / img.naturalHeight;
      // Inline shows the whole image. Full screen (and zoom) fit the width, same as PDFs, so a tall proof can be read large.
      const fit = (expanded || zoomLevel > 0) ? fitW : Math.min(fitW, fitH);
      img.style.width = Math.max(1, Math.round(img.naturalWidth * fit * ZOOMS[zoomLevel])) + 'px';
      img.style.height = 'auto';
    };
    img.onload = () => { pg.textContent = `${img.naturalWidth}×${img.naturalHeight}px`; ensureSheet(img); render(); };
    img.onerror = () => { stage.innerHTML = '<span class="loading">Could not load image.</span>'; };
    return api;
  }

  const lib = await pdfjs();
  const doc = await lib.getDocument(version.url).promise;
  n = doc.numPages; let busy = 0;
  render = async () => {
    const my = ++busy;
    const p = await doc.getPage(page);
    if (my !== busy || !stage.clientWidth) return;
    const base = p.getViewport({ scale: 1 });
    const box = availBox();
    let css = (box.w / base.width) * ZOOMS[zoomLevel];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const long = Math.max(base.width, base.height) * css * dpr;
    if (long > 4500) css *= 4500 / long;
    const key = page + ':' + Math.round(css * dpr * 10);
    if (key === lastKey && stage.querySelector('canvas')) { pg.textContent = `Page ${page} / ${n}`; return; }
    const vp = p.getViewport({ scale: css * dpr });
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
    c.style.width = (c.width / dpr) + 'px'; c.style.height = 'auto';
    await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    if (my !== busy) return;
    lastKey = key;
    ensureSheet(c);
    pg.textContent = `Page ${page} / ${n}`; prev.disabled = page <= 1; next.disabled = page >= n;
    $$('canvas', thumbs).forEach((t, i) => t.classList.toggle('on', i + 1 === page));
  };
  prev.onclick = () => { if (page > 1) { page--; lastKey = ''; render(); } };
  next.onclick = () => { if (page < n) { page++; lastKey = ''; render(); } };
  if (n === 1) prev.hidden = next.hidden = true;
  await render();
  if (n > 1) {
    thumbs.hidden = false;
    for (let i = 1; i <= Math.min(n, 60); i++) {
      const p = await doc.getPage(i); const vp = p.getViewport({ scale: 168 / p.getViewport({ scale: 1 }).height });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.title = 'Page ' + i;
      c.onclick = () => { page = i; lastKey = ''; render(); };
      thumbs.append(c); await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      if (i === page) c.classList.add('on');
    }
    if (expanded) { lastKey = ''; render(); }
  }
  return api;
}
