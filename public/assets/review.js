import { B, $, $$, esc, fmtDate, fmtSize, api, upload, toast, dropzone, mountViewer, harryStrip, mountHarry } from './common.js';
const app = $('#app');
const jobNo = decodeURIComponent(location.pathname.slice(B.length).split('/').filter(Boolean)[0] || '');
const K = new URLSearchParams(location.search).get('k') || '';
const kq = K ? `k=${encodeURIComponent(K)}` : '';
const API = `${B}/api/review/${encodeURIComponent(jobNo)}`;
const ICO = {
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 12.5l5 5L20 6.5"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>',
  clip: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M9.5 4.5 5 9a1.4 1.4 0 0 0 2 2l5-5a2.8 2.8 0 0 0-4-4L3 7a4.2 4.2 0 0 0 6 6l4-4"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>'
};
let job, showN, mode = null, files = [];
const saved = () => localStorage.getItem('ybi-proof-name') || '';

async function load() {
  try { job = await api(API + (kq ? '?' + kq : '')); }
  catch (e) { if (e.status === 403) { app.innerHTML = `<div class="wrap" style="padding-top:100px;padding-bottom:100px"><p class="eyebrow">Job ${esc(jobNo)}</p><h1 class="h2">Private <span class="ol">proof.</span></h1><p class="lede">This proof can only be opened with the secure link YBI emailed you. Can’t find it? Call <a href="tel:+61354442127">(03) 5444 2127</a>.</p></div>`; return; } app.innerHTML = `<div class="wrap" style="padding-top:100px;padding-bottom:100px"><p class="eyebrow">Artwork proof</p><h1 class="h2">Proof not <span class="ol">found.</span></h1><p class="lede">We couldn’t find a proof for job <b>${esc(jobNo)}</b>. Check the number, or contact YBI Creative on <a href="tel:+61354442127">(03) 5444 2127</a>.</p></div>`; return; }
  render();
}

function render() {
  const latest = job.versions.at(-1);
  if (!latest) { app.innerHTML = `<div class="wrap" style="padding-top:100px;padding-bottom:100px"><p class="eyebrow">Job ${esc(job.jobNumber)}</p><h1 class="h2">Proof coming <span class="ol">soon.</span></h1><p class="lede">YBI is still preparing your artwork. Check this link again shortly.</p></div>`; return; }
  const v = job.versions.find(x => x.n === showN) || latest; const isLatest = v === latest;
  const head = { awaiting_review: ['Your proof is', 'ready.'], changes_requested: ['Changes', 'received.'], approved: ['Artwork', 'approved.'] }[job.status];
  document.title = `Proof ${job.jobNumber} · YBI Creative`;
  app.innerHTML = harryStrip() + `<div class="wrap bandhead">
    <p class="eyebrow">Artwork proof · <span style="color:var(--ink)">Job ${esc(job.jobNumber)}</span></p>
    <h1 class="h1">${head[0]} <span class="ol">${head[1]}</span></h1>
    <div class="meta">
     <div><span class="k">Job number</span><b>${esc(job.jobNumber)}</b></div>
     <div><span class="k">Client</span>${esc(job.clientName)}${job.clientCompany ? ' · ' + esc(job.clientCompany) : ''}</div>
     <div style="grid-column:span 2"><span class="k">Job description</span>${esc(job.description) || '—'}</div>
     <div><span class="k">Version</span>V${latest.n} <span class="dim small">· ${fmtDate(latest.uploadedAt)}</span></div>
    </div></div>
   <div class="wrap"><div class="jgrid">
    <div>
     <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:12px;flex-wrap:wrap">
      <span class="vtag">V${v.n} ${isLatest ? '<span class="small dim" style="font-family:var(--sans);font-weight:400;letter-spacing:.14em">LATEST</span>' : ''}</span>
      ${job.versions.length > 1 ? `<label class="small mute">Versions &nbsp;<select class="vsel" data-vsel>${[...job.versions].reverse().map(x => `<option value="${x.n}" ${x === v ? 'selected' : ''}>V${x.n}${x === latest ? ' (latest)' : ''} — ${fmtDate(x.uploadedAt)}</option>`).join('')}</select></label>` : ''}
     </div>
     ${!isLatest ? `<div class="banner">You’re viewing an earlier version (V${v.n}). <button class="lnk" data-latest style="color:var(--warn)">View latest V${latest.n}</button></div>` : ''}
     ${v.studioNote ? `<div class="fb" style="margin:0 0 14px"><span class="k" style="margin:0">Note from YBI</span><p>${esc(v.studioNote)}</p></div>` : ''}
     <div data-viewer></div>
     <p class="small dim" style="margin-top:12px">Tip: ⤢ opens the proof full screen. Use ‹ › or the arrow keys to flip pages, and + / − to zoom. Colours on screen may vary slightly from print.</p>
    </div>
    <aside class="stack">${panel(latest)}${history()}</aside>
   </div></div>`;
  mountHarry(app);
  mountViewer($('[data-viewer]', app), v).catch(e => $('[data-viewer]', app).innerHTML = `<div class="panel">Couldn’t display this file — <a href="${v.url}">download it</a> instead.</div>`);
  const vs = $('[data-vsel]', app); if (vs) vs.onchange = () => { showN = +vs.value; render(); };
  const vl = $('[data-latest]', app); if (vl) vl.onclick = () => { showN = null; render(); };
  bindPanel(latest);
}

