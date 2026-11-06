// Shared helpers + proof viewer (PDF.js vendored in /vendor/pdfjs)
export const B = (typeof window !== 'undefined' && window.BASE) || '';
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
// Several proof images in one request. The browser sets the multipart boundary.
export function uploadFiles(url, files, onProgress) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    for (const file of files) fd.append('file', file, file.name);
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.upload.onprogress = e => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
    x.onload = () => { let j = null; try { j = JSON.parse(x.responseText); } catch {} x.status < 300 ? resolve(j) : reject(new Error((j && j.error) || 'Upload failed')); };
    x.onerror = () => reject(new Error('Network error during upload'));
    x.send(fd);
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

// Fit the whole page in the stage, then pull back so the tight axis keeps about
// 10% clear on each side (83% of a fit-to-view). Zoom multiplies that base.
export const PDF_FIT_PAD = 1.2;
export function pdfFitScale(pageWidth, pageHeight, boxWidth, boxHeight, zoom = 1) {
  if (!(pageWidth > 0) || !(pageHeight > 0) || !(boxWidth > 0) || !(boxHeight > 0)) return 0;
  return Math.min(boxWidth / pageWidth, boxHeight / pageHeight) / PDF_FIT_PAD * zoom;
}

// Engine header. The film is the ybicreative.com.au hero loop; the still shows if motion is reduced or the video has not started.
export function engineBand(inner) {
  const src = `${B}/assets/img`;
  return `<section class="eband">
    <div class="eband__media" aria-hidden="true"><img class="eband__still" src="${src}/engine-1280.webp" srcset="${src}/engine-640.webp 640w, ${src}/engine-1280.webp 1280w, ${src}/engine-1920.webp 1920w" sizes="100vw" width="1280" height="720" alt=""><video class="eband__vid" autoplay muted loop playsinline preload="metadata" poster="${src}/engine-1280.webp"><source src="${B}/assets/video/engine.mp4" type="video/mp4"></video></div>
    <div class="wrap eband__in">${inner}</div>
  </section>`;
}

