import { B, $, $$, esc, chip, fmtDate, fmtSize, api, upload, toast, copy, dropzone, mountViewer, engineBand, pinsFrom, STATUS } from './common.js';
import { addDays, hhmm, isoParts, minutesOf, movedTimes, sameSpan } from './cal-move.mjs';
const app = $('#app');
const jobHref = j => `${B}/studio/${encodeURIComponent(j.jobNumber)}`;
const ARROW = '<svg class="ar" viewBox="0 0 18 10" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M0 5h17M12.5 .5 17 5l-4.5 4.5"/></svg>';
let filter = 'all', q = '';

function band(eyebrow, title, sub = '', right = '') {
  return engineBand(`<div class="eband__row"><div><p class="eyebrow">${eyebrow}</p><h1 class="h1">${title}</h1>${sub ? `<p class="lede">${sub}</p>` : ''}</div>${right}</div>`);
}
const lastDecision = j => { const v = j.versions.at(-1); return v && [...v.feedback].reverse().find(f => f.type !== 'note'); };

async function dashboard() {
  const jobs = await api(B + '/api/jobs');
  const counts = { all: jobs.length }; jobs.forEach(j => counts[j.status] = (counts[j.status] || 0) + 1);
  const acts = jobs.flatMap(j => j.versions.flatMap(v => v.feedback.map(f => ({ j, v, f })))).sort((a, b) => b.f.at.localeCompare(a.f.at)).slice(0, 8);
  app.innerHTML = band('YBI Studio · Proofs', 'Artwork <span class="ol">approvals.</span>', 'Upload a proof, send the link, get a yes — or the changes.', `<button class="btn" data-new>+ New proof ${ARROW}</button>`) +
  `<div class="wrap">
   ${acts.length ? `<section style="margin-top:44px"><p class="eyebrow">Latest client activity</p><ul class="activity">${acts.map(({ j, v, f }) => `<li>${chip(f.type === 'approve' ? 'approved' : 'changes_requested')}<a href="${jobHref(j)}"><b class="num">${esc(j.jobNumber)}</b> · ${esc(j.clientName)} — V${v.n} · ${esc(f.name)}${f.note ? `: <span class="mute">“${esc(f.note.slice(0, 90))}${f.note.length > 90 ? '…' : ''}”</span>` : ''}${f.stickies?.length ? ` <span class="dim">· ${f.stickies.length} on the proof</span>` : ''}${f.attachments.length ? ` <span class="dim">· ${f.attachments.length} file${f.attachments.length > 1 ? 's' : ''}</span>` : ''}${j.unread && f === lastDecision(j) ? '<span class="dot" title="New"></span>' : ''}</a><span class="small dim">${fmtDate(f.at)}</span></li>`).join('')}</ul></section>` : ''}
   <div class="toolbar"><div class="tabs">${['all', 'awaiting_review', 'changes_requested', 'approved'].map(s => `<button data-f="${s}" class="${filter === s ? 'on' : ''}">${s === 'all' ? 'All' : STATUS[s]} ${counts[s] || 0}</button>`).join('')}</div>
   <input class="search" placeholder="Search job no., client, description…" value="${esc(q)}"></div>
   <table class="jobs"><thead><tr><th>Job no.</th><th>Client</th><th class="hide-m">Description</th><th>Status</th><th class="hide-m">Version</th><th class="hide-m">Updated</th></tr></thead><tbody></tbody></table>
  </div>`;
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

function fbHtml(f, v, jobId) {
  const t = f.type === 'approve' ? 'Approved' : 'Changes requested';
  const imgs = f.attachments.filter(a => /\.(png|jpe?g|webp|gif)$/i.test(a.name));
  return `<div class="fb fb--${f.type}"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><span><b>${t}</b> · ${esc(f.name)}</span><span class="small dim">${fmtDate(f.at)}</span></div>
   ${f.note ? `<p>${esc(f.note)}</p>` : ''}
   ${f.stickies?.length ? `<ol class="notelist notelist--ro">${f.stickies.map(s => `<li class="note"><button type="button" class="note__hit" data-sid="${f.id}-${s.n}" data-fb="${f.id}"><span class="note__n" aria-hidden="true">${s.n}</span><span class="note__body"><span class="note__t">${esc(s.text)}</span><span class="note__meta">Page ${s.page}</span></span></button></li>`).join('')}</ol><div class="btns" style="margin-top:14px"><a class="btn btn--sm btn--ghost" href="${B}/api/jobs/${encodeURIComponent(jobId)}/changes.pdf?v=${v.n}&f=${encodeURIComponent(f.id)}">Download changes PDF</a></div>` : ''}
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
    <div class="linkbox"><input readonly value="${esc(j.secureUrl)}" aria-label="Client link" data-main><button class="btn btn--sm" data-copy>Copy link</button><a class="btn btn--sm btn--ghost" href="${esc(j.secureUrl)}" target="_blank" rel="noopener">Open</a>${mail ? `<a class="btn btn--sm btn--ghost" href="${mail}">Email client</a>` : ''}</div>
    <p class="small mute" style="margin:10px 0 0">Private link only. The job number alone won’t open this proof — send this link.</p>
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
        ${v.feedback.length ? [...v.feedback].reverse().map(f => fbHtml(f, v, j.id)).join('') : `<p class="small dim" style="margin:10px 0 0">${v === latest ? 'Waiting on client…' : 'No feedback on this version.'}</p>`}</div>`).join('') : '<p class="dim small">Nothing yet.</p>'}
     </div>
     <div style="text-align:right"><button class="lnk" data-del>Delete job</button></div>
    </div></div></div>`;
  $('[data-copy]', app).onclick = () => copy($('[data-main]', app).value);
  if (sel) {
    const pinFb = [...sel.feedback].reverse().find(f => f.stickies?.length);
    mountViewer($('[data-viewer]', app), sel, {
      pins: pinsFrom(pinFb),
      onSelect: id => $$('.note', app).forEach(li => li.classList.toggle('on', !!li.querySelector(`[data-sid="${id}"]`)))
    }).then(api => {
      $$('[data-sid]', app).forEach(btn => btn.onclick = () => {
        const fb = sel.feedback.find(f => f.id === btn.dataset.fb);
        if (fb) api.setPins(pinsFrom(fb));
        api.select(btn.dataset.sid);
      });
    }).catch(e => $('[data-viewer]', app).innerHTML = `<div class="panel">Could not render: ${esc(e.message)}</div>`);
  }
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

// Staff calendar — proof jobs, deadlines, meetings and notes. Times are Australia/Melbourne wall-clock values.
const CAL_TZ = 'Australia/Melbourne';
const CAL_COLOURS = [['red', 'Red'], ['blue', 'Blue'], ['green', 'Green'], ['yellow', 'Yellow'], ['purple', 'Purple'], ['grey', 'Grey']];
const CAL_DOW = [0, 1, 2, 3, 4, 5, 6].map(i => new Intl.DateTimeFormat('en-AU', { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 0, 5 + i))));
let calEvents = [], calMode = 'month', calAnchor = '', calSelected = '', editingId = null, editingJobId = null, calGen = 0;
let calDrag = null, calSuppressClick = false, calSaving = 0, moveQueue = Promise.resolve(), confirmedEvents = [];
const DRAG_PX = 6;
const SLOT_H = 22; // keep in sync with .calslot / .caltick height
const weekGridMq = window.matchMedia('(min-width: 801px)');
const colourOf = ev => CAL_COLOURS.some(([name]) => name === ev?.colour) ? ev.colour : 'grey';
const colourSwatches = () => `<div class="swatches" role="radiogroup" aria-labelledby="ev-colour-label">${CAL_COLOURS.map(([name, label]) => `<label class="swatch"><input type="radio" name="ev-colour" value="${name}"${name === 'grey' ? ' checked' : ''}><span class="swatch__box tone-${name}">${label}</span></label>`).join('')}</div>`;

function melbourneToday() {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: CAL_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const g = t => parts.find(p => p.type === t).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}
function fmtUTC(iso, opts) { const { y, m, d } = isoParts(iso); return new Intl.DateTimeFormat('en-AU', { ...opts, timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d))); }
const longDay = iso => fmtUTC(iso, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDay = iso => fmtUTC(iso, { day: 'numeric', month: 'short' });
function mondayOf(iso) { const { y, m, d } = isoParts(iso); const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return addDays(iso, -((wd + 6) % 7)); }
function shiftMonth(iso, delta) {
  const { y, m, d } = isoParts(iso);
  const first = new Date(Date.UTC(y, m - 1 + delta, 1));
  const dim = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, dim))).toISOString().slice(0, 10);
}
function fmtClock(hhmm) {
  const h = +hhmm.slice(0, 2), mi = +hhmm.slice(3, 5);
  const ap = h >= 12 ? 'pm' : 'am';
  return `${h % 12 || 12}:${String(mi).padStart(2, '0')} ${ap}`;
}
function eventSpan(ev) { return { s: String(ev.start).slice(0, 10), e: String(ev.end || ev.start).slice(0, 10) }; }
function eventsOn(iso) {
  return calEvents.filter(ev => { const { s, e } = eventSpan(ev); return iso >= s && iso <= e; }).sort((a, b) => {
    if (!!a.allDay !== !!b.allDay) return a.allDay ? -1 : 1;
    return String(a.start).localeCompare(String(b.start)) || String(a.title).localeCompare(String(b.title));
  });
}
function timeRange(ev) {
  if (ev.kind === 'job') return 'Proof job';
  const { s, e } = eventSpan(ev);
  if (ev.allDay) return s === e ? 'All day' : `All day · ${shortDay(s)} – ${shortDay(e)}`;
  const st = fmtClock(String(ev.start).slice(11, 16));
  if (!ev.end) return st;
  const en = fmtClock(String(ev.end).slice(11, 16));
  return s === e ? `${st} – ${en}` : `${st} – ${shortDay(e)} ${en}`;
}
function visibleDays() {
  if (calMode === 'week') { const mon = mondayOf(calAnchor); return Array.from({ length: 7 }, (_, i) => addDays(mon, i)); }
  const first = calAnchor.slice(0, 8) + '01';
  const start = mondayOf(first);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
function rangeLabel(days) {
  if (calMode === 'month') return fmtUTC(calAnchor, { month: 'long', year: 'numeric' });
  const a = days[0], b = days[days.length - 1];
  if (a.slice(0, 7) === b.slice(0, 7)) return `${+a.slice(8)}–${+b.slice(8)} ${fmtUTC(a, { month: 'short' })} ${a.slice(0, 4)}`;
  if (a.slice(0, 4) === b.slice(0, 4)) return `${shortDay(a)} – ${shortDay(b)} ${a.slice(0, 4)}`;
  return `${shortDay(a)} ${a.slice(0, 4)} – ${shortDay(b)} ${b.slice(0, 4)}`;
}
function eventButton(ev, iso, pos) {
  const colour = colourOf(ev);
  const onStart = String(ev.start).slice(0, 10) === iso;
  const time = ev.kind === 'job' ? 'Job' : (!ev.allDay && onStart ? fmtClock(String(ev.start).slice(11, 16)) : '');
  const kind = ev.kind === 'job' ? 'job' : 'event';
  const style = pos ? ` style="top:${pos.top}px;height:${pos.height}px;left:calc(${pos.col} * (100% / ${pos.cols}) + 2px);width:calc(100% / ${pos.cols} - 4px)"` : '';
  return `<button type="button" class="calev tone-${colour}${ev.allDay ? ' calev--all' : ''}"${style} data-ev="${esc(ev.id)}" data-kind="${kind}" data-colour="${colour}" title="${esc(timeRange(ev) + ' — ' + ev.title + ' — ' + colour)}">${time ? `<span class="calev__t">${esc(time)}</span>` : ''}<span class="calev__n">${esc(ev.title)}</span></button>`;
}
function splitDay(iso) {
  const all = [], timed = [];
  for (const ev of eventsOn(iso)) {
    if (!ev.allDay && ev.kind !== 'job' && String(ev.start).slice(0, 10) === iso) timed.push(ev);
    else all.push(ev);
  }
  return { all, timed };
}
function weekHasTimed(days) { return days.some(iso => splitDay(iso).timed.length); }
function hourLabel(stamp) {
  const h = +stamp.slice(0, 2);
  return `${h % 12 || 12}${h >= 12 ? 'pm' : 'am'}`;
}
function weekSlots(days) {
  let start = 8 * 60, end = 18 * 60;
  for (const iso of days) {
    for (const ev of splitDay(iso).timed) {
      const st = minutesOf(String(ev.start).slice(11, 16));
      start = Math.min(start, Math.floor(st / 30) * 30);
      let en = st + 30;
      if (ev.end && String(ev.end).slice(0, 10) === iso) en = minutesOf(String(ev.end).slice(11, 16));
      else if (ev.end) en = 24 * 60;
      if (en <= st) en = st + 30;
      end = Math.max(end, Math.ceil(en / 30) * 30);
    }
  }
  start = Math.max(0, start);
  end = Math.min(24 * 60, Math.max(end, start + 60));
  const out = [];
  for (let m = start; m < end; m += 30) out.push(hhmm(m));
  return out;
}
function layoutTimed(events, origin) {
  const items = events.map(ev => {
    const st = minutesOf(String(ev.start).slice(11, 16));
    const startDay = String(ev.start).slice(0, 10);
    const endDay = ev.end ? String(ev.end).slice(0, 10) : '';
    let en;
    if (ev.end && endDay === startDay) en = minutesOf(String(ev.end).slice(11, 16));
    else if (ev.end) en = 24 * 60;
    else en = st + 30;
    if (en <= st) en = st + 30;
    return { ev, start: st, end: en, col: 0, cols: 1 };
  }).sort((a, b) => a.start - b.start || b.end - a.end);
  const colEnds = [];
  for (const it of items) {
    let c = colEnds.findIndex(end => end <= it.start);
    if (c < 0) { c = colEnds.length; colEnds.push(it.end); }
    else colEnds[c] = it.end;
    it.col = c;
  }
  for (const it of items) {
    let n = it.col + 1;
    for (const other of items) {
      if (other.start < it.end && it.start < other.end) n = Math.max(n, other.col + 1);
    }
    it.cols = n;
  }
  return items.map(it => ({
    ev: it.ev,
    col: it.col,
    cols: it.cols,
    top: ((it.start - origin) / 30) * SLOT_H,
    height: Math.max(18, ((it.end - it.start) / 30) * SLOT_H - 2)
  }));
}
function monthHtml(days) {
  const month = calAnchor.slice(0, 7), today = melbourneToday();
  const head = CAL_DOW.map(d => `<div class="caldow">${d}</div>`).join('');
  const cells = days.map(iso => {
    const list = eventsOn(iso);
    const cls = ['calcell', iso.slice(0, 7) !== month ? 'is-out' : '', iso === today ? 'is-today' : '', iso === calSelected ? 'is-sel' : '', list.length ? 'is-busy' : ''].filter(Boolean).join(' ');
    const dots = list.slice(0, 4).map(ev => `<span class="caldot tone-${colourOf(ev)}" aria-hidden="true"></span>`).join('');
    return `<div class="${cls}" data-day="${iso}" aria-label="${esc(longDay(iso))}"><span class="calcell__d">${+iso.slice(8)}</span>${list.length ? `<span class="caldots">${dots}</span>` : ''}${list.map(ev => eventButton(ev, iso)).join('')}</div>`;
  }).join('');
  return `<div class="calgrid" aria-label="${esc(rangeLabel(days))}">${head}${cells}</div>`;
}
function weekDay(iso, today, grid) {
  const cls = ['calday', iso === today ? 'is-today' : '', iso === calSelected ? 'is-sel' : ''].filter(Boolean).join(' ');
  const list = grid ? splitDay(iso).all : eventsOn(iso);
  const body = list.length ? list.map(ev => eventButton(ev, iso)).join('') : (grid ? '' : '<p class="small dim calday__empty">Nothing scheduled</p>');
  return `<section class="${cls}" data-day="${iso}"><div class="calday__h"><button type="button" data-pick="${iso}">${esc(fmtUTC(iso, { weekday: 'short', day: 'numeric', month: 'short' }))}</button><button type="button" class="lnk" data-add-day="${iso}">Add</button></div><div class="calday__all">${body}</div></section>`;
}
function weekHtml(days) {
  const today = melbourneToday();
  const grid = weekGridMq.matches && weekHasTimed(days);
  if (!grid) return `<div class="calweek">${days.map(iso => weekDay(iso, today, false)).join('')}</div>`;
  const slots = weekSlots(days);
  const origin = minutesOf(slots[0]);
  const heads = `<div class="calgutter" aria-hidden="true"></div>${days.map(iso => weekDay(iso, today, true)).join('')}`;
  const ticks = `<div class="calgutter calgutter--times" aria-hidden="true">${slots.map(s => `<div class="caltick${s.slice(3) === '00' ? ' is-hour' : ''}">${s.slice(3) === '00' ? esc(hourLabel(s)) : ''}</div>`).join('')}</div>`;
  const cols = days.map(iso => {
    const mark = [iso === today ? 'is-today' : '', iso === calSelected ? 'is-sel' : ''].filter(Boolean).join(' ');
    const slotDivs = slots.map(s => `<div class="calslot${s.slice(3) === '00' ? ' is-hour' : ''}" data-slot="${s}"></div>`).join('');
    const chips = layoutTimed(splitDay(iso).timed, origin).map(pos => eventButton(pos.ev, iso, pos)).join('');
    return `<div class="calhours ${mark}" data-day="${iso}">${slotDivs}${chips}</div>`;
  }).join('');
  return `<div class="calweek has-hours"><div class="calweek__heads">${heads}</div><div class="caltimescroll"><div class="caltimesheet">${ticks}${cols}</div></div></div>`;
}
function dayRow(ev) {
  const colour = colourOf(ev);
  const open = ev.kind === 'job' && ev.href ? `<a class="lnk" href="${esc(ev.href)}">Open job</a>` : '';
  return `<div class="calpick__row tone-${colour}" data-kind="${ev.kind === 'job' ? 'job' : 'event'}" data-colour="${colour}"><button type="button" class="calpick__ev" data-ev="${esc(ev.id)}"><span class="k">${esc(timeRange(ev))}</span><b>${esc(ev.title)}</b>${ev.notes ? `<p>${esc(ev.notes)}</p>` : ''}</button>${open}</div>`;
}
function dayPanel(iso) {
  const list = eventsOn(iso);
  const rows = list.length ? list.map(dayRow).join('') : '<p class="dim" style="margin:8px 0 0">Nothing on this day. Add a deadline, meeting or note.</p>';
  return `<section class="panel calpick" aria-live="polite"><div class="calpick__h"><h2 class="h3">${esc(longDay(iso))}</h2><button type="button" class="btn btn--sm" data-add-day="${iso}">Add event</button></div>${rows}</section>`;
}
function renderCal() {
  const days = visibleDays();
  if (!days.includes(calSelected)) calSelected = days.includes(calAnchor) ? calAnchor : days[0];
  if (!$('[data-cal-root]', app)) {
    app.innerHTML = band(`<a href="${B}/studio" style="text-decoration:none">← All jobs</a>`, 'Staff <span class="ol">calendar.</span>', 'Proof jobs show up on their own, with deadlines and meetings. Drag an event to another day. Times are Australia/Melbourne.', `<button class="btn" type="button" data-cal-new>New event ${ARROW}</button>`) +
      '<div class="wrap cal" data-cal-root><div data-cal-body></div></div>';
  }
  const root = $('[data-cal-root]', app);
  root.dataset.cal = calMode;
  $('[data-cal-body]', root).innerHTML = `<div class="calbar">
      <div class="calnav"><button class="ibtn" type="button" data-cal-prev aria-label="${calMode === 'week' ? 'Previous week' : 'Previous month'}">‹</button><h2 class="caltitle">${esc(rangeLabel(days))}</h2><button class="ibtn" type="button" data-cal-next aria-label="${calMode === 'week' ? 'Next week' : 'Next month'}">›</button></div>
      <div class="calbar__r">
        <div class="tabs" role="tablist"><button type="button" data-cal-mode="month" class="${calMode === 'month' ? 'on' : ''}" role="tab" aria-selected="${calMode === 'month'}">Month</button><button type="button" data-cal-mode="week" class="${calMode === 'week' ? 'on' : ''}" role="tab" aria-selected="${calMode === 'week'}">Week</button></div>
        <button type="button" class="btn btn--sm btn--ghost" data-cal-today>Today</button>
        <button type="button" class="btn btn--sm" data-cal-new>New event</button>
      </div>
    </div>
    <p class="small dim calhint">Drag an event onto a day to reschedule it. In week view, drop a timed event on a time to change the clock.</p>
    ${calMode === 'month' ? monthHtml(days) : weekHtml(days)}
    ${dayPanel(calSelected)}`;
  const pick = iso => { calSelected = iso; if (calMode === 'month' && iso.slice(0, 7) !== calAnchor.slice(0, 7)) calAnchor = iso; renderCal(); };
  $('[data-cal-prev]', root).onclick = () => { calAnchor = calMode === 'week' ? addDays(calAnchor, -7) : shiftMonth(calAnchor, -1); renderCal(); };
  $('[data-cal-next]', root).onclick = () => { calAnchor = calMode === 'week' ? addDays(calAnchor, 7) : shiftMonth(calAnchor, 1); renderCal(); };
  $('[data-cal-today]', root).onclick = () => { calAnchor = calSelected = melbourneToday(); renderCal(); };
  $$('[data-cal-mode]', root).forEach(b => b.onclick = () => { calMode = b.dataset.calMode; renderCal(); });
  $$('[data-cal-new]', app).forEach(b => b.onclick = () => openEvent(null, calSelected || calAnchor));
  $$('[data-day]', root).forEach(cell => cell.onclick = e => {
    if (calSuppressClick) return;
    if (e.target.closest('[data-ev],[data-add-day],[data-pick]')) return;
    pick(cell.dataset.day);
  });
  $$('[data-pick]', root).forEach(b => b.onclick = () => pick(b.dataset.pick));
  $$('[data-add-day]', root).forEach(b => b.onclick = () => openEvent(null, b.dataset.addDay));
  $$('[data-ev]', root).forEach(b => b.onclick = e => {
    if (calSuppressClick) return;
    e.stopPropagation();
    const ev = calEvents.find(x => x.id === b.dataset.ev);
    if (ev) openEvent(ev);
  });
}
async function calendar() {
  const gen = ++calGen;
  const data = await api(B + '/api/calendar/events');
  if (gen !== calGen || (calDrag && calDrag.moved) || calSaving) return;
  calEvents = data.events || [];
  confirmedEvents = calEvents.map(x => ({ ...x }));
  if (!calAnchor) calAnchor = melbourneToday();
  renderCal();
}
function spansMatch(ev, start, end) {
  return !!ev && String(ev.start) === String(start) && String(ev.end || '') === String(end || '');
}
function cssEscape(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/([^a-zA-Z0-9_-])/g, '\\$1'); }
function swallowNextClick() {
  calSuppressClick = true;
  setTimeout(() => { calSuppressClick = false; }, 0);
}
function teardownDrag() {
  document.querySelectorAll('.calev.is-dragging').forEach(el => el.classList.remove('is-dragging'));
  document.querySelectorAll('.is-drop, .is-drop-day').forEach(el => el.classList.remove('is-drop', 'is-drop-day'));
  if (calDrag && calDrag.ghost) calDrag.ghost.remove();
  document.body.classList.remove('is-cal-drag');
  calDrag = null;
}
function dropTargetAt(x, y) {
  const root = $('[data-cal-root]');
  if (!root) return null;
  const stack = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
  for (const el of stack) {
    if (!el || !el.closest) continue;
    const day = el.closest('[data-day]');
    if (!day || !root.contains(day)) continue;
    const hours = el.closest('.calhours');
    const slotEl = el.closest('[data-slot]');
    const slot = hours && slotEl && hours.contains(slotEl) ? slotEl.dataset.slot : null;
    return { day: day.dataset.day, slot };
  }
  return null;
}
function paintDrop(drop) {
  document.querySelectorAll('.is-drop, .is-drop-day').forEach(el => el.classList.remove('is-drop', 'is-drop-day'));
  const root = $('[data-cal-root]');
  if (!drop || !root) return;
  $$(`[data-day="${drop.day}"]`, root).forEach(el => el.classList.add(drop.slot ? 'is-drop-day' : 'is-drop'));
  if (drop.slot) {
    const slot = $(`.calhours[data-day="${drop.day}"] [data-slot="${drop.slot}"]`, root);
    if (slot) slot.classList.add('is-drop');
  }
}
function beginCalDrag(e) {
  const drag = calDrag;
  drag.moved = true;
  document.body.classList.add('is-cal-drag');
  const root = $('[data-cal-root]');
  const ev = calEvents.find(x => x.id === drag.id);
  drag.timed = !!(ev && !ev.allDay && ev.kind !== 'job');
  if (root) $$(`.calev[data-ev="${cssEscape(drag.id)}"]`, root).forEach(el => el.classList.add('is-dragging'));
  const ghost = drag.chip.cloneNode(true);
  ghost.classList.remove('is-dragging');
  ghost.removeAttribute('style');
  ghost.classList.add('calev--ghost');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.tabIndex = -1;
  document.body.append(ghost);
  drag.ghost = ghost;
  drag.timeLabel = ghost.querySelector('.calev__t')?.textContent || '';
  try { drag.chip.setPointerCapture(e.pointerId); } catch { /* detached chip */ }
}
function moveGhost(e, drop) {
  const drag = calDrag;
  if (!drag || !drag.ghost) return;
  const w = drag.ghost.offsetWidth || 168;
  const h = drag.ghost.offsetHeight || 36;
  let left = e.clientX + 12, top = e.clientY + 10;
  if (left + w > window.innerWidth - 8) left = Math.max(8, e.clientX - w - 12);
  if (top + h > window.innerHeight - 8) top = Math.max(8, e.clientY - h - 12);
  drag.ghost.style.left = `${Math.round(left)}px`;
  drag.ghost.style.top = `${Math.round(top)}px`;
  const label = drag.timed && drag.ghost.querySelector('.calev__t');
  if (label) label.textContent = drop && drop.slot ? fmtClock(drop.slot) : drag.timeLabel;
}
function commitMove(from, drop) {
  const ev = calEvents.find(x => x.id === from.id);
  if (!ev) { toast('That event is no longer on the calendar'); return; }
  const slot = ev.allDay || ev.kind === 'job' ? null : drop.slot;
  const next = movedTimes(ev, from.fromDay, drop.day, slot);
  if (sameSpan(ev, next)) return;
  const prevSelected = calSelected;
  const kind = ev.kind, allDay = !!ev.allDay, id = ev.id;
  const jobKey = ev.jobId || ev.jobNumber;
  calEvents = calEvents.map(x => x.id === id ? { ...x, start: next.start, end: next.end } : x);
  calSelected = drop.day;
  renderCal();
  const day = shortDay(String(next.start).slice(0, 10));
  const label = kind === 'job' ? `Job moved to ${day}` : (allDay ? `Moved to ${day}` : `Moved to ${day} · ${fmtClock(String(next.start).slice(11, 16))}`);
  const url = kind === 'job'
    ? `${B}/api/calendar/jobs/${encodeURIComponent(jobKey)}`
    : `${B}/api/calendar/events/${encodeURIComponent(id)}`;
  const body = kind === 'job' ? { date: String(next.start).slice(0, 10) } : { start: next.start, end: next.end };
  calSaving++;
  moveQueue = moveQueue.then(async () => {
    try {
      await api(url, { method: 'PATCH', body: JSON.stringify(body) });
      confirmedEvents = confirmedEvents.map(x => x.id === id ? { ...x, start: next.start, end: next.end } : x);
      if (spansMatch(calEvents.find(x => x.id === id), next.start, next.end)) toast(label);
    } catch (err) {
      if (!spansMatch(calEvents.find(x => x.id === id), next.start, next.end)) return;
      const prev = confirmedEvents.find(x => x.id === id);
      if (prev) calEvents = calEvents.map(x => x.id === id ? { ...prev } : x);
      if (calSelected === drop.day) calSelected = prevSelected;
      renderCal();
      toast(err.message || 'Couldn’t move that');
    } finally { calSaving--; }
  }).catch(() => {});
}
function onCalPointerDown(e) {
  if (e.button !== 0 || calDrag) return;
  const chip = e.target.closest && e.target.closest('.calev[data-ev]');
  const root = $('[data-cal-root]');
  if (!chip || !root || !root.contains(chip)) return;
  const dayEl = chip.closest('[data-day]');
  if (!dayEl) return;
  calDrag = { id: chip.dataset.ev, fromDay: dayEl.dataset.day, x: e.clientX, y: e.clientY, pointerId: e.pointerId, moved: false, chip };
}
function onCalPointerMove(e) {
  const drag = calDrag;
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (!drag.moved) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (dx * dx + dy * dy < DRAG_PX * DRAG_PX) return;
    beginCalDrag(e);
  }
  e.preventDefault();
  const drop = dropTargetAt(e.clientX, e.clientY);
  moveGhost(e, drop);
  paintDrop(drop);
}
function onCalPointerUp(e) {
  const drag = calDrag;
  if (!drag || e.pointerId !== drag.pointerId) return;
  const moved = drag.moved;
  const drop = moved ? dropTargetAt(e.clientX, e.clientY) : null;
  const from = { id: drag.id, fromDay: drag.fromDay };
  teardownDrag();
  if (!moved) return;
  swallowNextClick();
  if (drop) commitMove(from, drop);
}
function onCalPointerCancel(e) {
  if (!calDrag || (e && e.pointerId !== calDrag.pointerId)) return;
  const moved = calDrag.moved;
  teardownDrag();
  if (moved) swallowNextClick();
}
document.addEventListener('pointerdown', onCalPointerDown);
document.addEventListener('pointermove', onCalPointerMove, { passive: false });
document.addEventListener('pointerup', onCalPointerUp);
document.addEventListener('pointercancel', onCalPointerCancel);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && calDrag) onCalPointerCancel({ pointerId: calDrag.pointerId }); });
document.addEventListener('click', e => {
  if (!calSuppressClick) return;
  calSuppressClick = false;
  e.preventDefault();
  e.stopPropagation();
}, true);
function ensureEventModal() {
  let modal = $('#evModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.className = 'modal'; modal.id = 'evModal'; modal.hidden = true;
  modal.innerHTML = `<form class="panel" id="evForm" novalidate autocomplete="off">
    <div class="modal__h"><h2 class="h3" data-ev-h>New event</h2><button type="button" class="ibtn" data-ev-close aria-label="Close">✕</button></div>
    <p class="small mute" data-ev-job hidden>This proof is on the calendar automatically. Change its day or colour here — the job stays on its studio page.</p>
    <p class="small" data-ev-job-notes hidden></p>
    <div class="grid2">
      <div class="field field--full"><label for="ev-title">Title</label><input id="ev-title" maxlength="200" placeholder="Deadline, meeting, note…"></div>
      <label class="check field--full" data-ev-allday-row><input id="ev-allday" type="checkbox"> All day</label>
      <div class="field"><label for="ev-sd" id="ev-sd-label">Start date</label><input id="ev-sd" type="date" min="2000-01-01" max="2100-12-31" required></div>
      <div class="field" data-ev-st><label for="ev-st">Start time <span class="opt">(Melbourne)</span></label><input id="ev-st" type="time"></div>
      <div class="field" data-ev-ed><label for="ev-ed">End date <span class="opt">(optional)</span></label><input id="ev-ed" type="date" min="2000-01-01" max="2100-12-31"></div>
      <div class="field" data-ev-et><label for="ev-et">End time <span class="opt">(optional)</span></label><input id="ev-et" type="time"></div>
      <div class="field field--full" data-ev-notes-row><label for="ev-notes">Notes <span class="opt">(optional)</span></label><textarea id="ev-notes" maxlength="4000" style="min-height:90px" placeholder="Who’s coming, where, what to bring…"></textarea></div>
      <div class="field field--full"><span class="k" id="ev-colour-label">Colour</span>${colourSwatches()}</div>
    </div>
    <div class="btns" style="margin-top:30px"><button class="btn" type="submit" id="ev-save">Save event</button><a class="btn btn--ghost" data-ev-open href="${B}/studio" hidden>Open job</a><button type="button" class="btn btn--ghost" data-ev-close>Cancel</button><button type="button" class="btn btn--ghost" data-ev-del hidden>Delete</button></div>
    <p class="msg" data-ev-msg></p>
  </form>`;
  document.body.append(modal);
  const close = () => { modal.hidden = true; };
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  $$('[data-ev-close]', modal).forEach(b => b.onclick = close);
  $('#ev-allday', modal).onchange = syncEventFields;
  $('#evForm', modal).onsubmit = saveEvent;
  $('[data-ev-del]', modal).onclick = deleteEvent;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });
  return modal;
}
function selectedColour() {
  const el = $('#evForm input[name="ev-colour"]:checked');
  return CAL_COLOURS.some(([name]) => name === el?.value) ? el.value : 'grey';
}
function setColour(c) {
  const want = CAL_COLOURS.some(([name]) => name === c) ? c : 'grey';
  $$('#evForm input[name="ev-colour"]').forEach(el => { el.checked = el.value === want; });
}
function syncEventFields() {
  const jobMode = !!editingJobId;
  const allDay = $('#ev-allday').checked;
  $('[data-ev-job]').hidden = !jobMode;
  const jobNotes = $('[data-ev-job-notes]');
  jobNotes.hidden = !jobMode || !jobNotes.textContent;
  $('[data-ev-allday-row]').hidden = jobMode;
  $('[data-ev-ed]').hidden = jobMode;
  $('[data-ev-notes-row]').hidden = jobMode;
  $('[data-ev-st]').hidden = jobMode || allDay;
  $('[data-ev-et]').hidden = jobMode || allDay;
}
function openEvent(ev, day) {
  const modal = ensureEventModal();
  const jobMode = !!(ev && ev.kind === 'job');
  editingId = ev && !jobMode ? ev.id : null;
  editingJobId = jobMode ? ev.jobId : null;
  $('[data-ev-h]', modal).textContent = jobMode ? 'Proof on the calendar' : (ev ? 'Edit event' : 'New event');
  $('[data-ev-del]', modal).hidden = !editingId;
  $('#ev-save').textContent = jobMode ? 'Save' : 'Save event';
  const open = $('[data-ev-open]', modal);
  open.hidden = !jobMode;
  if (jobMode) open.href = ev.href || `${B}/studio`;
  const jobNotes = $('[data-ev-job-notes]', modal);
  jobNotes.textContent = jobMode ? (ev.notes || '') : '';
  jobNotes.hidden = !jobMode || !ev.notes;
  const msg = $('[data-ev-msg]', modal); msg.className = 'msg'; msg.textContent = '';
  const dayIso = day || (ev ? String(ev.start).slice(0, 10) : melbourneToday());
  const title = $('#ev-title');
  title.readOnly = jobMode;
  title.value = ev ? ev.title : '';
  $('#ev-sd-label').textContent = jobMode ? 'Calendar date' : 'Start date';
  $('#ev-allday').checked = jobMode ? true : !!(ev && ev.allDay);
  $('#ev-sd').value = ev ? String(ev.start).slice(0, 10) : dayIso;
  $('#ev-st').value = ev && !ev.allDay ? String(ev.start).slice(11, 16) : '09:00';
  $('#ev-ed').value = ev && ev.end ? String(ev.end).slice(0, 10) : '';
  $('#ev-et').value = ev && ev.end && !ev.allDay ? String(ev.end).slice(11, 16) : '';
  $('#ev-notes').value = ev && !jobMode ? (ev.notes || '') : '';
  setColour(ev ? ev.colour : 'grey');
  syncEventFields();
  modal.hidden = false;
  (jobMode ? $('#ev-sd') : title).focus();
}
function eventPayload() {
  const allDay = $('#ev-allday').checked;
  const title = $('#ev-title').value.trim();
  const sd = $('#ev-sd').value, st = $('#ev-st').value, ed = $('#ev-ed').value, et = $('#ev-et').value;
  const colour = selectedColour();
  if (editingJobId) {
    if (!sd) return { error: 'Add a date.' };
    return { body: { date: sd, colour }, day: sd };
  }
  if (!title) return { error: 'Add a title.' };
  if (!sd) return { error: 'Add a start date.' };
  if (!allDay && !st) return { error: 'Add a start time, or mark it as all day.' };
  let end = null;
  if (allDay) { if (ed) end = ed; }
  else if (ed || et) {
    if (!ed || !et) return { error: 'Add both an end date and time, or leave the end blank.' };
    end = `${ed}T${et}`;
  }
  return { body: { title, allDay, start: allDay ? sd : `${sd}T${st}`, end, notes: $('#ev-notes').value, colour }, day: sd };
}
async function saveEvent(e) {
  e.preventDefault();
  const msg = $('[data-ev-msg]'), built = eventPayload();
  msg.className = 'msg'; msg.textContent = '';
  if (built.error) { msg.className = 'msg err'; msg.textContent = built.error; return; }
  const go = $('#ev-save'); go.disabled = true;
  try {
    const url = editingJobId ? `${B}/api/calendar/jobs/${encodeURIComponent(editingJobId)}` : (editingId ? `${B}/api/calendar/events/${editingId}` : B + '/api/calendar/events');
    const method = editingJobId || editingId ? 'PATCH' : 'POST';
    await api(url, { method, body: JSON.stringify(built.body) });
    $('#evModal').hidden = true;
    toast(editingJobId ? 'Job updated on the calendar' : (editingId ? 'Event updated' : 'Event added'));
    calAnchor = calSelected = built.day;
    await calendar();
  } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; }
  finally { go.disabled = false; }
}
async function deleteEvent() {
  if (!editingId || !confirm('Delete this event?')) return;
  const btn = $('[data-ev-del]'), msg = $('[data-ev-msg]');
  btn.disabled = true; msg.className = 'msg'; msg.textContent = '';
  try {
    await api(`${B}/api/calendar/events/${editingId}`, { method: 'DELETE' });
    $('#evModal').hidden = true;
    toast('Event deleted');
    await calendar();
  } catch (err) { msg.className = 'msg err'; msg.textContent = err.message; }
  finally { btn.disabled = false; }
}

async function settings() {
  const s = await api(B + '/api/settings');
  app.innerHTML = band('YBI Studio', 'Settings') + `<div class="wrap"><div class="panel" style="margin-top:36px;max-width:760px">
   <div class="field"><label>Notification email</label><input data-email type="email" value="${esc(s.notifyEmail)}" placeholder="e.g. drew@ybicreative.com.au"></div>
   <p class="small mute">Email alerts: <b>${s.emailEnabled ? 'ON (SMTP configured)' : 'OFF'}</b>. ${s.emailEnabled ? '' : 'Approvals and change requests still show on the Jobs dashboard and in <code>data/notifications.log</code>. To switch email on, set the SMTP_* variables — see README.'}</p>
   <p class="small mute">Clients only open a proof from the private link on the job (<b>…?k=</b>). A job number on its own does not work.</p>
   <div class="btns" style="margin-top:20px"><button class="btn btn--sm" data-save>Save</button><button class="btn btn--sm btn--ghost" data-out>Log out</button></div></div></div>`;
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

function markNav() {
  const here = location.pathname.replace(/\/$/, '');
  $$('.hdr__r a').forEach(a => {
    const on = a.pathname.replace(/\/$/, '') === here;
    a.classList.toggle('on', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}
async function route() {
  markNav();
  const rest = decodeURIComponent(location.pathname.slice(B.length).replace(/^\/studio\/?/, '').replace(/\/$/, ''));
  try {
    if (rest === 'settings') await settings();
    else if (rest === 'calendar') await calendar();
    else if (rest) await jobPage(rest);
    else await dashboard();
  } catch (e) { if (e.status === 401) location.href = B + '/'; else app.innerHTML = `<div class="wrap" style="padding-top:80px;padding-bottom:80px"><p class="msg err">${esc(e.message)}</p><a class="lnk" href="${B}/studio">Back to jobs</a></div>`; }
}
route();
// light polling so new client feedback shows up on the dashboard
const onDash = () => !location.pathname.slice(B.length).replace(/^\/studio\/?/, '');
const onCal = () => location.pathname.replace(/\/$/, '').endsWith('/studio/calendar');
weekGridMq.addEventListener('change', () => {
  if (calDrag && calDrag.moved) return;
  if (onCal() && $('[data-cal-root]')) renderCal();
});
setInterval(() => { const typing = document.activeElement && document.activeElement.matches && document.activeElement.matches('input,textarea'); if (onDash() && modal.hidden && document.visibilityState === 'visible' && !typing) dashboard().catch(() => {}); }, 30000);
document.addEventListener('visibilitychange', () => {
  const ev = $('#evModal');
  if (document.visibilityState === 'visible' && onCal() && !(ev && !ev.hidden)) calendar().catch(() => {});
});
