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

// Proof viewer. version = { kind:'pdf'|'image', url, originalName }
export async function mountViewer(root, version) {
  root.innerHTML = `<div class="viewer">
    <div class="viewer__bar">
      <div class="grp"><button class="ibtn" data-prev aria-label="Previous page">‹</button><span class="pg" data-pg>—</span><button class="ibtn" data-next aria-label="Next page">›</button></div>
      <div class="grp"><span class="small dim" style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(version.originalName)}</span></div>
      <div class="grp"><button class="ibtn" data-zoom aria-label="Zoom" title="Fit / actual size">⤢</button><a class="ibtn" href="${version.url}${version.url.includes('?') ? '&' : '?'}download" aria-label="Download" title="Download file" style="text-decoration:none">↓</a><a class="ibtn" href="${version.url}" target="_blank" rel="noopener" aria-label="Open full screen" title="Open in new tab" style="text-decoration:none">↗</a></div>
    </div>
    <div class="stage" data-stage><span class="loading">Loading proof…</span></div>
    <div class="thumbs" data-thumbs hidden></div></div>`;
  const stage = $('[data-stage]', root), pg = $('[data-pg]', root), prev = $('[data-prev]', root), next = $('[data-next]', root), thumbs = $('[data-thumbs]', root);
  let zoom = false;
  $('[data-zoom]', root).onclick = () => { zoom = !zoom; stage.classList.toggle('zoom', zoom); if (render) render(); };
  let render = null;

  if (version.kind === 'image') {
    prev.hidden = next.hidden = true; pg.textContent = 'Image';
    const img = new Image(); img.alt = 'Proof'; img.src = version.url;
    img.onload = () => { stage.innerHTML = ''; stage.append(img); pg.textContent = `${img.naturalWidth}×${img.naturalHeight}px`; };
    img.onerror = () => stage.innerHTML = '<span class="loading">Could not load image.</span>';
    return;
  }
  const lib = await pdfjs();
  const doc = await lib.getDocument(version.url).promise;
  let page = 1; const n = doc.numPages; let busy = 0;
  render = async () => {
    const my = ++busy;
    const p = await doc.getPage(page);
    const base = p.getViewport({ scale: 1 });
    const avail = Math.max(280, stage.clientWidth - 48);
    const cssScale = zoom ? Math.max(2, avail / base.width * 1.8) : Math.min(avail / base.width, 2.2);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vp = p.getViewport({ scale: cssScale * dpr });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    c.style.width = vp.width / dpr + 'px'; c.style.height = 'auto';
    await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    if (my !== busy) return;
    stage.innerHTML = ''; stage.append(c);
    pg.textContent = `Page ${page} / ${n}`; prev.disabled = page <= 1; next.disabled = page >= n;
    $$('canvas', thumbs).forEach((t, i) => t.classList.toggle('on', i + 1 === page));
  };
  prev.onclick = () => { if (page > 1) { page--; render(); } };
  next.onclick = () => { if (page < n) { page++; render(); } };
  root.tabIndex = 0;
  root.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') prev.click(); if (e.key === 'ArrowRight') next.click(); });
  if (n === 1) { prev.hidden = next.hidden = true; }
  await render();
  if (n > 1) {
    thumbs.hidden = false;
    for (let i = 1; i <= Math.min(n, 60); i++) {
      const p = await doc.getPage(i); const vp = p.getViewport({ scale: 168 / p.getViewport({ scale: 1 }).height });
      const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; c.title = 'Page ' + i;
      c.onclick = () => { page = i; render(); };
      thumbs.append(c); await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      if (i === page) c.classList.add('on');
    }
  }
  let rt; window.__ybiResize && window.removeEventListener('resize', window.__ybiResize);
  window.__ybiResize = () => { clearTimeout(rt); rt = setTimeout(() => root.isConnected && render(), 200); }; window.addEventListener('resize', window.__ybiResize);
}