// Proof viewer. version = { kind:'pdf'|'image'|'zip', url, originalName, files?, downloadAll? }
// A zip is not shown as pages. Several JPG/PNG files in one version are pages: files = [{ name, url }].
// A multi-page PDF is one vertical stack — scroll the stage to read every page. The default
// scale fits each page in the stage, then pulls back (pdfFitScale) so the page is not edge to edge.
// ⤢ opens a real viewport-sized stage. opts.place lets the client drop numbered stickies.
// opts.pins = [{id,n,page,x,y,text}] with x/y as 0–1 fractions of the page.
const ZOOMS = [1, 1.35, 1.8, 2.4];
export function pinsFrom(f) {
  return (f?.stickies || []).map(s => ({ id: `${f.id}-${s.n}`, n: s.n, page: s.page || 1, x: +s.x, y: +s.y, text: s.text || '' }));
}
export async function mountViewer(root, version, opts = {}) {
  if (window.__ybiViewerClean) window.__ybiViewerClean();
  if (version.kind === 'zip') {
    const name = version.originalName || 'proof.zip';
    const fileUrl = version.url || '';
    const href = fileUrl + (fileUrl.includes('?') ? '&' : '?') + 'download';
    root.innerHTML = `<div class="zipdl" data-viewer-root><span class="k">ZIP file</span><p style="margin:0"><b>${esc(name)}</b></p><p class="small dim" style="margin:6px 0 0">${fmtSize(version.size || 0)}</p><a class="btn" href="${esc(href)}">Download zip</a></div>`;
    const api = { setPins() {}, select() {}, setText() {}, focusDock() {} };
    opts.onReady && opts.onReady(api);
    return api;
  }
  const fileUrl = version.url;
  const imageFiles = version.kind === 'image' && Array.isArray(version.files) ? version.files.filter(f => f && f.url) : [];
  const multiImage = imageFiles.length > 1;
  const dl = multiImage && version.downloadAll ? version.downloadAll : fileUrl + (fileUrl.includes('?') ? '&' : '?') + 'download';
  const dlLabel = multiImage ? 'Download all' : 'Download file';
  root.innerHTML = `<div class="viewer" data-viewer-root>
    <div class="viewer__bar">
      <div class="grp"><button class="ibtn" type="button" data-prev aria-label="Previous page">‹</button><span class="pg" data-pg>—</span><button class="ibtn" type="button" data-next aria-label="Next page">›</button></div>
      <div class="grp"><span class="small dim" data-name style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(multiImage ? imageFiles[0].name : version.originalName)}</span><span class="pin-hint" data-hint hidden>Click or tap the proof to mark a change</span></div>
      <div class="grp">
        <button class="ibtn" type="button" data-zout aria-label="Zoom out" title="Zoom out">−</button>
        <button class="ibtn" type="button" data-zin aria-label="Zoom in" title="Zoom in">+</button>
        <button class="ibtn" type="button" data-expand aria-pressed="false" aria-label="Full screen" title="Full screen">⤢</button>
        <a class="ibtn" data-dl href="${esc(dl)}" aria-label="${dlLabel}" title="${dlLabel}" style="text-decoration:none">↓</a>
        <a class="ibtn" data-open href="${esc(fileUrl)}" target="_blank" rel="noopener" aria-label="Open in new tab" title="Open in new tab" style="text-decoration:none">↗</a>
      </div>
    </div>
    <div class="stage" data-stage><span class="loading">Loading proof…</span></div>
    <div class="pin-dock" data-dock hidden><span class="note__n" data-dock-n>1</span><textarea data-dock-text rows="2" placeholder="What should change here?"></textarea><button type="button" class="note__x" data-dock-del aria-label="Remove this note">✕</button></div>
    <div class="thumbs" data-thumbs hidden></div></div>`;
  const viewer = $('[data-viewer-root]', root), stage = $('[data-stage]', root), pg = $('[data-pg]', root);
  const prev = $('[data-prev]', root), next = $('[data-next]', root), thumbs = $('[data-thumbs]', root);
  const expandBtn = $('[data-expand]', root), zin = $('[data-zin]', root), zout = $('[data-zout]', root);
  const hint = $('[data-hint]', root), dock = $('[data-dock]', root), dockText = $('[data-dock-text]', root), dockN = $('[data-dock-n]', root);
  const nameEl = $('[data-name]', root), openEl = $('[data-open]', root);
  let zoomLevel = 0, expanded = false, render = null, page = 1, n = 1;
  let cancelPdf = () => {};
  let turn = async () => {};
  let touchX = 0, touchY = 0, touchOn = false, swallowClick = false;
  let pins = (opts.pins || []).slice(), active = opts.active || null;
  const placing = !!opts.place;

  const syncZoom = () => {
    zin.disabled = zoomLevel >= ZOOMS.length - 1;
    zout.disabled = zoomLevel <= 0;
    stage.classList.toggle('is-zoomed', zoomLevel > 0);
    const label = zoomLevel === 0 ? (version.kind === 'pdf' ? 'Fit page' : 'Fit width') : Math.round(ZOOMS[zoomLevel] * 100) + '%';
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
  stage.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || zoomLevel > 0 || n < 2) { touchOn = false; return; }
    touchX = e.touches[0].clientX; touchY = e.touches[0].clientY; touchOn = true;
  }, { passive: true });
  stage.addEventListener('touchend', e => {
    if (!touchOn) return;
    touchOn = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchX, dy = t.clientY - touchY;
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    swallowClick = true;
    if (dx < 0) next.click(); else prev.click();
  }, { passive: true });

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
    cancelPdf();
    window.__ybiViewerClean = null;
  };

  function pinButton(id) {
    return stage.querySelector(`.pin[data-id="${CSS.escape(id)}"]`);
  }
  function layoutPins() {
    const list = $$('[data-sheet]', stage);
    if (!list.length) return;
    $$('.pin', stage).forEach(el => el.remove());
    const stacked = list.some(s => s.dataset.page);
    pins.forEach(p => {
      const pg = p.page || 1;
      const sheet = stacked ? list.find(s => +s.dataset.page === pg) : (pg === page ? list[0] : null);
      if (!sheet) return;
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
    const el = pinButton(id);
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
      if (swallowClick) { swallowClick = false; return; }
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
    if (p && (p.page || 1) !== page && p.page >= 1 && p.page <= n) await turn(p.page);
    else layoutPins();
    focusPin(id);
    opts.onSelect && opts.onSelect(id);
  }
  dockText.oninput = () => { const p = pins.find(x => x.id === active); if (p) { p.text = dockText.value; opts.onText && opts.onText(dockText.value); } };
  $('[data-dock-del]', root).onclick = () => opts.onRemove && opts.onRemove(active);
  const api = {
    setPins(list) { pins = (list || []).slice(); if (active && !pins.some(p => p.id === active)) active = null; layoutPins(); },
    select,
    setText(id, text) { const p = pins.find(x => x.id === id); if (p) p.text = text; const el = pinButton(id); if (el && p) el.title = text ? `${p.n}. ${text}` : `Note ${p.n}`; if (id === active) syncDock(); },
    focusDock() { if (!expanded) return; dock.hidden = false; syncDock(); dockText.focus(); }
  };
  // Hand the api over before the first await so a click during thumbnail load uses this viewer.
  opts.onReady && opts.onReady(api);

  if (version.kind === 'image') {
    stage.classList.add('is-image');
    const pages = multiImage ? imageFiles.map(f => ({ name: f.name || 'Image', url: f.url })) : [{ name: version.originalName || 'Proof', url: version.url }];
    n = pages.length;
    let img = null, imgToken = 0;
    const sizeImage = () => {
      if (!img || !img.naturalWidth || !stage.clientWidth) return;
      const box = availBox();
      const fitW = box.w / img.naturalWidth, fitH = box.h / img.naturalHeight;
      // Inline shows the whole image. Full screen (and zoom) fit the width so a tall proof can be read large.
      const fit = (expanded || zoomLevel > 0) ? fitW : Math.min(fitW, fitH);
      img.style.width = Math.max(1, Math.round(img.naturalWidth * fit * ZOOMS[zoomLevel])) + 'px';
      img.style.height = 'auto';
    };
    render = sizeImage;
    const showImage = target => {
      page = target;
      const item = pages[page - 1];
      nameEl.textContent = item.name || '';
      if (openEl) openEl.href = item.url;
      if (n > 1) {
        pg.textContent = `Image ${page} / ${n}`;
        prev.disabled = page <= 1; next.disabled = page >= n;
        $$('img', thumbs).forEach((t, i) => t.classList.toggle('on', i + 1 === page));
      }
      const my = ++imgToken;
      return new Promise(resolve => {
        const el = new Image();
        el.alt = item.name || 'Proof';
        el.onload = () => {
          if (my !== imgToken) return resolve();
          img = el;
          if (n === 1) pg.textContent = `${img.naturalWidth}×${img.naturalHeight}px`;
          ensureSheet(img); sizeImage(); resolve();
        };
        el.onerror = () => { if (my === imgToken) stage.innerHTML = '<span class="loading">Could not load image.</span>'; resolve(); };
        el.src = item.url;
      });
    };
    turn = showImage;
    if (n === 1) prev.hidden = next.hidden = true;
    else {
      prev.onclick = () => { if (page > 1) showImage(page - 1); };
      next.onclick = () => { if (page < n) showImage(page + 1); };
      thumbs.hidden = false;
      pages.forEach((item, i) => {
        const t = document.createElement('img');
        t.src = item.url; t.alt = ''; t.title = item.name || ('Image ' + (i + 1));
        t.onclick = () => showImage(i + 1);
        if (i === 0) t.classList.add('on');
        thumbs.append(t);
      });
    }
    showImage(1);
    return api;
  }

  stage.classList.add('is-pdf');
  const lib = await pdfjs();
  if (!root.isConnected) return api;
  const doc = await lib.getDocument(version.url).promise;
  if (!root.isConnected) return api;
  n = doc.numPages;
  const metas = [];
  const stack = document.createElement('div');
  stack.className = 'pdf-pages';
  stack.dataset.pages = '';
  for (let i = 1; i <= n; i++) {
    const pdfPage = await doc.getPage(i);
    if (!root.isConnected) return api;
    const base = pdfPage.getViewport({ scale: 1 });
    const slot = document.createElement('div');
    slot.className = 'pdf-slot';
    slot.dataset.pageSlot = String(i);
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.dataset.sheet = '';
    sheet.dataset.page = String(i);
    sheet.classList.toggle('is-place', placing);
    sheet.addEventListener('click', e => {
      if (swallowClick) { swallowClick = false; return; }
      if (!placing || e.target.closest('.pin')) return;
      const r = sheet.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      if (x < 0 || y < 0 || x > 1 || y > 1) return;
      page = i;
      updatePager();
      opts.onPlace && opts.onPlace({ page: i, x, y });
    });
    const c = document.createElement('canvas');
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', `Page ${i} of ${n}`);
    sheet.append(c);
    slot.append(sheet);
    stack.append(slot);
    metas.push({ pdfPage, base, canvas: c, slot, key: '', task: null });
  }
  stage.replaceChildren(stack);

  const PDF_MAX_EDGE = 4500;
  let renderGen = 0, scrollLock = false, laidOut = false, paintTimer = 0;
  const updatePager = () => {
    pg.textContent = `Page ${page} / ${n}`;
    prev.disabled = page <= 1;
    next.disabled = page >= n;
    $$('canvas', thumbs).forEach((t, i) => t.classList.toggle('on', i + 1 === page));
  };
  const cssFor = meta => pdfFitScale(meta.base.width, meta.base.height, availBox().w, availBox().h, ZOOMS[zoomLevel]);
  const sizeCanvas = (meta, css) => {
    meta.canvas.style.width = Math.max(1, Math.round(meta.base.width * css)) + 'px';
    meta.canvas.style.height = Math.max(1, Math.round(meta.base.height * css)) + 'px';
  };
  function layoutSlots() {
    const h = Math.max(200, stage.clientHeight);
    for (const m of metas) m.slot.style.minHeight = h + 'px';
  }
  function captureAnchor() {
    const sr = stage.getBoundingClientRect();
    for (const m of metas) {
      const r = m.slot.getBoundingClientRect();
      if (r.bottom > sr.top + 24) {
        return { page: +m.slot.dataset.pageSlot, frac: r.height ? (sr.top - r.top) / r.height : 0 };
      }
    }
    return null;
  }
  function restoreAnchor(a) {
    if (!a) return;
    const slot = stage.querySelector(`[data-page-slot="${a.page}"]`);
    if (!slot) return;
    const r = slot.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    stage.scrollTop += (r.top + a.frac * r.height) - sr.top;
  }
  function visibleIdx() {
    if (n <= 8) return metas.map((_, i) => i);
    const sr = stage.getBoundingClientRect();
    const pad = sr.height || 0;
    const out = [];
    metas.forEach((m, i) => {
      const r = m.slot.getBoundingClientRect();
      if (r.bottom >= sr.top - pad && r.top <= sr.bottom + pad) out.push(i);
    });
    const cur = Math.min(n, Math.max(1, page)) - 1;
    if (!out.includes(cur)) out.push(cur);
    return out;
  }
  async function paintMeta(meta, gen) {
    const css = cssFor(meta);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let renderScale = css * dpr;
    const long = Math.max(meta.base.width, meta.base.height) * renderScale;
    if (long > PDF_MAX_EDGE) renderScale *= PDF_MAX_EDGE / long;
    const key = Math.round(css * 100) + ':' + Math.round(renderScale * 100);
    sizeCanvas(meta, css);
    if (meta.key === key) return;
    if (meta.task && meta.task.cancel) { try { meta.task.cancel(); } catch {} meta.task = null; }
    const vp = meta.pdfPage.getViewport({ scale: renderScale });
    // Paint offscreen so a zoom or resize keeps the current page until the new one is ready.
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(vp.width));
    off.height = Math.max(1, Math.round(vp.height));
    const task = meta.pdfPage.render({ canvasContext: off.getContext('2d'), viewport: vp });
    meta.task = task;
    try { await task.promise; }
    catch (e) {
      if (gen !== renderGen) return;
      if (e && (e.name === 'RenderingCancelledException' || /cancel/i.test(String(e.message || '')))) return;
      throw e;
    }
    if (gen !== renderGen || !meta.canvas.isConnected) return;
    if (meta.task === task) meta.task = null;
    off.style.width = meta.canvas.style.width;
    off.style.height = meta.canvas.style.height;
    off.setAttribute('role', 'img');
    off.setAttribute('aria-label', meta.canvas.getAttribute('aria-label') || '');
    meta.canvas.replaceWith(off);
    meta.canvas = off;
    meta.key = key;
  }
  // One paint runs at a time. A scroll or zoom during it sets paintAgain so the
  // next pass picks up whatever is visible at the newer scale.
  let paintAgain = false, paintPromise = null;
  function requestPaint() {
    paintAgain = true;
    if (!paintPromise) {
      paintPromise = (async () => {
        try {
          while (paintAgain && root.isConnected) {
            paintAgain = false;
            const gen = renderGen;
            for (const i of visibleIdx()) {
              if (!root.isConnected || gen !== renderGen) { paintAgain = true; break; }
              await paintMeta(metas[i], gen);
            }
          }
        } finally {
          paintPromise = null;
          if (paintAgain && root.isConnected) requestPaint();
        }
      })();
    }
    return paintPromise;
  }
  async function renderPdf() {
    const gen = ++renderGen;
    if (!root.isConnected || !stage.clientWidth || !stage.clientHeight) return;
    const anchor = laidOut ? captureAnchor() : null;
    layoutSlots();
    for (const m of metas) sizeCanvas(m, cssFor(m));
    laidOut = true;
    if (anchor) {
      scrollLock = true;
      restoreAnchor(anchor);
      scrollLock = false;
    }
    updatePager();
    layoutPins();
    await requestPaint();
    if (gen !== renderGen || !root.isConnected) return;
    layoutPins();
    updatePager();
  }
  function scrollToSlot(target, behavior = 'auto') {
    const slot = stage.querySelector(`[data-page-slot="${target}"]`);
    if (!slot) return Promise.resolve();
    const delta = slot.getBoundingClientRect().top - stage.getBoundingClientRect().top;
    if (Math.abs(delta) < 2) return requestPaint();
    scrollLock = true;
    const gen = renderGen;
    return new Promise(resolve => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        scrollLock = false;
        const job = gen === renderGen ? requestPaint() : Promise.resolve();
        job.then(resolve, resolve);
      };
      if (behavior === 'smooth') {
        stage.addEventListener('scrollend', done, { once: true });
        setTimeout(done, 700);
      }
      stage.scrollTo({ top: Math.max(0, stage.scrollTop + delta), behavior });
      if (behavior !== 'smooth') done();
    });
  }
  function goTo(target, behavior = 'smooth') {
    if (target < 1 || target > n) return Promise.resolve();
    page = target;
    updatePager();
    layoutPins();
    return scrollToSlot(target, behavior);
  }
  const onStageScroll = () => {
    if (scrollLock || !metas.length) return;
    const sr = stage.getBoundingClientRect();
    const mark = sr.top + Math.min(72, sr.height * 0.3);
    let best = page;
    for (const m of metas) {
      const r = m.slot.getBoundingClientRect();
      if (r.top <= mark && r.bottom > mark + 4) best = +m.slot.dataset.pageSlot;
    }
    if (best !== page) { page = best; updatePager(); }
    clearTimeout(paintTimer);
    paintTimer = setTimeout(() => { if (root.isConnected) requestPaint(); }, 80);
  };
  stage.addEventListener('scroll', onStageScroll, { passive: true });
  cancelPdf = () => {
    renderGen++;
    clearTimeout(paintTimer);
    stage.removeEventListener('scroll', onStageScroll);
    for (const m of metas) { try { m.task && m.task.cancel && m.task.cancel(); } catch {} }
    doc.destroy && doc.destroy().catch(() => {});
  };
  render = () => { renderPdf().catch(e => { if (root.isConnected) console.error('[proof pdf]', e); }); };
  turn = target => goTo(target, 'auto');
  prev.onclick = () => { if (page > 1) goTo(page - 1); };
  next.onclick = () => { if (page < n) goTo(page + 1); };
  if (n === 1) prev.hidden = next.hidden = true;
  await renderPdf();
  if (!root.isConnected) return api;
  if (n > 1 && root.isConnected) {
    thumbs.hidden = false;
    try {
      for (let i = 1; i <= Math.min(n, 60); i++) {
        if (!root.isConnected) return api;
        const p = await doc.getPage(i); const vp = p.getViewport({ scale: 168 / p.getViewport({ scale: 1 }).height });
        const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.title = 'Page ' + i;
        c.onclick = () => goTo(i);
        thumbs.append(c);
        await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        if (i === page) c.classList.add('on');
      }
    } catch (e) {
      if (!root.isConnected) return api;
      throw e;
    }
  }
  return api;
}
