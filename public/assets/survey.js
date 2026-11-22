// YBI FX site survey. Studio only. Sizes are typed (Measure app or a laser).
// A reference scale on a photo is a rough check, not a measured survey.
import { B, $, $$, esc, fmtDate, api, upload, toast, engineBand } from './common.js';
import { commitDimensionLabel, dimensionFromDrag } from './survey-mark.mjs';

const TYPES = [
  ['fascia', 'Fascia'],
  ['pylon', 'Pylon'],
  ['window', 'Window'],
  ['wall', 'Wall'],
  ['vehicle', 'Vehicle'],
  ['wayfinding', 'Wayfinding'],
  ['other', 'Other']
];
const LIGHTS = [
  ['', 'Not specified'],
  ['none', 'Not illuminated'],
  ['front', 'Front lit'],
  ['halo', 'Halo / back lit'],
  ['internal', 'Internal'],
  ['neon', 'Neon'],
  ['other', 'Other']
];
const TYPE_OK = new Set(TYPES.map(([id]) => id));
const LIGHT_OK = new Set(LIGHTS.map(([id]) => id));

function band(eyebrow, title, sub = '', right = '') {
  return engineBand(`<div class="eband__row"><div><p class="eyebrow">${eyebrow}</p><h1 class="h1">${title}</h1>${sub ? `<p class="lede">${sub}</p>` : ''}</div>${right ? `<div class="sv-band">${right}</div>` : ''}</div>`);
}
function go(href) {
  const url = new URL(href, location.origin);
  const next = url.pathname + url.search + url.hash;
  if (next !== location.pathname + location.search + location.hash) history.pushState(null, '', next);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Melbourne' });
}
function showDay(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}
function rememberedSurveyor() {
  try { return localStorage.getItem('ybi-fx-surveyor') || ''; } catch { return ''; }
}
function rememberSurveyor(name) {
  try { if (name) localStorage.setItem('ybi-fx-surveyor', name); } catch { /* private mode */ }
}
function options(list, value) {
  return list.map(([id, label]) => `<option value="${esc(id)}"${id === value ? ' selected' : ''}>${esc(label)}</option>`).join('');
}
function jobOptions(jobs, selected) {
  const rows = (Array.isArray(jobs) ? jobs : [])
    .filter(j => j && j.id)
    .slice()
    .sort((a, b) => String(a.jobNumber || a.clientName || '').localeCompare(String(b.jobNumber || b.clientName || ''), undefined, { numeric: true, sensitivity: 'base' }));
  return `<option value="">Not linked</option>${rows.map(j => `<option value="${esc(j.id)}"${j.id === selected ? ' selected' : ''}>${esc(j.jobNumber || 'No number')} — ${esc(j.clientName || '')}</option>`).join('')}`;
}
function suggestNumber(id) {
  return `SV-${String(id || '').slice(0, 4).toUpperCase()}`;
}

let listQuery = '';
let renderGen = 0;

export async function surveyRoute(rest) {
  document.title = 'Site survey · YBI FX Proofs';
  if (rest === 'survey') return surveyList();
  if (rest === 'survey/new') return surveyNew();
  const id = rest.slice('survey/'.length);
  if (!/^[a-f0-9]{16}$/.test(id)) {
    const err = new Error('No survey with that id.');
    err.status = 404;
    throw err;
  }
  return surveyEdit(id);
}

async function surveyList() {
  const my = ++renderGen;
  const data = await api(B + '/api/surveys');
  if (my !== renderGen) return;
  const surveys = data.surveys || [];
  const app = $('#app');
  app.innerHTML = band('YBI FX Studio', 'Site <span class="ol">survey.</span>', 'On site, record every sign. Sizes are typed from the Measure app or a laser.', `<a class="btn" href="${B}/studio/survey/new">New survey</a>`) +
    `<div class="wrap sv-page">
      <div class="toolbar"><input class="search" placeholder="Search site, surveyor, address…" value="${esc(listQuery)}" aria-label="Search surveys"></div>
      <table class="jobs"><thead><tr><th>Site</th><th>Date</th><th class="hide-m">Surveyor</th><th>Signs</th><th class="hide-m">Job</th><th class="hide-m">Updated</th><th></th></tr></thead><tbody></tbody></table>
    </div>`;
  const tb = $('tbody', app);
  const draw = () => {
    const q = listQuery.trim().toLowerCase();
    const list = surveys.filter(s => {
      if (!q) return true;
      const hay = `${s.client} ${s.address} ${s.surveyor} ${s.contact} ${s.notes} ${(s.signNames || []).join(' ')} ${s.jobNumber || ''}`.toLowerCase();
      return hay.includes(q);
    });
    const empty = !surveys.length ? 'No surveys yet. Start one on site and add a sign for every piece.' : 'No surveys match.';
    tb.innerHTML = list.length ? list.map(s => {
      const n = s.signCount || 0;
      const photos = s.photoCount ? ` · ${s.photoCount} photo${s.photoCount === 1 ? '' : 's'}` : '';
      return `<tr class="row" data-href="${B}/studio/survey/${s.id}"><td class="num">${esc(s.client)}${s.address ? `<div class="small dim">${esc(s.address)}</div>` : ''}</td><td>${esc(showDay(s.date))}</td><td class="hide-m">${esc(s.surveyor || '—')}</td><td>${n} sign${n === 1 ? '' : 's'}${photos}</td><td class="hide-m">${s.jobNumber ? esc(s.jobNumber) : '—'}</td><td class="hide-m small dim">${fmtDate(s.updatedAt)}</td><td><button type="button" class="lnk sv-hit" data-del="${s.id}">Delete</button></td></tr>`;
    }).join('') : `<tr><td colspan="7" class="empty">${empty}</td></tr>`;
    $$('tr.row', tb).forEach(r => r.onclick = () => go(r.dataset.href));
    $$('[data-del]', tb).forEach(btn => btn.onclick = async e => {
      e.stopPropagation();
      const row = surveys.find(s => s.id === btn.dataset.del);
      const name = row ? row.client : 'this survey';
      if (!confirm(`Delete the site survey for ${name}? Photos go with it. A linked job stays.`)) return;
      btn.disabled = true;
      try {
        await api(`${B}/api/surveys/${btn.dataset.del}`, { method: 'DELETE' });
        toast('Survey deleted');
        await surveyList();
      } catch (err) {
        toast(err.message || 'Could not delete');
        btn.disabled = false;
      }
    });
  };
  draw();
  $('.search', app).oninput = e => { listQuery = e.target.value; draw(); };
}

