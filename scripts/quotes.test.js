'use strict';
// Staff quotes: studio auth, JSON file, blank qty = 1, GST 10%.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ybi-quotes-'));
process.env.DATA_DIR = dataDir;
process.env.BASE_PATH = '';
process.env.STUDIO_PASSWORD = 'test-proof';
process.env.PORT = '0';
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;
delete process.env.SMTP_FROM;
delete process.env.NOTIFY_EMAIL;

const { createAppServer, setMailerForTests, DEFAULT_NOTIFY_EMAIL } = require('../server');

const sent = [];
setMailerForTests({
  sendMail(opts) {
    sent.push(opts);
    return Promise.resolve({ messageId: 'test' });
  },
});

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
        try { json = JSON.parse(text); } catch { /* html or empty */ }
        resolve({ status: res.statusCode, text, json, headers: res.headers });
      });
    });
    r.on('error', reject);
    const payload = body == null || typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    r.end(payload);
  });
}

const lines = (extra = []) => extra;

(async () => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const anon = await req(server, 'GET', '/api/quotes', { studio: false });
    assert.strictEqual(anon.status, 401);

    const page = await req(server, 'GET', '/studio/quote');
    assert.strictEqual(page.status, 200);
    assert.ok(page.text.includes('href="/studio/quote"'), 'nav links to quote');
    assert.ok(page.text.includes('>Quote</a>'), 'nav label is Quote');
    const signedOut = await req(server, 'GET', '/studio/quote', { studio: false });
    assert.strictEqual(signedOut.status, 302);

    const review = await req(server, 'GET', '/30434', { studio: false });
    assert.strictEqual(review.status, 200);
    assert.ok(!review.text.includes('/studio/quote'), 'client page has no quote link');

    const reserved = await req(server, 'POST', '/api/jobs', { body: { jobNumber: 'quote', clientName: 'Nope' } });
    assert.strictEqual(reserved.status, 400);

    const created = await req(server, 'POST', '/api/quotes', { body: {
      client: 'Acme Print',
      contactName: 'Nicola',
      date: '2026-11-02',
      description: 'Business cards, 400gsm',
      validity: '30 days',
      lines: lines([
        { description: 'Design', price: '450' },
        { description: 'Cards', qty: '500', price: '$0.40' }
      ])
    }});
    assert.strictEqual(created.status, 201, created.text);
    const q = created.json;
    assert.strictEqual(q.client, 'Acme Print');
    assert.strictEqual(q.lines.length, 20);
    assert.strictEqual(q.lines[0].qty, '');
    assert.strictEqual(q.lines[0].price, '450.00');
    assert.strictEqual(q.lines[0].amount, 45000);
    assert.strictEqual(q.lines[1].qty, '500');
    assert.strictEqual(q.lines[1].amount, 20000);
    assert.strictEqual(q.subtotal, 65000);
    assert.strictEqual(q.gst, 6500);
    assert.strictEqual(q.total, 71500);

    const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'quotes.json'), 'utf8'));
    assert.strictEqual(stored.quotes.length, 1);
    assert.strictEqual(stored.quotes[0].lines[0].qty, null);
    assert.strictEqual(stored.quotes[0].lines[0].price, 45000);
    assert.strictEqual(stored.quotes[0].lines[1].price, 40);

    assert.ok(q.clientUrl.includes(`/quote/${q.id}?k=`), q.clientUrl);
    assert.strictEqual(q.status, 'open');
    assert.ok(!q.token, 'studio payload keeps the key inside the link');
    const key = new URL(q.clientUrl, 'http://localhost').searchParams.get('k');
    const locked = await req(server, 'GET', `/api/quote/${q.id}`, { studio: false });
    assert.strictEqual(locked.status, 403);
    const opened = await req(server, 'GET', `/api/quote/${q.id}?k=${encodeURIComponent(key)}`, { studio: false });
    assert.strictEqual(opened.status, 200);
    assert.strictEqual(opened.json.client, 'Acme Print');
    assert.strictEqual(opened.json.description, 'Business cards, 400gsm');
    assert.ok(!opened.json.clientUrl && !opened.json.token);
    const quotePage = await req(server, 'GET', `/quote/${q.id}`, { studio: false });
    assert.strictEqual(quotePage.status, 200);
    assert.ok(quotePage.text.includes('quote-review.js'));
    const reviewJs = fs.readFileSync(path.join(__dirname, '../public/assets/quote-review.js'), 'utf8');
    assert.ok(reviewJs.includes('QUOTE CONFIRMED:'));
    assert.ok(reviewJs.includes("const CONFIRM_TO = 'website@ybicreative.com.au'"));
    assert.ok(reviewJs.includes('mailto:${CONFIRM_TO}'));
    const studioJs = fs.readFileSync(path.join(__dirname, '../public/assets/studio.js'), 'utf8');
    const studioHtml = fs.readFileSync(path.join(__dirname, '../public/studio.html'), 'utf8');
    const proofJs = fs.readFileSync(path.join(__dirname, '../public/assets/review.js'), 'utf8');
    assert.ok(studioJs.includes('data-quote-job'), 'accepted quote links to the job');
    assert.ok(studioJs.includes('<span class="k">Client</span>') && studioJs.includes('<span class="k">Contact</span>'), 'job page labels are Client and Contact');
    assert.ok(!studioJs.includes('Client contact') && !studioJs.includes('Business name') && !studioJs.includes('>Contact name<'), 'old client-contact and business labels are gone');
    assert.ok(studioHtml.includes('>Client</label>') && studioHtml.includes('>Contact <span class="opt">(optional)</span></label>'), 'new and edit job use Client and Contact');
    assert.ok(!studioHtml.includes('Client name') && !studioHtml.includes('>Business'), 'job forms no longer say Client name or Business');
    assert.ok(studioJs.includes('>Client</label>') && studioJs.includes('>Contact</label>'), 'quote form labels are Client and Contact');
    assert.ok(proofJs.includes('<span class="k">Client</span>') && proofJs.includes('<span class="k">Contact</span>'));
    const css = fs.readFileSync(path.join(__dirname, '../public/assets/app.css'), 'utf8');
    assert.ok(/\.q-brand\{[^}]*min-height:0/.test(css));
    assert.ok(/\.q-brand \.logo img\{width:78px/.test(css));
    assert.ok(css.includes('.q-fields{display:grid;grid-template-columns:1fr 1fr'));
    assert.ok(css.includes('body.is-quote .q-fields{grid-template-columns:1fr 1fr!important'));
    const nameless = await req(server, 'POST', `/api/quote/${q.id}/decision?k=${encodeURIComponent(key)}`, { studio: false, body: { type: 'accept', name: '  ' } });
    assert.strictEqual(nameless.status, 400);
    assert.strictEqual(sent.length, 0, 'a rejected accept does not email');
    const noted = await req(server, 'POST', `/api/quote/${q.id}/decision?k=${encodeURIComponent(key)}`, { studio: false, body: { type: 'changes', name: 'Nicola', note: 'Please drop the gloss.' } });
    assert.strictEqual(noted.status, 200);
    assert.strictEqual(noted.json.status, 'changes');
    assert.strictEqual(noted.json.responses[0].note, 'Please drop the gloss.');
    assert.ok(!('jobId' in noted.json), 'client payload stays free of the job id');
    const afterChanges = await req(server, 'GET', '/api/jobs');
    assert.strictEqual(afterChanges.json.length, 0, 'request changes does not create a job');
    assert.strictEqual(sent.length, 1, 'request changes emails staff');
    assert.strictEqual(sent[0].to, DEFAULT_NOTIFY_EMAIL, 'changes go to the same default trio as job alerts');
    assert.strictEqual(sent[0].from, 'proofs@ybicreative.com.au', 'quote mail keeps the proof From address');
    assert.strictEqual(sent[0].subject, '[YBI Quote] CHANGES: Business cards, 400gsm');
    assert.ok(sent[0].text.includes('Please drop the gloss.'));
    assert.ok(!sent[0].text.includes('Proof job:'), 'changes mail does not invent a job');
    const seen = await req(server, 'GET', `/api/quotes/${q.id}`);
    assert.strictEqual(seen.json.responses[0].note, 'Please drop the gloss.');
    assert.ok(!seen.json.jobId, 'changes does not link a job');
    const accepted = await req(server, 'POST', `/api/quote/${q.id}/decision?k=${encodeURIComponent(key)}`, { studio: false, body: { type: 'accept', name: 'Nicola', note: '' } });
    assert.strictEqual(accepted.status, 200);
    assert.strictEqual(accepted.json.status, 'accepted');
    assert.ok(!('jobId' in accepted.json) && !('jobNumber' in accepted.json), 'confirm screen payload is unchanged');
    const jobsNow = await req(server, 'GET', '/api/jobs');
    const createdJob = jobsNow.json.find(j => j.quoteId === q.id);
    assert.ok(createdJob, 'accept adds the job to the studio list');
    assert.strictEqual(jobsNow.json.filter(j => j.quoteId === q.id).length, 1);
    assert.strictEqual(createdJob.jobNumber, '', 'accept does not invent a job number');
    assert.strictEqual(createdJob.clientName, 'Acme Print', 'quote Client is the job Client');
    assert.strictEqual(createdJob.clientCompany, 'Nicola', 'quote Contact is the job Contact');
    assert.strictEqual(createdJob.description, 'Business cards, 400gsm');
    assert.ok(!/^\d/.test(createdJob.description), 'the description is not prefixed with a number');
    assert.strictEqual(createdJob.clientEmail, '');
    assert.strictEqual(createdJob.clientPhone, '');
    assert.deepStrictEqual(createdJob.versions, []);
    assert.strictEqual(createdJob.status, 'draft');
    const againAccept = await req(server, 'POST', `/api/quote/${q.id}/decision?k=${encodeURIComponent(key)}`, { studio: false, body: { type: 'accept', name: 'Nicola' } });
    assert.strictEqual(againAccept.status, 409);
    assert.strictEqual(sent.length, 2, 'a second accept does not send another email');
    const jobsAfter = await req(server, 'GET', '/api/jobs');
    assert.strictEqual(jobsAfter.json.filter(j => j.quoteId === q.id).length, 1, 're-accept does not duplicate the job');
    const linked = await req(server, 'GET', `/api/quotes/${q.id}`);
    assert.strictEqual(linked.json.jobId, createdJob.id);
    assert.ok(!linked.json.jobNumber, 'the quote does not show an invented job number');
    assert.strictEqual(sent[1].to, DEFAULT_NOTIFY_EMAIL);
    assert.strictEqual(sent[1].from, 'proofs@ybicreative.com.au');
    assert.strictEqual(sent[1].subject, '[YBI Quote] CONFIRMED: Business cards, 400gsm');
    assert.ok(sent[1].text.includes('Client: Acme Print'));
    assert.ok(sent[1].text.includes('Contact: Nicola'));
    assert.ok(sent[1].text.includes('Proof job number: (not set — add it in the studio)'));
    assert.ok(sent[1].text.includes(`/studio/${createdJob.id}`));
    assert.ok(!sent[1].text.includes('Proof job: 1') && !/Proof job number: \d/.test(sent[1].text));
    assert.strictEqual(sent[1].replyTo, undefined);
    const log = fs.readFileSync(path.join(dataDir, 'notifications.log'), 'utf8');
    assert.ok(log.includes('CONFIRMED — Quote for Acme Print'));
    assert.ok(log.includes('Please drop the gloss.'));
    assert.ok(log.includes('Proof job number: (not set — add it in the studio)'));
    assert.ok(!log.includes('Proof job: 30435'));
    const uploaded = await req(server, 'POST', `/api/jobs/${createdJob.id}/versions?name=cards.pdf`, { headers: { 'Content-Type': 'application/pdf' }, body: Buffer.from('%PDF-1.1\n') });
    assert.strictEqual(uploaded.status, 201);
    assert.strictEqual(uploaded.json.versions.length, 1);
    assert.strictEqual(sent.length, 2, 'the first proof on a quote job does not email, same as any new job');

    const again = await req(server, 'GET', `/api/quotes/${q.id}`);
    assert.strictEqual(again.status, 200);
    assert.strictEqual(again.json.total, 71500);
    assert.strictEqual(again.json.contactName, 'Nicola');

    const list = await req(server, 'GET', '/api/quotes');
    assert.strictEqual(list.json.quotes.length, 1);
    assert.strictEqual(list.json.quotes[0].id, q.id);
    assert.ok(!list.json.quotes[0].lines, 'list is a summary');

    const same = await req(server, 'POST', '/api/quotes', { body: {
      client: 'Same',
      date: '2026-11-02',
      validity: '7 days',
      lines: [{ description: 'Once', price: '100' }, { description: 'Also once', qty: '1', price: '100' }]
    }});
    assert.strictEqual(same.json.lines[0].amount, same.json.lines[1].amount);
    assert.strictEqual(same.json.subtotal, 20000);

    const free = await req(server, 'POST', '/api/quotes', { body: {
      client: 'Free sample',
      date: '2026-11-02',
      validity: '6 months',
      lines: [{ description: 'Sample', qty: '0', price: '80' }]
    }});
    assert.strictEqual(free.json.lines[0].amount, 0);
    assert.strictEqual(free.json.total, 0);

    const odd = await req(server, 'POST', '/api/quotes', { body: {
      client: 'Odd cents',
      date: '2026-11-02',
      validity: '7 days',
      lines: [{ price: '1.05' }]
    }});
    assert.strictEqual(odd.json.subtotal, 105);
    assert.strictEqual(odd.json.gst, 11);
    assert.strictEqual(odd.json.total, 116);

    const updated = await req(server, 'PUT', `/api/quotes/${q.id}`, { body: {
      client: 'Acme Print',
      contactName: 'Rob',
      date: '2026-11-03',
      description: 'Revised',
      validity: '7 days',
      lines: [{ description: 'Design', price: '100' }]
    }});
    assert.strictEqual(updated.status, 200);
    assert.strictEqual(updated.json.id, q.id);
    assert.strictEqual(updated.json.createdAt, q.createdAt);
    assert.strictEqual(updated.json.contactName, 'Rob');
    assert.strictEqual(updated.json.validity, '7 days');
    assert.strictEqual(updated.json.total, 11000);
    assert.strictEqual(updated.json.jobId, createdJob.id, 'editing the quote keeps the job link');
    assert.ok(!updated.json.jobNumber);
    assert.ok(updated.json.updatedAt >= q.updatedAt);
    const jobAfterEdit = await req(server, 'GET', `/api/jobs/${createdJob.id}`);
    assert.strictEqual(jobAfterEdit.json.clientName, 'Acme Print', 'the job stays as it was when the quote was accepted');
    assert.strictEqual(jobAfterEdit.json.clientCompany, 'Nicola');
    assert.strictEqual(jobAfterEdit.json.description, 'Business cards, 400gsm');

    const badValidity = await req(server, 'POST', '/api/quotes', { body: { client: 'X', date: '2026-11-02', validity: '1 year', lines: [] } });
    assert.strictEqual(badValidity.status, 400);
    const badPrice = await req(server, 'POST', '/api/quotes', { body: { client: 'X', date: '2026-11-02', validity: '30 days', lines: [{ price: '12.345' }] } });
    assert.strictEqual(badPrice.status, 400);
    const tooMany = await req(server, 'POST', '/api/quotes', { body: { client: 'X', date: '2026-11-02', validity: '30 days', lines: Array.from({ length: 21 }, () => ({ price: '1' })) } });
    assert.strictEqual(tooMany.status, 400);
    const noClient = await req(server, 'POST', '/api/quotes', { body: { client: '  ', date: '2026-11-02', validity: '30 days' } });
    assert.strictEqual(noClient.status, 400);

    const parallel = await Promise.all([
      req(server, 'POST', '/api/quotes', { body: { client: 'Parallel A', date: '2026-11-02', validity: '30 days', lines: [{ price: '10' }] } }),
      req(server, 'POST', '/api/quotes', { body: { client: 'Parallel B', date: '2026-11-02', validity: '30 days', lines: [{ price: '20' }] } })
    ]);
    assert.ok(parallel.every(r => r.status === 201));
    const after = await req(server, 'GET', '/api/quotes');
    const names = after.json.quotes.map(item => item.client);
    assert.ok(names.includes('Parallel A') && names.includes('Parallel B'));

    const removed = await req(server, 'DELETE', `/api/quotes/${q.id}`);
    assert.strictEqual(removed.status, 200);
    assert.strictEqual(removed.json.ok, true);
    const gone = await req(server, 'GET', `/api/quotes/${q.id}`);
    assert.strictEqual(gone.status, 404);
    const left = JSON.parse(fs.readFileSync(path.join(dataDir, 'quotes.json'), 'utf8'));
    assert.ok(!left.quotes.some(item => item.id === q.id));
    const jobKept = await req(server, 'GET', `/api/jobs/${createdJob.id}`);
    assert.strictEqual(jobKept.status, 200, 'deleting the quote leaves the job in the list');

    const blank = await req(server, 'POST', '/api/quotes', { body: { client: 'Solo Business', date: '2026-11-02', validity: '30 days', description: 'No contact on this one', lines: [{ price: '10' }] } });
    const blankKey = new URL(blank.json.clientUrl, 'http://localhost').searchParams.get('k');
    const blankChanges = await req(server, 'POST', `/api/quote/${blank.json.id}/decision?k=${encodeURIComponent(blankKey)}`, { studio: false, body: { type: 'changes', name: 'Pat', note: '' } });
    assert.strictEqual(blankChanges.status, 400, 'changes still need a note');
    const blankAccept = await req(server, 'POST', `/api/quote/${blank.json.id}/decision?k=${encodeURIComponent(blankKey)}`, { studio: false, body: { type: 'accept', name: 'Pat' } });
    assert.strictEqual(blankAccept.status, 200);
    const blankJob = (await req(server, 'GET', '/api/jobs')).json.find(j => j.quoteId === blank.json.id);
    assert.strictEqual(blankJob.clientName, 'Solo Business');
    assert.strictEqual(blankJob.clientCompany, '');
    assert.strictEqual(blankJob.jobNumber, '');

    const longText = 'L'.repeat(2500);
    const longQuote = await req(server, 'POST', '/api/quotes', { body: { client: 'Long Co', contactName: 'Long Co', date: '2026-11-02', validity: '7 days', description: longText, lines: [] } });
    const longKey = new URL(longQuote.json.clientUrl, 'http://localhost').searchParams.get('k');
    const longAccept = await req(server, 'POST', `/api/quote/${longQuote.json.id}/decision?k=${encodeURIComponent(longKey)}`, { studio: false, body: { type: 'accept', name: 'Pat' } });
    assert.strictEqual(longAccept.status, 200);
    const longJob = (await req(server, 'GET', '/api/jobs')).json.find(j => j.quoteId === longQuote.json.id);
    assert.strictEqual(longJob.description.length, 2000);
    assert.strictEqual(longJob.jobNumber, '');
    assert.strictEqual(longJob.clientName, 'Long Co');
    assert.strictEqual(longJob.clientCompany, 'Long Co', 'a filled contact is stored even when it matches the client');

    const changesOnly = await req(server, 'POST', '/api/quotes', { body: { client: 'Hold', contactName: 'Sam', date: '2026-11-02', validity: '30 days', description: 'Wait', lines: [{ price: '5' }] } });
    const holdKey = new URL(changesOnly.json.clientUrl, 'http://localhost').searchParams.get('k');
    const held = await req(server, 'POST', `/api/quote/${changesOnly.json.id}/decision?k=${encodeURIComponent(holdKey)}`, { studio: false, body: { type: 'changes', name: 'Sam', note: 'Not yet.' } });
    assert.strictEqual(held.status, 200);
    assert.ok(!(await req(server, 'GET', '/api/jobs')).json.some(j => j.quoteId === changesOnly.json.id));

    await req(server, 'POST', '/api/settings', { body: { notifyEmail: 'ops@example.com, ops@example.com; other@example.com' } });
    const listed = await req(server, 'POST', '/api/quotes', { body: { client: 'Listed', contactName: 'Ada', date: '2026-11-02', validity: '30 days', description: 'Uses the saved list', lines: [{ price: '8' }] } });
    const listKey = new URL(listed.json.clientUrl, 'http://localhost').searchParams.get('k');
    const beforeListed = sent.length;
    const listedChanges = await req(server, 'POST', `/api/quote/${listed.json.id}/decision?k=${encodeURIComponent(listKey)}`, { studio: false, body: { type: 'changes', name: 'Ada', note: 'Check the crop.' } });
    assert.strictEqual(listedChanges.status, 200);
    const listedAccept = await req(server, 'POST', `/api/quote/${listed.json.id}/decision?k=${encodeURIComponent(listKey)}`, { studio: false, body: { type: 'accept', name: 'Ada' } });
    assert.strictEqual(listedAccept.status, 200);
    assert.strictEqual(sent[beforeListed].to, 'ops@example.com, other@example.com', 'quote changes follow the saved notification list');
    assert.strictEqual(sent[beforeListed + 1].to, 'ops@example.com, other@example.com', 'quote confirm follows the saved notification list');
    assert.strictEqual(sent[beforeListed + 1].from, 'proofs@ybicreative.com.au');

    const orphan = await req(server, 'POST', '/api/quotes', { body: { client: 'Orphan Co', contactName: 'Pat', date: '2026-11-02', validity: '30 days', description: 'Retry me', lines: [{ price: '3' }] } });
    const orphanKey = new URL(orphan.json.clientUrl, 'http://localhost').searchParams.get('k');
    const orphanId = 'abc123abc123';
    const orphanJob = { id: orphanId, token: 'tokentokentokentoken12', jobNumber: '888001', description: 'Existing', clientName: 'Keep Me', clientCompany: 'Orphan Co', clientEmail: '', clientPhone: '', quoteId: orphan.json.id, access: 'private', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), versions: [] };
    fs.mkdirSync(path.join(dataDir, 'files', orphanId), { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'jobs', orphanId + '.json'), JSON.stringify(orphanJob));
    const orphanAccept = await req(server, 'POST', `/api/quote/${orphan.json.id}/decision?k=${encodeURIComponent(orphanKey)}`, { studio: false, body: { type: 'accept', name: 'Pat' } });
    assert.strictEqual(orphanAccept.status, 200);
    const orphanSeen = await req(server, 'GET', `/api/quotes/${orphan.json.id}`);
    assert.strictEqual(orphanSeen.json.jobId, orphanId);
    assert.strictEqual(orphanSeen.json.jobNumber, '888001');
    const orphanJobs = (await req(server, 'GET', '/api/jobs')).json.filter(j => j.quoteId === orphan.json.id);
    assert.strictEqual(orphanJobs.length, 1);
    assert.strictEqual(orphanJobs[0].clientName, 'Keep Me', 'a recovered job is not overwritten');

    const raced = await req(server, 'POST', '/api/quotes', { body: { client: 'Race Co', contactName: 'Jo', date: '2026-11-02', validity: '7 days', description: 'Once only', lines: [{ price: '9' }] } });
    const raceKey = new URL(raced.json.clientUrl, 'http://localhost').searchParams.get('k');
    const racedPair = await Promise.all([
      req(server, 'POST', `/api/quote/${raced.json.id}/decision?k=${encodeURIComponent(raceKey)}`, { studio: false, body: { type: 'accept', name: 'Jo' } }),
      req(server, 'POST', `/api/quote/${raced.json.id}/decision?k=${encodeURIComponent(raceKey)}`, { studio: false, body: { type: 'accept', name: 'Jo' } })
    ]);
    assert.deepStrictEqual(racedPair.map(r => r.status).sort(), [200, 409]);
    assert.strictEqual((await req(server, 'GET', '/api/jobs')).json.filter(j => j.quoteId === raced.json.id).length, 1, 'two accepts at once still create one job');

    console.log('quotes: ok');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
