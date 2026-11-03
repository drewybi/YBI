import { B, $, esc, fmtDate, api, toast, engineBand } from './common.js';

// Backup draft to the public studio inbox. The server emails the studio
// notification list (the same addresses as proof alerts) when this decision
// is saved, so staff are notified even if the client never sends this draft.
const CONFIRM_TO = 'website@ybicreative.com.au';
const app = $('#app');
const parts = location.pathname.slice(B.length).split('/').filter(Boolean);
const quoteId = parts[0] === 'quote' ? parts[1] || '' : '';
const K = new URLSearchParams(location.search).get('k') || '';
const API = `${B}/api/quote/${encodeURIComponent(quoteId)}`;
const kq = K ? `?k=${encodeURIComponent(K)}` : '';
let quote, mode = null;

const aud = cents => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format((Number(cents) || 0) / 100);
function showDay(iso) {
  const [y, m, d] = String(iso || '').split('-').map(Number);
  if (!y || !m || !d) return iso || '';
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}
function confirmMail(q, name) {
  const job = String(q.description || '').split('\n')[0].trim();
  const subject = job ? `QUOTE CONFIRMED: ${job}` : 'QUOTE CONFIRMED:';
  const body = [
    'We confirm this quote.',
    '',
    `Client: ${q.client}`,
    q.contactName ? `Contact: ${q.contactName}` : null,
    `Date: ${showDay(q.date)}`,
    `Job: ${q.description || '(no description)'}`,
    `Total (inc GST): ${aud(q.total)}`,
    '',
    name ? `Confirmed by ${name}.` : 'Confirmed.'
  ].filter(line => line != null).join('\n');
  return `mailto:${CONFIRM_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
function savedName() {
  return localStorage.getItem('ybi-quote-name') || quote.contactName || '';
}

async function load() {
  if (!/^[a-f0-9]{16}$/.test(quoteId)) {
    app.innerHTML = `<div class="wrap" style="padding-top:100px;padding-bottom:100px"><p class="eyebrow">Quote</p><h1 class="h2">Quote not <span class="ol">found.</span></h1><p class="lede">Check the link YBI sent you, or call <a href="tel:+61354442127">(03) 5444 2127</a>.</p></div>`;
    return;
  }
  try { quote = await api(API + kq); }
  catch (e) {
    const missingKey = e.status === 403 || e.status === 404;
    app.innerHTML = missingKey
      ? `<div class="wrap" style="padding-top:100px;padding-bottom:100px"><p class="eyebrow">Quote</p><h1 class="h2">Private <span class="ol">quote.</span></h1><p class="lede">This quote can only be opened with the secure link YBI sent you. Can’t find it? Call <a href="tel:+61354442127">(03) 5444 2127</a>.</p></div>`
      : `<div class="wrap" style="padding-top:100px;padding-bottom:100px"><p class="msg err">${esc(e.message)}</p></div>`;
    return;
  }
  document.title = `Quote · ${quote.client} · YBI Creative`;
  render();
}

function lineRows(lines) {
  if (!lines.length) return '<p class="empty">No priced lines on this quote.</p>';
  return `<div class="q-scroll"><table class="qlines"><thead><tr><th>Description</th><th class="qty">Qty</th><th class="price">Price</th><th class="amt">Amount</th></tr></thead><tbody>${lines.map(line => `<tr><td>${esc(line.description) || '—'}</td><td>${esc(line.qty || '1')}</td><td>${line.price ? esc(line.price) : '—'}</td><td class="amt">${aud(line.amount)}</td></tr>`).join('')}</tbody></table></div>`;
}

function render(openMail) {
  const accepted = quote.status === 'accepted';
  const mail = confirmMail(quote, savedName());
  app.innerHTML = engineBand(`<p class="eyebrow">Quote · <span style="color:var(--ink)">${esc(quote.client)}</span></p>
    <h1 class="h1">${accepted ? 'Quote <span class="ol">confirmed.</span>' : 'Your <span class="ol">quote.</span>'}</h1>
    <div class="meta">
      <div><span class="k">Client</span>${esc(quote.client)}</div>
      <div><span class="k">Contact</span>${esc(quote.contactName) || '—'}</div>
      <div><span class="k">Date</span>${esc(showDay(quote.date))}</div>
      <div><span class="k">Valid for</span>${esc(quote.validity)}</div>
      <div style="grid-column:1/-1"><span class="k">Job description</span>${esc(quote.description) || '—'}</div>
    </div>`) + `<div class="wrap" style="padding-bottom:72px">
    <div class="panel" style="margin-top:28px">
      ${lineRows(quote.lines || [])}
      <div class="qtotals" aria-live="polite">
        <div><span>Subtotal <span class="dim">(ex GST)</span></span><b>${aud(quote.subtotal)}</b></div>
        <div><span>GST 10%</span><b>${aud(quote.gst)}</b></div>
        <div class="grand"><span>Total <span class="dim">(inc GST)</span></span><b>${aud(quote.total)}</b></div>
      </div>
    </div>
    <div style="margin-top:22px">${decision(accepted, mail)}</div>
  </div>`;
  bind(openMail ? mail : '');
}

function decision(accepted, mail) {
  if (accepted) return `<div class="state state--approved" data-state="accepted"><h2 class="h3">Thanks — this quote is confirmed.</h2><p class="mute">A confirmation email to YBI should open. If it doesn’t, use the button below. Subject: <b style="color:var(--ink)">QUOTE CONFIRMED: ${esc(String(quote.description || '').split('\n')[0].trim())}</b></p><div class="btns" style="margin-top:18px"><a class="btn" id="q-mail" href="${esc(mail)}">Email confirmation</a></div></div>`;
  const changes = (quote.responses || []).filter(r => r.type === 'changes');
  return `<div class="state" data-state="${quote.status}">
    ${changes.length ? changes.map(r => `<div class="fb fb--changes"><div class="small dim">${esc(r.name)} · ${fmtDate(r.at)}</div>${r.note ? `<p>${esc(r.note)}</p>` : ''}</div>`).join('') + '<p class="mute">YBI has your notes. You can add another, or accept the quote.</p>' : '<h2 class="h3">Happy with this quote?</h2>'}
    <div class="seg"><button type="button" data-a="accept" class="${mode === 'accept' ? 'on' : ''}">Accept quote</button><button type="button" data-a="changes" class="${mode === 'changes' ? 'on' : ''}">Request changes</button></div>
    ${mode ? `<form data-form novalidate class="stack" style="gap:18px">
      <div class="field"><label for="c-name">Your name</label><input id="c-name" maxlength="120" value="${esc(savedName())}" required></div>
      <div class="field"><label for="c-note">${mode === 'changes' ? 'What should change?' : 'Note <span class="opt">(optional)</span>'}</label><textarea id="c-note" maxlength="10000" placeholder="${mode === 'changes' ? 'Tell YBI what to adjust…' : 'Anything you want them to know'}"></textarea></div>
      <div class="btns"><button class="btn ${mode === 'accept' ? 'btn--ok' : ''}" type="submit" data-go>${mode === 'accept' ? 'Accept quote' : 'Send changes to YBI'}</button></div>
      <p class="msg" id="c-msg"></p>
    </form>` : ''}
  </div>`;
}

function bind(openMail) {
  $$buttons();
  const form = $('[data-form]', app);
  if (form) form.onsubmit = submit;
  if (openMail) setTimeout(() => { window.location.href = openMail; }, 0);
}
function $$buttons() {
  const accept = $('[data-a="accept"]', app);
  const changes = $('[data-a="changes"]', app);
  if (accept) accept.onclick = () => { mode = mode === 'accept' ? null : 'accept'; render(); };
  if (changes) changes.onclick = () => { mode = mode === 'changes' ? null : 'changes'; render(); };
}
async function submit(e) {
  e.preventDefault();
  const msg = $('#c-msg', app);
  const name = $('#c-name', app).value.trim();
  const note = $('#c-note', app).value.trim();
  msg.className = 'msg'; msg.textContent = '';
  if (!name) { msg.className = 'msg err'; msg.textContent = 'Please add your name.'; return; }
  if (mode === 'changes' && !note) { msg.className = 'msg err'; msg.textContent = 'Please describe the changes.'; return; }
  const go = $('[data-go]', app);
  go.disabled = true;
  try {
    quote = await api(`${API}/decision${kq}`, { method: 'POST', body: JSON.stringify({ type: mode, name, note }) });
    localStorage.setItem('ybi-quote-name', name);
    const openMail = mode === 'accept';
    toast(openMail ? 'Quote confirmed' : 'Changes sent to YBI');
    mode = null;
    render(openMail);
  } catch (err) {
    msg.className = 'msg err';
    msg.textContent = err.message;
    go.disabled = false;
  }
}

load();