function headerFields(s, jobs) {
  const date = s.date || today();
  const surveyor = s.surveyor || rememberedSurveyor();
  return `<div class="grid2 sv-fields">
    <div class="field"><label for="sv-client">Client / site</label><input id="sv-client" data-client required maxlength="160" value="${esc(s.client || '')}" autocomplete="organization" placeholder="Hovey’s Transport"></div>
    <div class="field"><label for="sv-date">Date</label><input id="sv-date" data-date type="date" required value="${esc(date)}"></div>
    <div class="field field--full"><label for="sv-address">Address <span class="opt">(optional)</span></label><input id="sv-address" data-address maxlength="300" value="${esc(s.address || '')}" autocomplete="street-address" placeholder="Street, suburb"></div>
    <div class="field field--full sv-loc">
      <button type="button" class="btn btn--ghost sv-hit" data-gps>Use phone location</button>
      <p class="small dim" data-gps-note>${s.lat != null && s.lng != null ? `GPS saved · ${Number(s.lat).toFixed(5)}, ${Number(s.lng).toFixed(5)}` : 'Optional. The address is what the report prints first.'}</p>
      <input type="hidden" data-lat value="${s.lat == null ? '' : esc(s.lat)}">
      <input type="hidden" data-lng value="${s.lng == null ? '' : esc(s.lng)}">
    </div>
    <div class="field"><label for="sv-who">Surveyor</label><input id="sv-who" data-surveyor maxlength="120" value="${esc(surveyor)}" autocomplete="name" placeholder="Your name"></div>
    <div class="field"><label for="sv-contact">Contact on site <span class="opt">(optional)</span></label><input id="sv-contact" data-contact maxlength="160" value="${esc(s.contact || '')}" autocomplete="name"></div>
    <div class="field field--full"><label for="sv-notes">General notes</label><textarea id="sv-notes" data-notes maxlength="4000" placeholder="Gate code, who to ask, power on site…">${esc(s.notes || '')}</textarea></div>
    <div class="field field--full"><label for="sv-job">Link to a job or quote <span class="opt">(optional)</span></label><select id="sv-job" data-job>${jobOptions(jobs, s.jobId || '')}</select>${s.jobMissing ? '<p class="small dim">That job is gone. Save to clear the link.</p>' : ''}</div>
  </div>`;
}

function readHeader(root) {
  const lat = $('[data-lat]', root).value;
  const lng = $('[data-lng]', root).value;
  return {
    client: $('[data-client]', root).value.trim(),
    date: $('[data-date]', root).value,
    address: $('[data-address]', root).value.trim(),
    lat: lat === '' ? null : Number(lat),
    lng: lng === '' ? null : Number(lng),
    surveyor: $('[data-surveyor]', root).value.trim(),
    contact: $('[data-contact]', root).value.trim(),
    notes: $('[data-notes]', root).value.trim(),
    jobId: $('[data-job]', root).value
  };
}

async function surveyNew() {
  const my = ++renderGen;
  let jobs = [];
  try { jobs = await api(B + '/api/jobs'); } catch (e) { if (e.status === 401) throw e; }
  if (my !== renderGen) return;
  const app = $('#app');
  app.innerHTML = band(`<a href="${B}/studio/survey" style="text-decoration:none">← Surveys</a>`, 'New <span class="ol">survey.</span>', 'Client and date are enough to start. Add signs on the next screen.') +
    `<div class="wrap sv-page"><form class="panel sv-sheet" id="sv-form" novalidate>
      ${headerFields({}, jobs)}
      <div class="sv-dock"><button class="btn sv-hit" type="submit">Create survey</button></div>
      <p class="msg" data-msg></p>
    </form></div>`;
  bindGps($('#sv-form'));
  $('#sv-form').onsubmit = async e => {
    e.preventDefault();
    const msg = $('[data-msg]');
    const btn = $('button[type=submit]', e.target);
    msg.className = 'msg'; msg.textContent = '';
    const body = readHeader(e.target);
    if (!body.client) { msg.className = 'msg err'; msg.textContent = 'Add a client or site name.'; $('[data-client]').focus(); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) { msg.className = 'msg err'; msg.textContent = 'Pick a date.'; return; }
    btn.disabled = true;
    try {
      const saved = await api(B + '/api/surveys', { method: 'POST', body: JSON.stringify(body) });
      rememberSurveyor(body.surveyor);
      toast('Survey started');
      go(`${B}/studio/survey/${saved.id}`);
    } catch (err) {
      msg.className = 'msg err';
      msg.textContent = err.message;
      btn.disabled = false;
    }
  };
  $('[data-client]').focus();
}

