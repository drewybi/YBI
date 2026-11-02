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

const { createAppServer } = require('../server');

function req(server, method, urlPath, { headers = {}, body, studio = true } = {}) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (studio) h['X-Studio-Key'] = process.env.STUDIO_PASSWORD;
    if (body != null && !h['Content-Type']) h['Content-Type'] = 'application/json';
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
    r.end(body == null ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)));
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
    const css = fs.readFileSync(path.join(__dirname, '../public/assets/app.css'), 'utf8');
    assert.ok(/\.q-brand\{[^}]*min-height:0/.test(css));
    assert.ok(/\.q-brand \.logo img\{width:78px/.test(css));
    const noted = await req(server, 'POST', `/api/quote/${q.id}/decision?k=${encodeURIComponent(key)}`, { studio: false, body: { type: 'changes', name: 'Nicola', note: 'Please drop the gloss.' } });
    assert.strictEqual(noted.status, 200);
    assert.strictEqual(noted.json.status, 'changes');
    assert.strictEqual(noted.json.responses[0].note, 'Please drop the gloss.');
    const seen = await req(server, 'GET', `/api/quotes/${q.id}`);
    assert.strictEqual(seen.json.responses[0].note, 'Please drop the gloss.');
    const accepted = await req(server, 'POST', `/api/quote/${q.id}/decision?k=${encodeURIComponent(key)}`, { studio: false, body: { type: 'accept', name: 'Nicola', note: '' } });
    assert.strictEqual(accepted.status, 200);
    assert.strictEqual(accepted.json.status, 'accepted');
    const againAccept = await req(server, 'POST', `/api/quote/${q.id}/decision?k=${encodeURIComponent(key)}`, { studio: false, body: { type: 'accept', name: 'Nicola' } });
    assert.strictEqual(againAccept.status, 409);
    const log = fs.readFileSync(path.join(dataDir, 'notifications.log'), 'utf8');
    assert.ok(log.includes('CONFIRMED — Quote for Acme Print'));
    assert.ok(log.includes('Please drop the gloss.'));

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
    assert.ok(updated.json.updatedAt >= q.updatedAt);

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

    console.log('quotes: ok');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
