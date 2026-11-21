'use strict';
// YBI FX shares the proofs service under /fx. YBI stays at /proof, with its own data and session.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const creativeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ybi-creative-'));
process.env.DATA_DIR = creativeDir;
delete process.env.FX_DATA_DIR;
process.env.BASE_PATH = '/proof';
process.env.STUDIO_PASSWORD = 'creative-secret';
process.env.STUDIO_PASSWORD_FX = 'fx-secret';
delete process.env.BRAND;
delete process.env.DEMO_SEED;
delete process.env.FX_EMAILS_ENABLED;
process.env.PORT = '0';

const { createAppServer, setMailerForTests } = require('../server');
const sentMail = [];
setMailerForTests({ sendMail(opts) { sentMail.push(opts); return Promise.resolve(); } });

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
        const setCookie = res.headers['set-cookie'];
        resolve({ status: res.statusCode, text, json, headers: res.headers, setCookie: Array.isArray(setCookie) ? setCookie.join('; ') : (setCookie || '') });
      });
    });
    r.on('error', reject);
    r.end(body == null || typeof body === 'string' ? body : JSON.stringify(body));
  });
}

const Y = '/proof';
const FX = '/fx/proof';
const lines = [
  { description: 'Scrolls', qty: '1', price: '100.00' },
  { description: 'Town name', qty: '2', price: '40' }
];