function signCard(sign, index) {
  const title = sign.name && sign.name !== 'Untitled sign' ? sign.name : `Sign ${index + 1}`;
  const photos = sign.photos || [];
  return `<article class="panel sv-sign" id="sign-${esc(sign.id)}" data-sign="${esc(sign.id)}">
    <div class="sv-sign__h"><h2 class="h3">${esc(title)}</h2><button type="button" class="lnk sv-hit" data-rm-sign>Remove</button></div>
    <div class="grid2 sv-fields">
      <div class="field"><label>Name</label><input data-name maxlength="160" value="${esc(sign.name || '')}" placeholder="Front fascia"></div>
      <div class="field"><label>Sign type</label><select data-type>${options(TYPES, TYPE_OK.has(sign.type) ? sign.type : 'other')}</select></div>
      <div class="field field--full"><label>Location / placement</label><input data-loc maxlength="500" value="${esc(sign.location || '')}" placeholder="Above the roller door, driver’s side"></div>
      <div class="field field--full"><div class="sv-dims">
        <div class="field"><label>Width (mm)</label><input data-w inputmode="decimal" value="${sign.widthMm ?? ''}" placeholder="2400"></div>
        <div class="field"><label>Height (mm)</label><input data-h inputmode="decimal" value="${sign.heightMm ?? ''}" placeholder="600"></div>
        <div class="field"><label>Install height (mm)</label><input data-ih inputmode="decimal" value="${sign.installHeightMm ?? ''}" placeholder="3200"></div>
        <div class="field"><label>Depth (mm)</label><input data-d inputmode="decimal" value="${sign.depthMm ?? ''}" placeholder="—"></div>
      </div><p class="small dim">Type the size from the Measure app or a laser. Install height is to the bottom of the sign. Depth is how far it stands off the wall.</p></div>
      <div class="field"><label>Surface</label><input data-sub maxlength="200" value="${esc(sign.substrate || '')}" placeholder="Colorbond, brick, glass, ACM"></div>
      <div class="field"><label>Illumination</label><select data-light>${options(LIGHTS, LIGHT_OK.has(sign.illumination) ? sign.illumination : '')}</select></div>
      <div class="field"><label>Quantity</label><input data-qty inputmode="numeric" value="${esc(sign.quantity || 1)}"></div>
      <div class="field"><label>Access</label><input data-access maxlength="1000" value="${esc(sign.access || '')}" placeholder="Ladder, EWP, power, after hours"></div>
      <div class="field field--full"><label>Notes</label><textarea data-notes maxlength="4000" placeholder="Fixings, colours, what has to come down first…">${esc(sign.notes || '')}</textarea></div>
    </div>
    <div class="sv-photos">${photos.map(photoCard).join('')}</div>
    <div class="sv-photoadd">
      <button type="button" class="btn sv-hit" data-cam>Take photo</button>
      <button type="button" class="btn btn--ghost sv-hit" data-lib>Photo library</button>
      <input class="sv-file" type="file" accept="image/*" capture="environment" data-cam-file aria-hidden="true" tabindex="-1">
      <input class="sv-file" type="file" accept="image/*" data-lib-file aria-hidden="true" tabindex="-1">
    </div>
    <p class="msg" data-sign-msg></p>
  </article>`;
}

function photoCard(photo) {
  const src = photo.annotatedUrl || photo.url;
  const v = photo.markedAt ? `&v=${encodeURIComponent(photo.markedAt)}` : '';
  const href = `${src}${src.includes('?') ? '' : ''}${v}`;
  return `<figure class="sv-shot">
    <img src="${esc(href)}" alt="${esc(photo.originalName || 'Site photo')}">
    ${photo.annotatedUrl ? '<span class="sv-badge">Marked</span>' : ''}
    <div class="sv-shot__bar">
      <button type="button" class="sv-hit" data-mark="${esc(photo.id)}">Mark up</button>
      <button type="button" class="sv-hit" data-rm-photo="${esc(photo.id)}">Remove</button>
    </div>
  </figure>`;
}

function readSign(root) {
  return {
    id: root.dataset.sign,
    name: $('[data-name]', root).value.trim(),
    location: $('[data-loc]', root).value.trim(),
    type: $('[data-type]', root).value,
    widthMm: $('[data-w]', root).value.trim(),
    heightMm: $('[data-h]', root).value.trim(),
    installHeightMm: $('[data-ih]', root).value.trim(),
    depthMm: $('[data-d]', root).value.trim(),
    substrate: $('[data-sub]', root).value.trim(),
    illumination: $('[data-light]', root).value,
    quantity: $('[data-qty]', root).value.trim(),
    access: $('[data-access]', root).value.trim(),
    notes: $('[data-notes]', root).value.trim()
  };
}

