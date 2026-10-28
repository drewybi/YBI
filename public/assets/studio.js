import { B, $, $$, esc, chip, fmtDate, fmtSize, api, upload, toast, copy, dropzone, mountViewer, harryStrip, mountHarry, STATUS } from './common.js';
const app = $('#app');
const jobHref = j => `${B}/studio/${encodeURIComponent(j.jobNumber)}`;
const ARROW = '<svg class="ar" viewBox="0 0 18 10" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M0 5h17M12.5 .5 17 5l-4.5 4.5"/></svg>';
let filter = 'all', q = '';

function band(eyebrow, title, sub = '', right = '') {
  return harryStrip() + `<div class="wrap bandhead"><div class="bandhead__row"><div><p class="eyebrow">${eyebrow}</p><h1 class="h1">${title}</h1>${sub ? `<p class="lede">${sub}</p>` : ''}</div>${right}</div></div>`;
}
const lastDecision = j => { const v = j.versions.at(-1); return v && [...v.feedback].reverse().find(f => f.type !== 'note'); };

async function dashboard() {
  const jobs = await api(B + '/api/jobs');
  const counts = { all: jobs.length }; jobs.forEach(j => counts[j.status] = (counts[j.status] || 0) + 1);
  const acts = jobs.flatMap(j => j.versions.flatMap(v => v.feedback.map(f => ({ j, v, f })))).sort((a, b) => b.f.at.localeCompare(a.f.at)).slice(0, 8);
  app.innerHTML = band('YBI Studio · Proofs', 'Artwork <span class="ol">approvals.</span>', 'Upload a proof, send the link, get a yes — or the changes.', `<button class="btn" data-new>+ New proof ${ARROW}</button>`) +
  `<div class="wrap">
   ${acts.length ? `<section style="margin-top:44px"><p class="eyebrow">Latest client activity</p><ul class="activity">${acts.map(({ j, v, f }) => `<li>${chip(f.type === 'approve' ? 'approved' : 'changes_requested')}<a href="${jobHref(j)}"><b class="num">${esc(j.jobNumber)}</b> · ${esc(j.clientName)} — V${v.n} · ${esc(f.name)}${f.note ? `: <span class="mute">“${esc(f.note.slice(0, 90))}${f.note.length > 90 ? '…' : ''}”</span>` : ''}${f.attachments.length ? ` <span class="dim">· ${f.attachments.length} file${f.attachments.length > 1 ? 's' : ''}</span>` : ''}${j.unread && f === lastDecision(j) ? '<span class="dot" title="New"></span>' : ''}</a><span class="small dim">${fmtDate(f.at)}</span></li>`).join('')}</ul></section>` : ''}
   <div class="toolbar"><div class="tabs">${['all', 'awaiting_review', 'changes_requested', 'approved'].map(s => `<button data-f="${s}" class="${filter === s ? 'on' : ''}">${s === 'all' ? 'All' : STATUS[s]} ${counts[s] || 0}</button>`).join('')}</div>
   <input class="search" placeholder="Search job no., client, description…" value="${esc(q)}"></div>
   <table class="jobs"><thead><tr><th>Job no.</th><th>Client</th><th class="hide-m">Description</th><th>Status</th><th class="hide-m">Version</th><th class="hide-m">Updated</th></tr></thead><tbody></tbody></table>
  </div>`;
  mountHarry(app);
  const tb = $('tbody', app);
  const draw = () => {
    const list = jobs.filter(j => (filter === 'all' || j.status === filter) && (!q || `${j.jobNumber} ${j.clientName} ${j.clientCompany} ${j.description}`.toLowerCase().includes(q.toLowerCase())));
    tb.innerHTML = list.length ? list.map(j => `<tr class="row" data-href="${jobHref(j)}"><td class="num">${esc(j.jobNumber)}${j.unread ? '<span class="dot" title="New client feedback"></span>' : ''}</td><td>${esc(j.clientName)}${j.clientCompany ? `<div class="small dim">${esc(j.clientCompany)}</div>` : ''}</td><td class="hide-m mute">${esc(j.description.slice(0, 80))}${j.description.length > 80 ? '…' : ''}</td><td>${chip(j.status)}</td><td class="hide-m">${j.versions.length ? 'V' + j.versions.at(-1).n : '—'}</td><td class="hide-m small dim">${fmtDate(j.updatedAt)}</td></tr>`).join('')
      : `<tr><td colspan="6" class="empty">${jobs.length ? 'No jobs match.' : 'No proofs yet — hit “New proof” to create the first one.'}</td></tr>`;
    $$('tr.row', tb).forEach(r => r.onclick = () => location.href = r.dataset.href);
  };
  draw();
  $$('[data-f]', app).forEach(b => b.onclick = () => { filter = b.dataset.f; $$('[data-f]', app).forEach(x => x.classList.toggle('on', x === b)); draw(); });
  $('.search', app).oninput = e => { q = e.target.value; draw(); };
  bindNew();
}