(async () => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const creativeBrand = await req(server, 'GET', `${Y}/api/brand`);
    assert.strictEqual(creativeBrand.json.id, 'creative');
    const fxBrand = await req(server, 'GET', `${FX}/api/brand`);
    assert.strictEqual(fxBrand.json.id, 'fx');
    assert.strictEqual(fxBrand.json.email, 'fx@ybicreative.com.au');
    assert.ok(fxBrand.json.logo.includes(`${FX}/assets/img/ybifx-logo-white.svg`));

    const fxPage = await req(server, 'GET', `${FX}/`);
    assert.strictEqual(fxPage.status, 200);
    assert.ok(fxPage.text.includes('data-brand="fx"'), 'fx login is branded');
    assert.ok(fxPage.text.includes(`${FX}/assets/img/ybifx-logo-white.svg`), 'fx logo url');
    assert.ok(fxPage.text.includes(`${FX}/assets/app.css`), 'fx css url');
    assert.ok(fxPage.text.includes('<title>Artwork proofs · YBI FX Proofs</title>'));
    assert.ok(!fxPage.text.includes('property="og:'));
    assert.ok(fxPage.text.includes('51 Pratts Park Road, Strathdale VIC 3550'), 'fx footer address');
    assert.ok(fxPage.text.includes('Direct 0419 386 142'), 'fx direct number');
    assert.ok(fxPage.text.includes('>www.ybifx.com<'), 'fx site label');
    assert.ok(!fxPage.text.includes('Bendigo VIC 3551'), 'fx no longer uses the Bendigo address');
    const ybiPage = await req(server, 'GET', `${Y}/`);
    assert.ok(ybiPage.text.includes('data-brand="creative"'));
    assert.ok(ybiPage.text.includes('<title>Artwork proofs · YBI Creative</title>'));
    assert.ok(!ybiPage.text.includes('ybifx-logo-white.svg'));
    assert.ok(!ybiPage.text.includes('Strathdale'), 'YBI pages keep their own address');
    assert.ok(!ybiPage.text.includes('0419 386 142'));

    const logo = await req(server, 'GET', `${FX}/assets/img/ybifx-logo-white.svg`);
    assert.strictEqual(logo.status, 200);
    assert.ok(logo.text.includes('<svg'), 'svg bytes');
    assert.ok(!fxPage.text.includes('fx-hero.webp'));

    const ybiLogin = await req(server, 'POST', `${Y}/api/login`, { body: { password: 'creative-secret' } });
    assert.strictEqual(ybiLogin.status, 200);
    assert.ok(ybiLogin.setCookie.includes('ybi_studio='));
    assert.ok(ybiLogin.setCookie.includes('Path=/proof'));
    const ybiCookie = ybiLogin.setCookie.split(';')[0];
    const fxWithYbiSession = await req(server, 'GET', `${FX}/api/jobs`, { headers: { Cookie: ybiCookie } });
    assert.strictEqual(fxWithYbiSession.status, 401, 'YBI session must not open FX');

    const fxLogin = await req(server, 'POST', `${FX}/api/login`, { body: { password: 'fx-secret' } });
    assert.strictEqual(fxLogin.status, 200);
    assert.ok(fxLogin.setCookie.includes('ybi_fx_studio='));
    assert.ok(fxLogin.setCookie.includes('Path=/fx'));
    const fxCookie = fxLogin.setCookie.split(';')[0];
    const ybiWithFxSession = await req(server, 'GET', `${Y}/api/jobs`, { headers: { Cookie: fxCookie } });
    assert.strictEqual(ybiWithFxSession.status, 401, 'FX session must not open YBI');
    const fxWithCreativeKey = await req(server, 'GET', `${FX}/api/jobs`, { key: 'creative-secret' });
    assert.strictEqual(fxWithCreativeKey.status, 401);
    const ybiWithFxKey = await req(server, 'GET', `${Y}/api/jobs`, { key: 'fx-secret' });
    assert.strictEqual(ybiWithFxKey.status, 401);

    const fxStudio = await req(server, 'GET', `${FX}/studio`, { headers: { Cookie: fxCookie } });
    assert.strictEqual(fxStudio.status, 200);
    assert.ok(fxStudio.text.includes('<title>Studio · YBI FX Proofs</title>'), fxStudio.text.match(/<title>[^<]+<\/title>/)[0]);
    assert.ok(fxStudio.text.includes('/assets/img/engine-1280.webp'), 'fx uses the YBI hero');
    assert.ok(!fxStudio.text.includes('fx-hero.webp'));
    assert.ok(!fxStudio.text.includes('/studio/calendar'), 'fx nav has no calendar');
    assert.ok(!fxStudio.text.includes('data-tools'), 'fx nav has no tools menu');
    for (const path of ['/studio/quote', '/studio/settings']) {
      const page = await req(server, 'GET', `${FX}${path}`, { headers: { Cookie: fxCookie } });
      assert.strictEqual(page.status, 200, path);
      assert.ok(page.text.includes('<title>Studio · YBI FX Proofs</title>'), path);
    }
    for (const path of ['/studio/calendar', '/studio/halftone', '/studio/radio']) {
      const page = await req(server, 'GET', `${FX}${path}`, { headers: { Cookie: fxCookie } });
      assert.strictEqual(page.status, 302, path);
      assert.ok(String(page.headers.location).endsWith('/studio'), page.headers.location);
    }
    const fxCal = await req(server, 'GET', `${FX}/api/calendar`, { key: 'fx-secret' });
    assert.strictEqual(fxCal.status, 404);
    const ybiStudio = await req(server, 'GET', `${Y}/studio`, { headers: { Cookie: ybiCookie } });
    assert.ok(ybiStudio.text.includes('<title>Studio · YBI Proofs</title>'));
    assert.ok(ybiStudio.text.includes('/studio/calendar'));
    assert.ok(ybiStudio.text.includes('data-tools'));
    assert.ok(!ybiStudio.text.includes('YBI FX Proofs'));
    const fxQuotePage = await req(server, 'GET', `${FX}/quote/0123456789abcdef`);
    assert.ok(fxQuotePage.text.includes('<title>Quote · YBI FX Proofs</title>'));
    const fxProofPage = await req(server, 'GET', `${FX}/FX-1`);
    assert.ok(fxProofPage.text.includes('<title>Artwork proof · YBI FX Proofs</title>'));
    const halftoneJs = await req(server, 'GET', `${FX}/assets/halftone.js`);
    assert.ok(halftoneJs.text.includes('Halftone · YBI FX Proofs'));
    const radioJs = await req(server, 'GET', `${FX}/assets/radio.js`);
    assert.ok(radioJs.text.includes('YBI Radio · YBI FX Proofs'));

    const creativeJob = await req(server, 'POST', `${Y}/api/jobs`, { key: 'creative-secret', body: { jobNumber: '30434', clientName: 'Creative Client', description: 'YBI poster' } });
    assert.strictEqual(creativeJob.status, 201);
    assert.ok(creativeJob.json.secureUrl.includes(`${Y}/30434?k=`));
    const fxSeesCreative = await req(server, 'GET', `${FX}/api/jobs`, { key: 'fx-secret' });
    assert.strictEqual(fxSeesCreative.status, 200);
    assert.strictEqual(fxSeesCreative.json.length, 0, 'FX must not see Creative jobs');

    const ybiProof = await req(server, 'GET', `${Y}/api/review/30434?k=${encodeURIComponent(creativeJob.json.token)}`);
    assert.strictEqual(ybiProof.status, 200);
    assert.strictEqual(ybiProof.json.jobNumber, '30434');
    const ybiHalftone = await req(server, 'GET', `${Y}/studio/halftone`, { key: 'creative-secret' });
    assert.strictEqual(ybiHalftone.status, 200);
    assert.ok(ybiHalftone.text.includes('data-brand="creative"'));
    const ybiRadio = await req(server, 'GET', `${Y}/studio/radio`, { key: 'creative-secret' });
    assert.strictEqual(ybiRadio.status, 200);
    const fxHalftone = await req(server, 'GET', `${FX}/studio/halftone`, { key: 'fx-secret' });
    assert.strictEqual(fxHalftone.status, 302);
    const fxRadioBlocked = await req(server, 'GET', `${FX}/studio/radio`, { key: 'creative-secret' });
    assert.strictEqual(fxRadioBlocked.status, 302);

    const quoteJob = await req(server, 'POST', `${FX}/api/jobs`, {
      key: 'fx-secret',
      body: { mode: 'quote', jobNumber: 'FX-2201', client: "Hovey's Transport", contactName: 'Sam Hovey', date: '2026-11-20', validity: '30 days', description: 'Scroll package', lines }
    });
    assert.strictEqual(quoteJob.status, 201, quoteJob.text);
    assert.strictEqual(quoteJob.json.phase, 'quoting');
    assert.ok(quoteJob.json.quote.clientUrl.includes(`${FX}/quote/`), quoteJob.json.quote.clientUrl);
    assert.ok(quoteJob.json.secureUrl.includes(`${FX}/FX-2201?k=`));

    const sameNumber = await req(server, 'POST', `${Y}/api/jobs`, { key: 'creative-secret', body: { jobNumber: 'FX-2201', clientName: 'Not FX' } });
    assert.strictEqual(sameNumber.status, 201, 'YBI can use a number that exists only in FX');

    const blocked = await req(server, 'POST', `${FX}/api/jobs/${quoteJob.json.id}/versions?name=proof.pdf`, {
      key: 'fx-secret', headers: { 'Content-Type': 'application/pdf' }, body: '%PDF-1.1'
    });
    assert.strictEqual(blocked.status, 409);

    const pdf = await req(server, 'GET', `${FX}/api/quotes/${quoteJob.json.quote.id}/pdf`, { key: 'fx-secret' });
    assert.strictEqual(pdf.status, 200);
    assert.ok(pdf.text.startsWith('%PDF'), 'quote pdf bytes');

    const creativeQuoteMode = await req(server, 'POST', `${Y}/api/jobs`, { key: 'creative-secret', body: { mode: 'quote', jobNumber: 'FX-9', clientName: 'Nope', client: 'Nope', date: '2026-11-20', validity: '30 days', lines } });
    assert.strictEqual(creativeQuoteMode.status, 400);

    const quoteKey = quoteJob.json.quote.clientUrl.split('k=')[1];
    const decision = await req(server, 'POST', `${FX}/api/quote/${quoteJob.json.quote.id}/decision?k=${encodeURIComponent(quoteKey)}`, {
      body: { type: 'changes', name: 'Pat', note: 'Make the town name larger.' }
    });
    assert.strictEqual(decision.status, 200, decision.text);
    assert.strictEqual(decision.json.status, 'changes');

    const revised = await req(server, 'PUT', `${FX}/api/quotes/${quoteJob.json.quote.id}`, {
      key: 'fx-secret',
      body: { client: "Hovey's Transport", contactName: 'Sam Hovey', date: '2026-11-20', validity: '30 days', description: 'Scroll package, larger town name', lines }
    });
    assert.strictEqual(revised.status, 200, revised.text);
    assert.strictEqual(revised.json.version, 2);

    const approved = await req(server, 'POST', `${FX}/api/quote/${quoteJob.json.quote.id}/decision?k=${encodeURIComponent(quoteKey)}`, {
      body: { type: 'accept', name: 'Pat', note: '' }
    });
    assert.strictEqual(approved.status, 200, approved.text);
    const unlocked = await req(server, 'GET', `${FX}/api/jobs/${quoteJob.json.id}`, { key: 'fx-secret' });
    assert.strictEqual(unlocked.json.phase, 'proofs');

    const uploaded = await req(server, 'POST', `${FX}/api/jobs/${quoteJob.json.id}/versions?name=door.pdf`, {
      key: 'fx-secret', headers: { 'Content-Type': 'application/pdf' }, body: '%PDF-1.1'
    });
    assert.strictEqual(uploaded.status, 201, uploaded.text);
    const proofKey = unlocked.json.token;
    const clientProof = await req(server, 'GET', `${FX}/api/review/FX-2201?k=${encodeURIComponent(proofKey)}`);
    assert.strictEqual(clientProof.status, 200, clientProof.text);
    assert.strictEqual(clientProof.json.status, 'awaiting_review');
    const clientOk = await req(server, 'POST', `${FX}/api/review/FX-2201/decision?k=${encodeURIComponent(proofKey)}`, {
      body: { type: 'approve', name: 'Sam Hovey', note: 'Print it', version: 1 }
    });
    assert.strictEqual(clientOk.status, 200, clientOk.text);
    assert.strictEqual(clientOk.json.status, 'approved');
    assert.strictEqual(sentMail.length, 0, 'FX quote and proof mail stays off');

    const ybiUp = await req(server, 'POST', `${Y}/api/jobs/30434/versions?name=poster.pdf`, {
      key: 'creative-secret', headers: { 'Content-Type': 'application/pdf' }, body: '%PDF-1.1'
    });
    assert.strictEqual(ybiUp.status, 201, ybiUp.text);
    const ybiOk = await req(server, 'POST', `${Y}/api/review/30434/decision?k=${encodeURIComponent(creativeJob.json.token)}`, {
      body: { type: 'approve', name: 'Creative Client', note: 'Yes', version: 1 }
    });
    assert.strictEqual(ybiOk.status, 200, ybiOk.text);
    assert.ok(sentMail.some(m => String(m.subject).includes('[YBI Proof]')), 'YBI mail still sends');
    assert.ok(!sentMail.some(m => String(m.subject).includes('[YBI FX]')));

    const proofOnly = await req(server, 'POST', `${FX}/api/jobs`, { key: 'fx-secret', body: { jobNumber: 'FX-2208', clientName: 'AJM Transport', description: 'Door lettering' } });
    assert.strictEqual(proofOnly.status, 201);
    assert.strictEqual(proofOnly.json.phase, 'proofs');
    assert.ok(proofOnly.json.secureUrl.includes(`${FX}/FX-2208?k=`));

    const creativeList = await req(server, 'GET', `${Y}/api/jobs`, { key: 'creative-secret' });
    assert.strictEqual(creativeList.json.length, 2);
    assert.ok(creativeList.json.some(j => j.jobNumber === '30434'));
    const fxFiles = fs.readdirSync(path.join(creativeDir, 'fx', 'jobs')).filter(n => n.endsWith('.json'));
    const ybiFiles = fs.readdirSync(path.join(creativeDir, 'jobs')).filter(n => n.endsWith('.json'));
    assert.ok(fxFiles.length >= 2, 'fx jobs live in DATA_DIR/fx');
    assert.strictEqual(ybiFiles.length, 2);
    assert.ok(fxFiles.every(n => !ybiFiles.includes(n)));

    console.log('fx-tenant: ok');
  } finally {
    server.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