function bindGps(root) {
  const btn = $('[data-gps]', root);
  if (!btn) return;
  btn.onclick = () => {
    const note = $('[data-gps-note]', root);
    if (!navigator.geolocation) { note.textContent = 'This browser can’t share location. Type the address.'; return; }
    btn.disabled = true;
    note.textContent = 'Finding location…';
    navigator.geolocation.getCurrentPosition(pos => {
      $('[data-lat]', root).value = String(pos.coords.latitude);
      $('[data-lng]', root).value = String(pos.coords.longitude);
      const acc = Math.round(pos.coords.accuracy || 0);
      note.textContent = acc ? `GPS saved · about ${acc} m` : 'GPS saved';
      btn.disabled = false;
    }, err => {
      note.textContent = err && err.code === 1 ? 'Location permission is off. Type the address instead.' : 'Couldn’t get a location. Type the address, or try again outside.';
      btn.disabled = false;
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  };
}

async function surveyEdit(id) {
  const my = ++renderGen;
  const [survey, jobs] = await Promise.all([
    api(`${B}/api/surveys/${id}`),
    api(B + '/api/jobs').catch(e => { if (e.status === 401) throw e; return []; })
  ]);
  if (my !== renderGen) return;
  paintEdit(survey, jobs);
}

function paintEdit(survey, jobs) {
  const app = $('#app');
  const y = window.scrollY;
  const signs = survey.signs || [];
  const linked = survey.jobId && !survey.jobMissing;
  const quoteHref = survey.quoteId ? `${B}/studio/quote/${survey.quoteId}` : '';
  const jobHref = linked ? `${B}/studio/${encodeURIComponent(survey.jobNumber || survey.jobId)}` : '';
  app.innerHTML = band(`<a href="${B}/studio/survey" style="text-decoration:none">← Surveys</a>`, `${esc(survey.client)} <span class="ol">survey.</span>`, esc([showDay(survey.date), survey.address].filter(Boolean).join(' · '))) +
    `<div class="wrap sv-page">
      <form class="panel sv-sheet" id="sv-form" novalidate>
        ${headerFields(survey, jobs)}
        <p class="msg" data-msg></p>
      </form>
      <div class="sv-signs">${signs.map(signCard).join('') || '<p class="empty">No signs yet. Add one for every piece on site.</p>'}</div>
      <section class="panel sv-start">
        <p class="eyebrow">Quote or job</p>
        ${linked
          ? `<p class="mute">Linked to ${survey.jobNumber ? esc(survey.jobNumber) : 'a job'}. Nothing is emailed from here.</p>
             <div class="btns">${jobHref ? `<a class="btn sv-hit" href="${jobHref}">Open job</a>` : ''}${quoteHref ? `<a class="btn btn--ghost sv-hit" href="${quoteHref}">Open quote</a>` : ''}</div>`
          : `<p class="mute">Each sign becomes a quote line. Prices stay blank for you to fill in. Nothing is emailed.</p>
             <div class="field"><label for="sv-num">Job number</label><input id="sv-num" data-num value="${esc(suggestNumber(survey.id))}" maxlength="40" autocapitalize="characters"></div>
             <div class="btns"><button type="button" class="btn sv-hit" data-quote>Start quote</button><button type="button" class="btn btn--ghost sv-hit" data-proof>Start proof job</button></div>
             <p class="msg" data-spawn></p>`}
      </section>
      <div class="sv-dock" data-dock>
        <button type="button" class="btn sv-hit" data-save>Save</button>
        <button type="button" class="btn btn--ghost sv-hit" data-add>Add sign</button>
        <button type="button" class="btn btn--ghost sv-hit" data-pdf><span class="sv-wide">View PDF</span><span class="sv-narrow">PDF</span></button>
      </div>
    </div>`;
  bindGps($('#sv-form'));
  const form = $('#sv-form');
  $('[data-save]', app).onclick = () => persist(survey.id, { toastOk: true }).catch(() => {});
  const pdfBtn = $('[data-pdf]', app);
  if (pdfBtn) pdfBtn.onclick = () => openSurveyPdf(survey.id);
  $('[data-add]', app).onclick = () => addSign(survey.id);
  $$('[data-sign]', app).forEach(card => bindSign(survey.id, card));
  const quoteBtn = $('[data-quote]', app);
  const proofBtn = $('[data-proof]', app);
  if (quoteBtn) quoteBtn.onclick = () => spawn(survey.id, 'quote');
  if (proofBtn) proofBtn.onclick = () => spawn(survey.id, 'job');
  form.onsubmit = e => { e.preventDefault(); persist(survey.id, { toastOk: true }).catch(() => {}); };
  if (y) window.scrollTo(0, y);
}

function payloadFromDom() {
  const header = readHeader($('#sv-form'));
  const signs = $$('[data-sign]').map(readSign);
  return { ...header, signs };
}

async function openSurveyPdf(id) {
  const popup = window.open('', '_blank');
  try {
    await persist(id);
    const url = `${B}/api/surveys/${id}/pdf?t=${Date.now()}`;
    if (popup) popup.location.href = url;
    else location.href = url;
  } catch (err) {
    if (popup) popup.close();
    const msg = $('[data-msg]');
    if (msg) { msg.className = 'msg err'; msg.textContent = err.message || 'Could not build the PDF.'; }
  }
}

async function persist(id, { toastOk = false } = {}) {
  const active = document.activeElement;
  if (active && active.matches && active.matches('input, textarea, select')) active.blur();
  const msg = $('[data-msg]');
  if (msg) { msg.className = 'msg'; msg.textContent = ''; }
  const body = payloadFromDom();
  if (!body.client) {
    if (msg) { msg.className = 'msg err'; msg.textContent = 'Add a client or site name.'; }
    $('[data-client]').focus();
    throw Object.assign(new Error('Add a client or site name.'), { status: 400 });
  }
  const buttons = $$('[data-save], [data-add], [data-quote], [data-proof]');
  buttons.forEach(b => { b.disabled = true; });
  try {
    const saved = await api(`${B}/api/surveys/${id}`, { method: 'PUT', body: JSON.stringify(body) });
    rememberSurveyor(body.surveyor);
    if (toastOk) toast('Survey saved');
    return saved;
  } catch (err) {
    if (msg) { msg.className = 'msg err'; msg.textContent = err.message; }
    throw err;
  } finally {
    buttons.forEach(b => { b.disabled = false; });
  }
}

async function refresh(id, focusSign) {
  if (!location.pathname.replace(/\/$/, '').endsWith(`/studio/survey/${id}`)) return null;
  const [survey, jobs] = await Promise.all([
    api(`${B}/api/surveys/${id}`),
    api(B + '/api/jobs').catch(() => [])
  ]);
  paintEdit(survey, jobs);
  if (focusSign) {
    const el = document.getElementById(`sign-${focusSign}`);
    if (el) {
      el.scrollIntoView({ block: 'start' });
      const name = $('[data-name]', el);
      if (name) name.focus();
    }
  }
  return survey;
}

async function addSign(id) {
  try { await persist(id); }
  catch { return; }
  try {
    const saved = await api(`${B}/api/surveys/${id}/signs`, { method: 'POST', body: '{}' });
    const sign = (saved.signs || []).at(-1);
    toast('Sign added');
    await refresh(id, sign && sign.id);
  } catch (err) { toast(err.message || 'Could not add a sign'); }
}

function bindSign(surveyId, card) {
  $('[data-rm-sign]', card).onclick = async () => {
    const name = $('[data-name]', card).value.trim() || 'this sign';
    if (!confirm(`Remove ${name} and its photos?`)) return;
    try { await persist(surveyId); }
    catch { return; }
    try {
      await api(`${B}/api/surveys/${surveyId}/signs/${card.dataset.sign}`, { method: 'DELETE' });
      toast('Sign removed');
      await refresh(surveyId);
    } catch (err) { toast(err.message); }
  };
  const cam = $('[data-cam-file]', card);
  const lib = $('[data-lib-file]', card);
  $('[data-cam]', card).onclick = () => cam.click();
  $('[data-lib]', card).onclick = () => lib.click();
  const take = async file => {
    if (!file) return;
    const msg = $('[data-sign-msg]', card);
    msg.className = 'msg';
    msg.textContent = 'Compressing…';
    $$('[data-cam], [data-lib]', card).forEach(b => { b.disabled = true; });
    try {
      await persist(surveyId);
      const jpeg = await compressPhoto(file);
      msg.textContent = 'Uploading…';
      await upload(`${B}/api/surveys/${surveyId}/signs/${card.dataset.sign}/photos?name=${encodeURIComponent(jpeg.name)}`, jpeg, p => {
        msg.textContent = `Uploading ${Math.round(p * 100)}%`;
      });
      toast('Photo added');
      await refresh(surveyId);
      const again = document.getElementById(`sign-${card.dataset.sign}`);
      if (again) again.scrollIntoView({ block: 'center' });
    } catch (err) {
      msg.className = 'msg err';
      msg.textContent = err.message || 'Could not add that photo';
      $$('[data-cam], [data-lib]', card).forEach(b => { b.disabled = false; });
    }
  };
  cam.onchange = () => { const f = cam.files && cam.files[0]; cam.value = ''; if (f) take(f); };
  lib.onchange = () => { const f = lib.files && lib.files[0]; lib.value = ''; if (f) take(f); };
  $$('[data-rm-photo]', card).forEach(btn => btn.onclick = async () => {
    if (!confirm('Remove this photo?')) return;
    btn.disabled = true;
    try {
      await api(`${B}/api/surveys/${surveyId}/signs/${card.dataset.sign}/photos/${btn.dataset.rmPhoto}`, { method: 'DELETE' });
      toast('Photo removed');
      await refresh(surveyId);
    } catch (err) { toast(err.message); btn.disabled = false; }
  });
  $$('[data-mark]', card).forEach(btn => btn.onclick = () => {
    const signId = card.dataset.sign;
    openMarkup(surveyId, signId, btn.dataset.mark);
  });
}

async function spawn(id, kind) {
  const msg = $('[data-spawn]');
  const num = ($('[data-num]') && $('[data-num]').value.trim()) || '';
  if (msg) { msg.className = 'msg'; msg.textContent = ''; }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(num)) {
    if (msg) { msg.className = 'msg err'; msg.textContent = 'Job number can only use letters, numbers, - _ or .'; }
    return;
  }
  const word = kind === 'quote' ? 'quote' : 'proof job';
  if (!confirm(`Create ${word} ${num} from this survey? Nothing is emailed.`)) return;
  try { await persist(id); }
  catch { return; }
  const btn = kind === 'quote' ? $('[data-quote]') : $('[data-proof]');
  if (btn) btn.disabled = true;
  try {
    const saved = await api(`${B}/api/surveys/${id}/${kind}`, { method: 'POST', body: JSON.stringify({ jobNumber: num }) });
    toast(kind === 'quote' ? 'Quote created — add prices' : 'Job created');
    if (kind === 'quote' && saved.quoteId) go(`${B}/studio/quote/${saved.quoteId}`);
    else if (saved.job) go(`${B}/studio/${encodeURIComponent(saved.job.jobNumber || saved.job.id)}`);
    else await refresh(id);
  } catch (err) {
    if (msg) { msg.className = 'msg err'; msg.textContent = err.message; }
    if (btn) btn.disabled = false;
  }
}

function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => loadImageEl(file));
  }
  return loadImageEl(file);
}
function loadImageEl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that photo. Try the camera button, or another picture.')); };
    img.src = url;
  });
}
async function compressPhoto(file) {
  if (!file) throw new Error('Choose a photo.');
  const bitmap = await loadBitmap(file);
  const sw = bitmap.width || bitmap.naturalWidth;
  const sh = bitmap.height || bitmap.naturalHeight;
  if (!sw || !sh) throw new Error('Could not read that photo.');
  const maxEdge = 1600;
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (bitmap.close) bitmap.close();
  const blob = await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('Could not compress that photo.')), 'image/jpeg', 0.72));
  const base = String(file.name || 'photo').replace(/\.[^.]+$/, '') || 'photo';
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
}

