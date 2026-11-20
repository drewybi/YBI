'use strict';
// YBI FX is a separate tenant: own data, own password, host proofs.ybifx.com.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const creativeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ybi-creative-'));
const fxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ybi-fx-'));
process.env.DATA_DIR = creativeDir;
process.env.FX_DATA_DIR = fxDir;
process.env.BASE_PATH = '';
process.env.STUDIO_PASSWORD = 'creative-secret';
process.env.STUDIO_PASSWORD_FX = 'fx-secret';
delete process.env.BRAND;
delete process.env.DEMO_SEED;
process.env.PORT = '0';

const { createAppServer } = require('../server');

function req(server, method, urlPath, { headers = {}, body, key } = {}) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (key) h['X-Studio-Key'] = key;
    if (body != null && !h['Content-Type']) h['Content-Type'] = 'application/json';
    const r = http.request({ hostname: '127.0.0.1', port, method, path: urlPath, headers: h }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* pdf or html */ }
        resolve({ status: res.statusCode, text, json, headers: res.headers });
      });
    });
    r.on('error', reject);
    r.end(body == null || typeof body === 'string' ? body : JSON.stringify(body));
  });
}

const fxHeaders = { 'X-Forwarded-Host': 'proofs.ybifx.com' };
const lines = [
  { description: 'Scrolls', qty: '1', price: '100.00' },
  { description: 'Town name', qty: '2', price: '40' }
];

(async () => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const creativeBrand = await req(server, 'GET', '/api/brand');
    assert.strictEqual(creativeBrand.json.id, 'creative');
    const fxBrand = await req(server, 'GET', '/api/brand', { headers: fxHeaders });
    assert.strictEqual(fxBrand.json.id, 'fx');
    assert.strictEqual(fxBrand.json.email, 'fx@ybicreative.com.au');

    const creativeJob = await req(server, 'POST', '/api/jobs', { key: 'creative-secret', body: { jobNumber: '30434', clientName: 'Creative Client' } });
    assert.strictEqual(creativeJob.status, 201);
    const fxSeesCreative = await req(server, 'GET', '/api/jobs', { key: 'fx-secret', headers: fxHeaders });
    assert.strictEqual(fxSeesCreative.status, 200);
    assert.strictEqual(fxSeesCreative.json.length, 0, 'FX must not see Creative jobs');
    const creativeSeesFxKey = await req(server, 'GET', '/api/jobs', { key: 'fx-secret' });
    assert.strictEqual(creativeSeesFxKey.status, 401);

    const quoteJob = await req(server, 'POST', '/api/jobs', {
      key: 'fx-secret', headers: fxHeaders,
      body: { mode: 'quote', jobNumber: 'FX-2201', client: "Hovey's Transport", contactName: 'Geelong', date: '2026-11-20', validity: '30 days', description: 'Scroll package', lines }
    });
    assert.strictEqual(quoteJob.status, 201, quoteJob.text);
    assert.strictEqual(quoteJob.json.phase, 'quoting');
    assert.ok(quoteJob.json.quote && quoteJob.json.quote.clientUrl.includes('/quote/'));

    const blocked = await req(server, 'POST', `/api/jobs/${quoteJob.json.id}/versions?name=proof.pdf`, {
      key: 'fx-secret', headers: { ...fxHeaders, 'Content-Type': 'application/pdf' }, body: '%PDF-1.1'
    });
    assert.strictEqual(blocked.status, 409);

    const pdf = await req(server, 'GET', `/api/quotes/${quoteJob.json.quote.id}/pdf`, { key: 'fx-secret', headers: fxHeaders });
    assert.strictEqual(pdf.status, 200);
    assert.ok(pdf.text.startsWith('%PDF'), 'quote pdf bytes');

    const creativeQuoteMode = await req(server, 'POST', '/api/jobs', { key: 'creative-secret', body: { mode: 'quote', jobNumber: 'FX-9', clientName: 'Nope', client: 'Nope', date: '2026-11-20', validity: '30 days', lines } });
    assert.strictEqual(creativeQuoteMode.status, 400);

    const decision = await req(server, 'POST', `/api/quote/${quoteJob.json.quote.id}/decision?k=${encodeURIComponent(quoteJob.json.quote.clientUrl.split('k=')[1])}`, {
      headers: fxHeaders,
      body: { type: 'changes', name: 'Pat', note: 'Make the town name larger.' }
    });
    assert.strictEqual(decision.status, 200, decision.text);
    assert.strictEqual(decision.json.status, 'changes');

    const revised = await req(server, 'PUT', `/api/quotes/${quoteJob.json.quote.id}`, {
      key: 'fx-secret', headers: fxHeaders,
      body: { client: "Hovey's Transport", contactName: 'Geelong', date: '2026-11-20', validity: '30 days', description: 'Scroll package, larger town name', lines }
    });
    assert.strictEqual(revised.status, 200, revised.text);
    assert.strictEqual(revised.json.version, 2);

    const approved = await req(server, 'POST', `/api/quote/${quoteJob.json.quote.id}/decision?k=${encodeURIComponent(quoteJob.json.quote.clientUrl.split('k=')[1])}`, {
      headers: fxHeaders,
      body: { type: 'accept', name: 'Pat', note: '' }
    });
    assert.strictEqual(approved.status, 200, approved.text);
    const unlocked = await req(server, 'GET', `/api/jobs/${quoteJob.json.id}`, { key: 'fx-secret', headers: fxHeaders });
    assert.strictEqual(unlocked.json.phase, 'proofs');

    const proofOnly = await req(server, 'POST', '/api/jobs', { key: 'fx-secret', headers: fxHeaders, body: { jobNumber: 'FX-2208', clientName: 'AJM Transport', description: 'Door lettering' } });
    assert.strictEqual(proofOnly.status, 201);
    assert.strictEqual(proofOnly.json.phase, 'proofs');

    const creativeList = await req(server, 'GET', '/api/jobs', { key: 'creative-secret' });
    assert.strictEqual(creativeList.json.length, 1);
    assert.strictEqual(creativeList.json[0].jobNumber, '30434');

    console.log('fx-tenant: ok');
  } finally {
    server.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
