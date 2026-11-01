'use strict';
// Recipient list, settings override, approve/changes mail, and V2-only version alerts.
// Uses a temp data dir and a fake mailer — no SMTP and no real inbox.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ybi-notify-'));
process.env.DATA_DIR = dataDir;
process.env.BASE_PATH = '';
process.env.STUDIO_PASSWORD = 'test-proof';
process.env.PORT = '0';
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
delete process.env.SMTP_FROM;
delete process.env.NOTIFY_EMAIL;

const {
  createAppServer, parseNotifyAddresses, DEFAULT_NOTIFY_EMAIL, DEFAULT_NOTIFY_EMAILS, loadSettings, setMailerForTests,
} = require('../server');

const THREE = DEFAULT_NOTIFY_EMAILS.join(', ');
assert.strictEqual(DEFAULT_NOTIFY_EMAIL, 'drew@ybicreative.com.au, nicola@ybicreative.com.au, rob@ybicreative.com.au');
assert.deepStrictEqual(
  parseNotifyAddresses(' drew@ybicreative.com.au, nicola@ybicreative.com.au ; rob@ybicreative.com.au '),
  [...DEFAULT_NOTIFY_EMAILS]
);
assert.deepStrictEqual(
  parseNotifyAddresses('Alpha@Example.com; nope, alpha@example.com, beta@example.com'),
  ['Alpha@Example.com', 'beta@example.com']
);
assert.deepStrictEqual(parseNotifyAddresses(''), []);
assert.deepStrictEqual(parseNotifyAddresses('not-an-email'), []);

try {
  const addressparser = require('nodemailer/lib/addressparser');
  const parsed = addressparser(THREE);
  assert.deepStrictEqual(parsed.map(p => p.address), [...DEFAULT_NOTIFY_EMAILS], 'nodemailer splits comma-separated to');
  console.log('  ✓ nodemailer addressparser accepts the comma-separated list');
} catch (e) {
  if (e.code !== 'MODULE_NOT_FOUND') throw e;
  console.log('  - nodemailer not installed; skipped addressparser check');
}

const studioJs = fs.readFileSync(path.join(__dirname, '../public/assets/studio.js'), 'utf8');
assert.ok(studioJs.includes('Alerts go to these addresses when a client approves or requests changes.'), 'settings help text');
assert.ok(studioJs.includes("const placeholder = 'drew@ybicreative.com.au, nicola@ybicreative.com.au, rob@ybicreative.com.au'"), 'settings placeholder lists the three addresses');
assert.ok(!studioJs.includes('data-email type="email"'), 'field accepts a list, not a single email input');

function req(server, method, urlPath, { headers = {}, body, studio = true } = {}) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (studio) h['X-Studio-Key'] = process.env.STUDIO_PASSWORD;
    if (body != null && !h['Content-Type'] && !Buffer.isBuffer(body)) h['Content-Type'] = 'application/json';
    const r = http.request({ hostname: '127.0.0.1', port, method, path: urlPath, headers: h }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, text, json });
      });
    });
    r.on('error', reject);
    r.end(body == null ? undefined : body);
  });
}

const sent = [];
setMailerForTests({
  sendMail(opts) {
    sent.push(opts);
    return Promise.resolve({ messageId: 'test' });
  },
});