function panel(latest) {
  const dec = [...latest.feedback].reverse().find(f => f.type === 'approve' || f.type === 'changes');
  if (job.status === 'approved') return `<div class="state state--approved" data-state="approved"><div class="big-ico" style="color:var(--ok)">${ICO.ok}</div>
    <h2 class="h3">Approved — thank you.</h2><p class="mute">V${latest.n} was approved by <b style="color:var(--ink)">${esc(dec.name)}</b> on ${fmtDate(dec.at)}. YBI has been notified and will move your job into production.</p>
    ${dec.note ? `<div class="fb fb--approve"><p style="margin:0">${esc(dec.note)}</p></div>` : ''}
    <p class="small dim" style="margin-top:18px">Spotted something? Call us now on <a href="tel:+61354442127">(03) 5444 2127</a>.</p></div>`;
  if (job.status === 'changes_requested' && mode !== 'changes') return `<div class="state state--changes_requested" data-state="changes_requested"><div class="big-ico" style="color:var(--warn)">${ICO.clock}</div>
    <h2 class="h3">Thanks — we’re on it.</h2><p class="mute">Your changes to V${latest.n} have been sent to YBI. We’ll upload a new version and <b style="color:var(--ink)">this same link</b> will show it — no need to do anything until then.</p>
    ${latest.feedback.filter(f => f.type === 'changes').map(f => `<div class="fb fb--changes"><div class="small dim">${esc(f.name)} · ${fmtDate(f.at)}</div>${f.note ? `<p>${esc(f.note)}</p>` : ''}${f.attachments.length ? `<div class="att">${f.attachments.map(a => `<a href="${a.url}" target="_blank" rel="noopener">${ICO.clip.replace('<svg', '<svg width="12" height="12"')} ${esc(a.name)}</a>`).join('')}</div>` : ''}</div>`).join('')}
    <div class="btns" style="margin-top:20px"><button class="btn btn--sm btn--ghost" data-more>+ Add another note or file</button></div></div>`;
  return `<div class="state" data-state="awaiting_review">
    <p class="eyebrow" style="margin-bottom:10px">Your decision · V${latest.n}</p>
    <h2 class="h3">${job.status === 'changes_requested' ? 'Add to your changes' : 'Happy with it?'}</h2>
    ${job.status === 'changes_requested' ? '' : `<div class="seg"><button data-a="approve" class="${mode === 'approve' ? 'on' : ''}">${ICO.ok} Approve</button><button data-a="changes" class="${mode === 'changes' ? 'on' : ''}">${ICO.pen} Request changes</button></div>`}
    ${mode ? form() : '<p class="small mute">Please check spelling, phone numbers, colours and sizes carefully before approving.</p>'}
  </div>`;
}