function fbHtml(f) {
  const t = f.type === 'approve' ? 'Approved' : 'Changes requested';
  const imgs = f.attachments.filter(a => /\.(png|jpe?g|webp|gif)$/i.test(a.name));
  return `<div class="fb fb--${f.type}"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><span><b>${t}</b> · ${esc(f.name)}</span><span class="small dim">${fmtDate(f.at)}</span></div>
   ${f.note ? `<p>${esc(f.note)}</p>` : ''}
   ${imgs.length ? `<div class="thumbatt">${imgs.map(a => `<a href="${a.url}" target="_blank" rel="noopener"><img src="${a.url}" alt="${esc(a.name)}"></a>`).join('')}</div>` : ''}
   ${f.attachments.length ? `<div class="att">${f.attachments.map(a => `<a href="${a.url}?download">↓ ${esc(a.name)} <span class="dim">${fmtSize(a.size)}</span></a>`).join('')}</div>` : ''}</div>`;
}

async function jobPage(key, showV) {
  let j = await api(`${B}/api/jobs/${encodeURIComponent(key)}`); const id = j.id;
  if (j.unread) api(`${B}/api/jobs/${id}`, { method: 'PATCH', body: JSON.stringify({ markSeen: true }) }).catch(() => {});
  const latest = j.versions.at(-1); const sel = j.versions.find(v => v.n === +showV) || latest;
  const mail = j.clientEmail ? `mailto:${encodeURIComponent(j.clientEmail)}?subject=${encodeURIComponent(`Artwork proof ${j.jobNumber}${latest ? ' — V' + latest.n : ''} ready for review`)}&body=${encodeURIComponent(`Hi ${j.clientName.split(' ')[0]},\n\nYour artwork proof for ${j.jobNumber}${j.description ? ' (' + j.description.split('\n')[0] + ')' : ''} is ready to review:\n\n${j.secureUrl}\n\nYou can approve it or request changes (and attach a file) straight from that page.\n\nThanks,\nYBI Creative`)}` : '';
  app.innerHTML = band(`<a href="${B}/studio" style="text-decoration:none">← All jobs</a> &nbsp;/&nbsp; Job`, esc(j.jobNumber), esc(j.clientName) + (j.clientCompany ? ' · ' + esc(j.clientCompany) : ''), `<div>${chip(j.status)}</div>`) +
  `<div class="wrap">
   <div class="panel" style="margin-top:36px"><span class="k">Client page — send this to ${esc(j.clientName)}</span>
    <div class="linkbox"><input readonly value="${esc(j.access === 'private' ? j.secureUrl : j.reviewUrl)}" aria-label="Client link" data-main><button class="btn btn--sm" data-copy>Copy link</button><a class="btn btn--sm btn--ghost" href="${esc(j.secureUrl)}" target="_blank" rel="noopener">Open</a>${mail ? `<a class="btn btn--sm btn--ghost" href="${mail}">Email client</a>` : ''}</div>
    <div class="linkrow small mute">
     ${j.access === 'private' ? `<span>🔒 Private: only the secure link above works. <span class="dim">${esc(j.reviewUrl)}</span> asks for it.</span>` : `<span>Secure link (recommended for email): <button class="lnk" data-copy2 style="text-transform:none;letter-spacing:0;font-size:.86rem">${esc(j.secureUrl)}</button></span>`}
    </div>
    <label class="toggle"><input type="checkbox" data-private ${j.access === 'private' ? 'checked' : ''}> Private job — require the secure link (job number alone won’t open it)</label>
    <div class="meta">
     <div><span class="k">Description</span>${esc(j.description) || '<span class="dim">—</span>'}</div>
     <div><span class="k">Client contact</span>${esc(j.clientName)}${j.clientEmail ? `<br><a href="mailto:${esc(j.clientEmail)}" class="mute">${esc(j.clientEmail)}</a>` : ''}</div>
     <div><span class="k">Versions</span>${j.versions.length || 0}</div>
     <div><span class="k">Created</span>${fmtDate(j.createdAt)}</div>
    </div></div>
   <div class="jgrid">
    <div>${sel ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;gap:12px;flex-wrap:wrap"><span class="vtag">V${sel.n}${sel === latest ? ' <span class="small dim" style="font-family:var(--sans);font-weight:400;letter-spacing:.1em">LATEST · CLIENT SEES THIS</span>' : ''}</span>
      ${j.versions.length > 1 ? `<select class="vsel" data-vsel>${[...j.versions].reverse().map(v => `<option value="${v.n}" ${v === sel ? 'selected' : ''}>V${v.n} — ${fmtDate(v.uploadedAt)}</option>`).join('')}</select>` : ''}</div><div data-viewer></div>` : '<div class="panel empty">No proof uploaded yet. Upload V1 →</div>'}</div>
    <div class="stack">
     <div class="panel"><p class="eyebrow" style="margin-bottom:16px">${latest ? `Upload new version (V${latest.n + 1})` : 'Upload V1'}</p>
      <p class="small mute" style="margin:0 0 16px">The client link always shows the newest version. Older versions stay available to them.</p>
      <div class="drop" tabindex="0" data-vdrop><span class="ico"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M7 10V1M3 5l4-4 4 4M1 13h12"/></svg></span><span data-vname><b>Choose PDF / JPG / PNG</b> or drop here</span><input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"></div>
      <div class="field" style="margin-top:18px"><label>Note to client <span class="opt">(optional — shown on their page)</span></label><textarea data-vnote style="min-height:70px" placeholder="e.g. Logo enlarged, phone number fixed."></textarea></div>
      <div class="btns" style="margin-top:20px"><button class="btn btn--sm" data-vgo disabled>Upload version</button></div><p class="msg" data-vmsg></p></div>
     <div class="panel"><p class="eyebrow" style="margin-bottom:6px">Client feedback &amp; history</p>
      ${j.versions.length ? [...j.versions].reverse().map(v => `<div class="ver"><div class="ver__h"><span class="vtag">V${v.n}</span><span class="small dim">${esc(v.originalName)} · ${fmtSize(v.size)} · ${fmtDate(v.uploadedAt)}</span></div>
        ${v.studioNote ? `<p class="small mute" style="margin:8px 0 0">YBI note: ${esc(v.studioNote)}</p>` : ''}
        ${v.feedback.length ? [...v.feedback].reverse().map(fbHtml).join('') : `<p class="small dim" style="margin:10px 0 0">${v === latest ? 'Waiting on client…' : 'No feedback on this version.'}</p>`}</div>`).join('') : '<p class="dim small">Nothing yet.</p>'}
     </div>
     <div style="text-align:right"><button class="lnk" data-del>Delete job</button></div>
    </div></div></div>`;
  mountHarry(app);
  $('[data-copy]', app).onclick = () => copy($('[data-main]', app).value);
  const c2 = $('[data-copy2]', app); if (c2) c2.onclick = () => copy(j.secureUrl);
  $('[data-private]', app).onchange = async e => { await api(`${B}/api/jobs/${id}`, { method: 'PATCH', body: JSON.stringify({ access: e.target.checked ? 'private' : 'public' }) }); toast(e.target.checked ? 'Job is now private' : 'Job number link is open'); jobPage(key, showV); };
  if (sel) mountViewer($('[data-viewer]', app), sel).catch(e => $('[data-viewer]', app).innerHTML = `<div class="panel">Could not render: ${esc(e.message)}</div>`);
  const vs = $('[data-vsel]', app); if (vs) vs.onchange = () => jobPage(key, vs.value);
  let file = null; const go = $('[data-vgo]', app), msg = $('[data-vmsg]', app);
  dropzone($('[data-vdrop]', app), fs => { file = fs[0]; $('[data-vname]', app).innerHTML = `<b>${esc(file.name)}</b> · ${fmtSize(file.size)}`; go.disabled = false; });
  go.onclick = async () => {
    if (!file) return; go.disabled = true; msg.className = 'msg';
    try { await upload(`${B}/api/jobs/${id}/versions?name=${encodeURIComponent(file.name)}&note=${encodeURIComponent($('[data-vnote]', app).value)}`, file, p => msg.textContent = `Uploading… ${Math.round(p * 100)}%`); toast('New version uploaded'); jobPage(key); }
    catch (e) { msg.className = 'msg err'; msg.textContent = e.message; go.disabled = false; }
  };
  $('[data-del]', app).onclick = async () => { if (!confirm(`Delete job ${j.jobNumber} and all its files? The client link will stop working.`)) return; await api(`${B}/api/jobs/${id}`, { method: 'DELETE' }); location.href = B + '/studio'; };
}

async function settings() {
  const s = await api(B + '/api/settings');
  app.innerHTML = band('YBI Studio', 'Settings') + `<div class="wrap"><div class="panel" style="margin-top:36px;max-width:760px">
   <div class="field"><label>Notification email</label><input data-email type="email" value="${esc(s.notifyEmail)}" placeholder="e.g. drew@ybicreative.com.au"></div>
   <p class="small mute">Email alerts: <b>${s.emailEnabled ? 'ON (SMTP configured)' : 'OFF'}</b>. ${s.emailEnabled ? '' : 'Approvals and change requests still show on the Jobs dashboard and in <code>data/notifications.log</code>. To switch email on, set the SMTP_* variables — see README.'}</p>
   <p class="small mute">Client pages: <b>${esc(location.origin + s.basePath)}/{job number}</b> · new jobs default to <b>${s.defaultAccess}</b> (set DEFAULT_ACCESS=private to require secure links).</p>
   <div class="btns" style="margin-top:20px"><button class="btn btn--sm" data-save>Save</button><button class="btn btn--sm btn--ghost" data-out>Log out</button></div></div></div>`;
  mountHarry(app);
  $('[data-save]', app).onclick = async () => { await api(B + '/api/settings', { method: 'POST', body: JSON.stringify({ notifyEmail: $('[data-email]', app).value }) }); toast('Saved'); };
  $('[data-out]', app).onclick = async () => { await api(B + '/api/logout', { method: 'POST' }); location.href = B + '/'; };
}

// ---- new job modal ----
const modal = $('#newModal'), form = $('#newForm'); let newFile = null;
function openNew() { form.reset(); newFile = null; $('#n-fname').innerHTML = '<b>Choose a file</b> or drop it here'; $('#n-msg').textContent = ''; modal.hidden = false; $('#n-num').focus(); }
function bindNew() { $$('[data-new]').forEach(b => b.onclick = openNew); }
$$('[data-close]', modal).forEach(b => b.onclick = () => modal.hidden = true);
modal.addEventListener('click', e => { if (e.target === modal) modal.hidden = true; });
dropzone($('#n-drop'), fs => { newFile = fs[0]; $('#n-fname').innerHTML = `<b>${esc(newFile.name)}</b> · ${fmtSize(newFile.size)}`; });
form.onsubmit = async e => {
  e.preventDefault(); const m = $('#n-msg'), go = $('#n-go'); m.className = 'msg';
  const data = Object.fromEntries(new FormData(form));
  if (!data.jobNumber.trim() || !data.clientName.trim()) { m.className = 'msg err'; m.textContent = 'Job number and client name are required.'; return; }
  if (newFile && !/\.(pdf|jpe?g|png)$/i.test(newFile.name)) { m.className = 'msg err'; m.textContent = 'Proof must be a PDF, JPG or PNG.'; return; }
  go.disabled = true;
  try {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(data.jobNumber.trim())) { m.className = 'msg err'; m.textContent = 'Job number can only use letters, numbers, - _ or . (no spaces).'; return; }
    let j; try { j = await api(B + '/api/jobs', { method: 'POST', body: JSON.stringify(data) }); }
    catch (er) { if (er.status === 409) { m.className = 'msg err'; m.innerHTML = `${esc(er.message)} <a class="lnk" href="${B}/studio/${encodeURIComponent(data.jobNumber.trim())}">Open it</a>`; go.disabled = false; return; } throw er; }
    if (newFile) await upload(`${B}/api/jobs/${j.id}/versions?name=${encodeURIComponent(newFile.name)}`, newFile, p => m.textContent = `Uploading… ${Math.round(p * 100)}%`);
    modal.hidden = true; toast('Proof created — copy the link to send'); location.href = jobHref(j);
  } catch (er) { m.className = 'msg err'; m.textContent = er.message; } finally { go.disabled = false; }
};
bindNew();

async function route() {
  const rest = decodeURIComponent(location.pathname.slice(B.length).replace(/^\/studio\/?/, '').replace(/\/$/, ''));
  try {
    if (rest === 'settings') await settings();
    else if (rest) await jobPage(rest);
    else await dashboard();
  } catch (e) { if (e.status === 401) location.href = B + '/'; else app.innerHTML = `<div class="wrap" style="padding-top:80px;padding-bottom:80px"><p class="msg err">${esc(e.message)}</p><a class="lnk" href="${B}/studio">Back to jobs</a></div>`; }
}
route();
// light polling so new client feedback shows up on the dashboard
const onDash = () => !location.pathname.slice(B.length).replace(/^\/studio\/?/, '');
setInterval(() => { if (onDash() && modal.hidden && document.visibilityState === 'visible' && !document.activeElement.matches('input,textarea')) dashboard().catch(() => {}); }, 30000);