(async () => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const fail = (m) => { console.error('  ✗ ' + m); server.close(); process.exit(1); };
  const check = (cond, m) => { if (!cond) fail(m); console.log('  ✓ ' + m); };

  let s = await req(server, 'GET', '/api/settings');
  check(s.status === 200 && s.json.notifyEmail === THREE, 'missing settings file defaults to the three YBI addresses');
  check(s.json.emailEnabled === true, 'fake mailer counts as email enabled');

  process.env.NOTIFY_EMAIL = ' solo@example.com ; other@example.com ';
  s = await req(server, 'GET', '/api/settings');
  check(s.json.notifyEmail === 'solo@example.com ; other@example.com', 'NOTIFY_EMAIL is the list when settings are empty');
  delete process.env.NOTIFY_EMAIL;
  s = await req(server, 'GET', '/api/settings');
  check(s.json.notifyEmail === THREE, 'clearing NOTIFY_EMAIL falls back to the three addresses');

  const savedList = 'one@example.com, two@example.com';
  s = await req(server, 'POST', '/api/settings', { body: JSON.stringify({ notifyEmail: '  ' + savedList + ' ; ' }) });
  check(s.status === 200 && s.json.notifyEmail === savedList + ' ;', 'settings keeps the saved string');
  process.env.NOTIFY_EMAIL = 'env@example.com';
  s = await req(server, 'GET', '/api/settings');
  check(s.json.notifyEmail === savedList + ' ;', 'a saved list replaces NOTIFY_EMAIL');
  delete process.env.NOTIFY_EMAIL;

  s = await req(server, 'POST', '/api/settings', { body: JSON.stringify({ notifyEmail: '' }) });
  check(s.json.notifyEmail === THREE, 'clearing settings restores the default list in the response');
  const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
  check(stored.notifyEmail === '', 'an empty save is stored as an empty string');

  const base = 'N' + Date.now().toString(36);
  const created = await req(server, 'POST', '/api/jobs', { body: JSON.stringify({
    jobNumber: base + 'A', clientName: 'Sam Client', clientCompany: 'Acme', clientEmail: 'client@example.com', description: 'A2 poster',
  }) });
  check(created.status === 201, 'job created');
  const job = created.json;

  const up = (name, note) => req(server, 'POST', `/api/jobs/${job.id}/versions?name=${encodeURIComponent(name)}${note ? '&note=' + encodeURIComponent(note) : ''}`, {
    headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from('%PDF-1.1\n'),
  });
  let v = await up('proof-v1.pdf');
  check(v.status === 201 && sent.length === 0, 'first proof upload does not email');
  v = await up('proof-v2.pdf', 'Phone number fixed');
  check(v.status === 201 && sent.length === 1, 'V2 emails staff');
  const updated = sent[0];
  check(updated.to === THREE, 'V2 goes to the default three addresses');
  check(updated.subject === `[YBI Proof] UPDATED: ${base}A — Sam Client (V2)`, 'V2 subject');
  check(updated.replyTo == null, 'version alert does not reply to the client');
  check(updated.text.includes('Sam Client') && updated.text.includes('Acme') && updated.text.includes('A2 poster'), 'V2 body has client and job');
  check(updated.text.includes('proof-v2.pdf') && updated.text.includes('Phone number fixed'), 'V2 body has file and studio note');
  check(updated.text.includes('(Melbourne)') && updated.text.includes(`/studio/${base}A`), 'V2 body has Melbourne time and studio link');
  check(updated.from === 'proofs@ybicreative.com.au', 'from address unchanged');

  s = await req(server, 'POST', '/api/settings', { body: JSON.stringify({ notifyEmail: 'one@example.com, nope, two@example.com; one@example.com' }) });
  check(s.json.notifyEmail === 'one@example.com, nope, two@example.com; one@example.com', 'comma list is saved as entered');
  const decision = await req(server, 'POST', `/api/review/${base}A/decision?k=${job.token}`, {
    studio: false,
    body: JSON.stringify({
      type: 'changes', name: 'Sam Client', note: 'Please fix the phone', version: 2,
      stickies: [{ page: 1, x: 0.2, y: 0.3, text: 'Move the logo' }],
    }),
  });
  check(decision.status === 200 && decision.json.status === 'changes_requested', 'changes request still saves');
  check(sent.length === 2, 'changes request emails staff');
  const changes = sent[1];
  check(changes.to === 'one@example.com, two@example.com', 'comma/semicolon list sends to each valid address once');
  check(changes.subject === `[YBI Proof] CHANGES REQUESTED: ${base}A — Sam Client (V2)`, 'changes subject');
  check(changes.replyTo === 'client@example.com', 'reply-to stays the client');
  check(changes.text.includes('Please fix the phone') && changes.text.includes('Move the logo'), 'changes body keeps note and sticky');
  check(changes.text.includes('Job ' + base + 'A') && changes.text.includes('(Melbourne)') && changes.text.includes(`/studio/${base}A`), 'changes body keeps job, Melbourne time, studio link');

  const createdB = await req(server, 'POST', '/api/jobs', { body: JSON.stringify({
    jobNumber: base + 'B', clientName: 'Jo Retailer', clientEmail: 'jo@example.com', description: 'Catalogue',
  }) });
  const jobB = createdB.json;
  v = await req(server, 'POST', `/api/jobs/${jobB.id}/versions?name=cat.pdf`, { headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from('%PDF-1.1\n') });
  check(v.status === 201 && sent.length === 2, 'another job’s first upload stays quiet');
  const approved = await req(server, 'POST', `/api/review/${base}B/decision?k=${jobB.token}`, {
    studio: false,
    body: JSON.stringify({ type: 'approve', name: 'Jo Retailer', note: 'Looks great', version: 1 }),
  });
  check(approved.status === 200 && approved.json.status === 'approved', 'approve still saves');
  check(sent.length === 3 && sent[2].subject === `[YBI Proof] APPROVED: ${base}B — Jo Retailer (V1)`, 'approve still emails');
  check(sent[2].to === 'one@example.com, two@example.com' && sent[2].text.includes('Looks great') && sent[2].replyTo === 'jo@example.com', 'approve uses the saved list, note, and reply-to');

  await req(server, 'POST', '/api/settings', { body: JSON.stringify({ notifyEmail: 'not-an-email' }) });
  const createdC = await req(server, 'POST', '/api/jobs', { body: JSON.stringify({
    jobNumber: base + 'C', clientName: 'Pat', description: 'Card',
  }) });
  const jobC = createdC.json;
  await req(server, 'POST', `/api/jobs/${jobC.id}/versions?name=card.pdf`, { headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from('%PDF-1.1\n') });
  const bad = await req(server, 'POST', `/api/review/${base}C/decision?k=${jobC.token}`, {
    studio: false,
    body: JSON.stringify({ type: 'approve', name: 'Pat', note: 'Ok', version: 1 }),
  });
  check(bad.status === 200 && sent.length === 3, 'a saved list with no valid address does not send');
  const log = fs.readFileSync(path.join(dataDir, 'notifications.log'), 'utf8');
  check(log.includes('APPROVED — Job ' + base + 'C') && log.includes('no valid addresses'), 'the decision is still logged when mail is skipped');

  const fresh = await loadSettings();
  check(fresh.notifyEmail === 'not-an-email', 'invalid saved text is left visible in settings');

  server.close();
  console.log('notify recipients ok');
})().catch(e => { console.error(e); process.exit(1); });