function form() {
  const ap = mode === 'approve';
  return `<form data-form novalidate class="stack" style="gap:20px;${job.status === 'changes_requested' ? 'margin-top:20px' : ''}">
    <div class="field"><label for="c-name">Your name</label><input id="c-name" autocomplete="name" value="${esc(saved())}" required></div>
    <div class="field"><label for="c-note">${ap ? 'Comment <span class="opt">(optional)</span>' : 'What needs changing?'}</label><textarea id="c-note" placeholder="${ap ? 'Anything else we should know?' : 'e.g. Page 2 — change phone to 0400 000 000. Make the logo bigger.'}"></textarea></div>
    ${ap ? '' : `<div class="field"><label>Attach a file <span class="opt">(optional — markup, photo, logo, reference)</span></label>
      <div class="drop" tabindex="0" data-drop><span class="ico">${ICO.clip}</span><span><b>Add files</b> or drop here</span><input type="file" multiple></div><ul class="files" data-files></ul></div>`}
    ${ap ? `<label class="check"><input type="checkbox" id="c-ok"> I’ve checked this proof (spelling, contact details, colours, sizes) and approve it for production.</label>` : ''}
    <div class="btns"><button class="btn ${ap ? 'btn--ok' : ''}" type="submit" data-go>${ap ? 'Approve artwork' : 'Send changes to YBI'}</button>${job.status === 'changes_requested' ? '<button type="button" class="lnk" data-cancel>Cancel</button>' : ''}</div>
    <p class="msg" data-msg></p></form>`;
}

function history() {
  const all = job.versions.flatMap(v => v.feedback.map(f => ({ v, f }))).reverse();
  if (!all.length && job.versions.length < 2) return '';
  return `<div class="panel"><p class="eyebrow" style="margin-bottom:6px">History</p>
   ${[...job.versions].reverse().map(v => `<div class="ver"><div class="ver__h"><span class="vtag" style="font-size:1rem">V${v.n}</span><span class="small dim">${fmtDate(v.uploadedAt)}</span></div>
    ${v.feedback.map(f => `<p class="small mute" style="margin:8px 0 0">${f.type === 'approve' ? '✓ Approved' : '✎ Changes'} by ${esc(f.name)} · ${fmtDate(f.at)}${f.attachments.length ? ` · ${f.attachments.length} file${f.attachments.length > 1 ? 's' : ''}` : ''}</p>`).join('')}</div>`).join('')}</div>`;
}

function bindPanel(latest) {
  $$('.seg button', app).forEach(b => b.onclick = () => { mode = b.dataset.a; files = []; render(); setTimeout(() => $('#c-name')?.value ? $('#c-note')?.focus() : $('#c-name')?.focus(), 50); });
  const more = $('[data-more]', app); if (more) more.onclick = () => { mode = 'changes'; files = []; render(); };
  const cancel = $('[data-cancel]', app); if (cancel) cancel.onclick = () => { mode = null; render(); };
  const drop = $('[data-drop]', app);
  const drawFiles = () => { const ul = $('[data-files]', app); if (ul) { ul.innerHTML = files.map((f, i) => `<li><span>${esc(f.name)} · ${fmtSize(f.size)}</span><button type="button" data-rm="${i}" aria-label="Remove">✕</button></li>`).join(''); $$('[data-rm]', ul).forEach(b => b.onclick = () => { files.splice(+b.dataset.rm, 1); drawFiles(); }); } };
  if (drop) { dropzone(drop, fs => { files.push(...fs); drawFiles(); }); drawFiles(); }
  const f = $('[data-form]', app); if (!f) return;
  f.onsubmit = async e => {
    e.preventDefault(); const msg = $('[data-msg]', f), go = $('[data-go]', f); msg.className = 'msg';
    const name = $('#c-name').value.trim(), note = $('#c-note').value.trim();
    const bad = t => { msg.className = 'msg err'; msg.textContent = t; };
    if (!name) return bad('Please add your name.');
    if (mode === 'approve' && !$('#c-ok').checked) return bad('Please tick the box to confirm you’ve checked the proof.');
    if (mode === 'changes' && !note && !files.length) return bad('Please describe the changes or attach a file.');
    localStorage.setItem('ybi-proof-name', name); go.disabled = true;
    try {
      const ids = [];
      for (const [i, file] of files.entries()) { const r = await upload(`${API}/attachments?name=${encodeURIComponent(file.name)}${kq ? '&' + kq : ''}`, file, p => msg.textContent = `Uploading file ${i + 1} of ${files.length}… ${Math.round(p * 100)}%`); ids.push(r.id); }
      msg.textContent = 'Sending…';
      job = await api(`${API}/decision${kq ? '?' + kq : ''}`, { method: 'POST', body: JSON.stringify({ type: mode, name, note, attachments: ids, version: latest.n }) });
      mode = null; files = []; showN = null; render(); window.scrollTo({ top: 0, behavior: 'smooth' });
      toast(job.status === 'approved' ? 'Approved — thank you!' : 'Changes sent to YBI');
    } catch (er) { bad(er.message); go.disabled = false; if (er.status === 409) setTimeout(load, 1500); }
  };
}
load();