function measureMm(x1, y1, x2, y2, scale, w, h) {
  if (!scale || !(scale.mm > 0)) return null;
  const ref = Math.hypot((scale.x2 - scale.x1) * w, (scale.y2 - scale.y1) * h);
  if (ref < 2) return null;
  const px = Math.hypot((x2 - x1) * w, (y2 - y1) * h);
  return Math.max(1, Math.round(px / ref * scale.mm));
}

function openMarkup(surveyId, signId, photoId) {
  api(`${B}/api/surveys/${surveyId}`).then(survey => {
    const sign = (survey.signs || []).find(s => s.id === signId);
    const photo = sign && (sign.photos || []).find(p => p.id === photoId);
    if (!photo) { toast('That photo is no longer on this sign.'); return; }
    mountMarkup(surveyId, sign, photo);
  }).catch(err => toast(err.message));
}

function mountMarkup(surveyId, sign, photo) {
  const host = document.createElement('div');
  host.className = 'mk';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'true');
  host.setAttribute('aria-label', `Mark up ${sign.name || 'sign'}`);
  const tools = [
    ['rect', 'Box'],
    ['arrow', 'Arrow'],
    ['line', 'Line'],
    ['dim', 'Dimension'],
    ['text', 'Text'],
    ['scale', 'Scale']
  ];
  host.innerHTML = `<div class="mk__top"><button type="button" class="lnk sv-hit" data-mk-close>Close</button><p class="mk__title">${esc(sign.name || 'Sign')}</p><button type="button" class="lnk sv-hit" data-mk-undo>Undo</button></div>
    <p class="mk__hint" data-mk-hint>Drag a box around the sign.</p>
    <div class="mk__stage"><div class="mk__fit"><canvas data-mk-canvas></canvas></div></div>
    <div class="mk__foot">
      <div class="mk__tools">${tools.map(([id, label], i) => `<button type="button" class="mk__tool sv-hit${i === 0 ? ' on' : ''}" data-tool="${id}">${label}</button>`).join('')}<button type="button" class="mk__tool sv-hit" data-mk-clear>Clear</button></div>
      <div class="mk__type"><input data-mk-label maxlength="80" placeholder="Label" enterkeyhint="done" autocomplete="off"><button type="button" class="btn btn--sm sv-hit" data-mk-apply hidden>Apply scale</button><button type="button" class="btn sv-hit" data-mk-save>Save marks</button></div>
    </div>`;
  document.body.append(host);
  document.body.classList.add('mk-open');
  const canvas = $('[data-mk-canvas]', host);
  const ctx = canvas.getContext('2d');
  const hint = $('[data-mk-hint]', host);
  const label = $('[data-mk-label]', host);
  const applyBtn = $('[data-mk-apply]', host);
  let tool = 'rect';
  let items = (photo.markup && Array.isArray(photo.markup.items) ? photo.markup.items : []).map(it => ({ ...it }));
  let scale = photo.markup && photo.markup.scale ? { ...photo.markup.scale } : null;
  let draft = null;
  let drag = null;
  let scalePts = [];
  let pendingScale = null;
  let dirty = false;
  let boundIndex = -1;
  function syncDimLabel() {
    const result = commitDimensionLabel(items, label.value, boundIndex);
    items = result.items;
    boundIndex = result.boundIndex;
    if (result.changed) { dirty = true; paint(); }
    return result.changed;
  }
  const hints = {
    rect: 'Drag a box around where the sign sits.',
    arrow: 'Drag an arrow.',
    line: 'Drag a line.',
    dim: 'Drag the dimension, then type the measurement. It is drawn on the line.',
    text: 'Type the note, then tap the photo.',
    scale: 'Rough check only. Tap two points a known distance apart, then type the millimetres.'
  };
  function setHint(text) { hint.textContent = text; }
  setHint(scale ? `${hints.rect} Scale is set (${scale.mm} mm).` : hints.rect);

  const saveBtn = $('[data-mk-save]', host);
  saveBtn.disabled = true;
  const img = new Image();
  img.onload = () => {
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.parentElement.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
    paint();
    saveBtn.disabled = false;
  };
  img.onerror = () => setHint('Could not load the photo.');
  img.src = photo.url;

  function paint(opts = {}) {
    if (!img.naturalWidth) return;
    const guides = opts.guides !== false;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const lw = Math.max(3, Math.round(Math.max(w, h) * 0.005));
    if (guides && scale) drawScale(scale, lw, false);
    if (guides && pendingScale) drawScale(pendingScale, lw, true);
    for (const item of items) drawItem(item, lw);
    if (draft) drawItem(draft, lw);
    if (guides && scalePts.length === 1) drawDot(scalePts[0], lw);
  }
  function drawDot(p, lw) {
    ctx.save();
    ctx.fillStyle = '#ffe14a';
    ctx.strokeStyle = '#09090a';
    ctx.lineWidth = Math.max(2, lw * 0.4);
    ctx.beginPath();
    ctx.arc(p.x * canvas.width, p.y * canvas.height, lw * 1.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  function drawScale(sc, lw, pending) {
    const x1 = sc.x1 * canvas.width, y1 = sc.y1 * canvas.height, x2 = sc.x2 * canvas.width, y2 = sc.y2 * canvas.height;
    ctx.save();
    ctx.strokeStyle = pending ? '#f3f1ec' : '#A7A9AC';
    ctx.setLineDash([lw * 1.4, lw]);
    ctx.lineWidth = Math.max(2, lw * 0.45);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }
  function drawItem(item, lw) {
    const w = canvas.width;
    const h = canvas.height;
    ctx.save();
    ctx.strokeStyle = '#ffe14a';
    ctx.fillStyle = 'rgba(255,225,74,0.16)';
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = lw * 0.7;
    if (item.type === 'rect') {
      const x = item.x * w, y = item.y * h, rw = item.w * w, rh = item.h * h;
      ctx.fillRect(x, y, rw, rh);
      ctx.strokeRect(x, y, rw, rh);
    } else if (item.type === 'text') {
      const size = Math.max(18, Math.round(w * 0.042));
      ctx.shadowBlur = 0;
      ctx.font = `600 ${size}px "Work Sans", sans-serif`;
      const tw = ctx.measureText(item.text).width;
      const x = item.x * w;
      const y = item.y * h;
      const pad = size * 0.35;
      ctx.fillStyle = 'rgba(9,9,10,0.82)';
      ctx.fillRect(x, y - size - pad, tw + pad * 2, size + pad * 2);
      ctx.fillStyle = '#ffe14a';
      ctx.textBaseline = 'bottom';
      ctx.fillText(item.text, x + pad, y);
    } else {
      const x1 = item.x1 * w, y1 = item.y1 * h, x2 = item.x2 * w, y2 = item.y2 * h;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      if (item.type === 'arrow' || item.type === 'dim') {
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const len = lw * 5;
        ctx.beginPath();
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - len * Math.cos(ang - 0.42), y2 - len * Math.sin(ang - 0.42));
        ctx.moveTo(x2, y2);
        ctx.lineTo(x2 - len * Math.cos(ang + 0.42), y2 - len * Math.sin(ang + 0.42));
        ctx.stroke();
      }
      if (item.type === 'dim') {
        const ang = Math.atan2(y2 - y1, x2 - x1);
        const nx = Math.cos(ang + Math.PI / 2);
        const ny = Math.sin(ang + Math.PI / 2);
        const tick = lw * 3.2;
        ctx.beginPath();
        ctx.moveTo(x1 - nx * tick, y1 - ny * tick);
        ctx.lineTo(x1 + nx * tick, y1 + ny * tick);
        ctx.moveTo(x2 - nx * tick, y2 - ny * tick);
        ctx.lineTo(x2 + nx * tick, y2 + ny * tick);
        ctx.stroke();
        if (item.label) {
          const size = Math.max(18, Math.round(w * 0.042));
          ctx.shadowBlur = 0;
          ctx.font = `600 ${size}px "Work Sans", sans-serif`;
          const tw = ctx.measureText(item.label).width;
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2 - size * 0.85;
          const pad = size * 0.4;
          const plateY = Math.max(pad, my - size * 0.55);
          ctx.fillStyle = 'rgba(9,9,10,0.9)';
          ctx.fillRect(mx - tw / 2 - pad, plateY, tw + pad * 2, size + pad);
          ctx.fillStyle = '#ffe14a';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(item.label, mx, plateY + (size + pad) / 2);
        }
      }
    }
    ctx.restore();
  }
  function norm(e) {
    const r = canvas.getBoundingClientRect();
    const x = r.width ? (e.clientX - r.left) / r.width : 0;
    const y = r.height ? (e.clientY - r.top) / r.height : 0;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  }
  function shape(a, b) {
    if (tool === 'rect') {
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      if (w < 0.012 || h < 0.012) return null;
      return { type: 'rect', x, y, w, h };
    }
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    if (dist < 0.012) return null;
    if (tool === 'dim') return dimensionFromDrag(a, b, label.value, scale, canvas.width, canvas.height);
    if (tool === 'arrow' || tool === 'line') return { type: tool, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
    return null;
  }
  function placeText(p) {
    const text = label.value.trim().slice(0, 80);
    if (!text) { setHint('Type the note, then tap the photo.'); label.focus(); return; }
    items.push({ type: 'text', x: p.x, y: p.y, text });
    dirty = true;
    label.value = '';
    paint();
  }
  function addScalePoint(p) {
    scalePts.push(p);
    if (scalePts.length === 1) { setHint('Tap the other end of that known distance.'); paint(); return; }
    pendingScale = { x1: scalePts[0].x, y1: scalePts[0].y, x2: scalePts[1].x, y2: scalePts[1].y };
    scalePts = [];
    applyBtn.hidden = false;
    label.placeholder = 'Known length (mm)';
    label.focus();
    setHint('Type the real distance in millimetres, then Apply scale.');
    paint();
  }

  canvas.addEventListener('pointerdown', e => {
    if (!img.naturalWidth) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const p = norm(e);
    if (tool === 'text') { placeText(p); return; }
    if (tool === 'scale') { addScalePoint(p); return; }
    drag = p;
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    draft = shape(drag, norm(e));
    paint();
  });
  canvas.addEventListener('pointerup', e => {
    if (!drag) return;
    const item = shape(drag, norm(e));
    drag = null;
    draft = null;
    if (item) {
      items.push(item);
      dirty = true;
      if (item.type === 'dim') {
        boundIndex = items.length - 1;
        if (!label.value.trim() && item.label) label.value = item.label;
        setHint(item.label ? 'Measurement is on the line. Change it here, then Save marks.' : 'Type the measurement. It is drawn on the line.');
        setTimeout(() => { try { label.focus({ preventScroll: true }); } catch { /* iOS may ignore */ } }, 30);
      }
    }
    paint();
  });
  canvas.addEventListener('pointercancel', () => { drag = null; draft = null; paint(); });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  $$('[data-tool]', host).forEach(btn => btn.onclick = () => {
    if (tool === 'dim') syncDimLabel();
    tool = btn.dataset.tool;
    $$('[data-tool]', host).forEach(b => b.classList.toggle('on', b === btn));
    scalePts = [];
    pendingScale = null;
    applyBtn.hidden = true;
    label.placeholder = tool === 'text' ? 'Note to place' : (tool === 'dim' ? 'Measurement, e.g. 2400 mm' : 'Label');
    setHint(tool === 'rect' && scale ? `${hints.rect} Scale is set (${scale.mm} mm).` : hints[tool]);
    paint();
  });
  applyBtn.onclick = () => {
    const mm = Number(String(label.value).trim());
    if (!(mm > 0) || mm > 1000000) { setHint('Type the known length in millimetres.'); return; }
    scale = { ...pendingScale, mm: Math.round(mm) };
    pendingScale = null;
    applyBtn.hidden = true;
    label.value = '';
    dirty = true;
    tool = 'dim';
    $$('[data-tool]', host).forEach(b => b.classList.toggle('on', b.dataset.tool === 'dim'));
    label.placeholder = 'Measurement label';
    setHint(`Scale set at ${scale.mm} mm. Drag a dimension to check a length.`);
    paint();
  };
  label.addEventListener('input', () => syncDimLabel());
  label.addEventListener('change', () => syncDimLabel());
  label.addEventListener('compositionend', () => syncDimLabel());
  label.addEventListener('blur', () => syncDimLabel());
  label.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); syncDimLabel(); label.blur(); }
  });
  $('[data-mk-undo]', host).onclick = () => {
    if (!items.length) return;
    items.pop();
    if (boundIndex >= items.length) boundIndex = -1;
    dirty = true;
    paint();
  };
  $('[data-mk-clear]', host).onclick = async () => {
    if (!items.length && !scale) return;
    if (!confirm('Clear every mark on this photo?')) return;
    items = [];
    scale = null;
    pendingScale = null;
    scalePts = [];
    boundIndex = -1;
    label.value = '';
    dirty = false;
    try {
      await api(`${B}/api/surveys/${surveyId}/signs/${sign.id}/photos/${photo.id}`, { method: 'PUT', body: JSON.stringify({ markup: null }) });
      toast('Marks cleared');
      paint();
    } catch (err) { setHint(err.message); }
  };
  let saveLock = false;
  async function save() {
    if (saveLock) return;
    saveLock = true;
    const btn = $('[data-mk-save]', host);
    btn.disabled = true;
    setHint('Saving…');
    try {
      if (document.activeElement === label) label.blur();
      syncDimLabel();
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const markup = { items, ...(scale ? { scale } : {}) };
      await api(`${B}/api/surveys/${surveyId}/signs/${sign.id}/photos/${photo.id}`, { method: 'PUT', body: JSON.stringify({ markup }) });
      paint({ guides: false });
      const blob = await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('Could not save the marked photo.')), 'image/jpeg', 0.85));
      const file = new File([blob], 'marked.jpg', { type: 'image/jpeg' });
      await upload(`${B}/api/surveys/${surveyId}/signs/${sign.id}/photos/${photo.id}/mark`, file);
      dirty = false;
      toast('Marked photo saved');
      try { await persist(surveyId); }
      catch { /* the marked photo is saved; the form message shows why the sizes were not */ }
      close(false);
      await refresh(surveyId);
      const again = document.getElementById(`sign-${sign.id}`);
      if (again) again.scrollIntoView({ block: 'center' });
    } catch (err) {
      setHint(err.message || 'Could not save. Try again when you have signal.');
      btn.disabled = false;
      saveLock = false;
    }
  }
  function close(ask) {
    if (ask && dirty && !confirm('Save these marks? Cancel leaves the photo unchanged.')) {
      /* discard */
    } else if (ask && dirty) { save(); return; }
    host.remove();
    document.body.classList.remove('mk-open');
  }
  const saveBtnEl = $('[data-mk-save]', host);
  saveBtnEl.addEventListener('pointerup', () => { syncDimLabel(); save(); });
  saveBtnEl.onclick = () => save();
  $('[data-mk-close]', host).onclick = () => close(true);
  host.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(true); } });
  $('[data-tool="rect"]', host).focus();
}
