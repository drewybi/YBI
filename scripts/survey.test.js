'use strict';
// YBI FX site surveys. YBI /proof does not grow a survey section.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const creativeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ybi-survey-'));
process.env.DATA_DIR = creativeDir;
process.env.BASE_PATH = '/proof';
process.env.STUDIO_PASSWORD = 'creative-secret';
process.env.STUDIO_PASSWORD_FX = 'fx-secret';
delete process.env.FX_EMAILS_ENABLED;
delete process.env.DEMO_SEED;
process.env.PORT = '0';

const { createAppServer, setMailerForTests } = require('../server');
const { PDFDocument } = require('pdf-lib');
const sent = [];
setMailerForTests({ sendMail(opts) { sent.push(opts); return Promise.resolve(); } });

function req(server, method, urlPath, { headers = {}, body, key } = {}) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (key) h['X-Studio-Key'] = key;
    const payload = body == null || typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    if (payload != null && !Buffer.isBuffer(payload) && !h['Content-Type']) h['Content-Type'] = 'application/json';
    if (Buffer.isBuffer(payload) && !h['Content-Type']) h['Content-Type'] = 'image/jpeg';
    if (payload != null) h['Content-Length'] = Buffer.byteLength(payload);
    const r = http.request({ hostname: '127.0.0.1', port, method, path: urlPath, headers: h }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* pdf or jpeg */ }
        resolve({ status: res.statusCode, text, json, buf, headers: res.headers });
      });
    });
    r.on('error', reject);
    r.end(payload);
  });
}

const Y = '/proof';
const FX = '/fx/proof';
const jpeg = fs.readFileSync(path.join(__dirname, '../samples/poster-A2.jpg'));

(async () => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const ybiKey = 'creative-secret';
    const fxKey = 'fx-secret';

    const ybiAnon = await req(server, 'GET', `${Y}/api/surveys`);
    assert.strictEqual(ybiAnon.status, 401);
    const ybiAuthed = await req(server, 'GET', `${Y}/api/surveys`, { key: ybiKey });
    assert.strictEqual(ybiAuthed.status, 404);
    const ybiPost = await req(server, 'POST', `${Y}/api/surveys`, { key: ybiKey, body: { client: 'Nope', date: '2026-11-22' } });
    assert.strictEqual(ybiPost.status, 404);

    const ybiLogin = await req(server, 'POST', `${Y}/api/login`, { body: { password: ybiKey } });
    const ybiCookie = ybiLogin.headers['set-cookie'][0].split(';')[0];
    const ybiPage = await req(server, 'GET', `${Y}/studio/survey`, { headers: { Cookie: ybiCookie } });
    assert.strictEqual(ybiPage.status, 302);
    assert.ok(String(ybiPage.headers.location).endsWith('/studio'));
    const ybiStudio = await req(server, 'GET', `${Y}/studio`, { headers: { Cookie: ybiCookie } });
    assert.ok(!ybiStudio.text.includes('Site survey'));
    assert.ok(!ybiStudio.text.includes('/studio/survey'));

    const fxAnon = await req(server, 'GET', `${FX}/api/surveys`);
    assert.strictEqual(fxAnon.status, 401);
    const fxStudio = await req(server, 'GET', `${FX}/studio`, { key: fxKey });
    assert.strictEqual(fxStudio.status, 200);
    assert.ok(fxStudio.text.includes('>Site survey</a>'), 'fx nav');
    assert.ok(fxStudio.text.includes(`${FX}/studio/survey`));
    assert.ok(!fxStudio.text.includes('/studio/calendar'));
    const reserved = await req(server, 'POST', `${FX}/api/jobs`, { key: fxKey, body: { jobNumber: 'survey', clientName: 'Nope' } });
    assert.strictEqual(reserved.status, 400);

    const bad = await req(server, 'POST', `${FX}/api/surveys`, { key: fxKey, body: { client: '', date: '2026-11-22' } });
    assert.strictEqual(bad.status, 400);

    const created = await req(server, 'POST', `${FX}/api/surveys`, {
      key: fxKey,
      body: {
        client: "Hovey's Transport",
        address: '12 Example St, Bendigo',
        lat: -36.757, lng: 144.278,
        date: '2026-11-22',
        surveyor: 'Drew',
        contact: 'Sam on site',
        notes: 'Gate code 4512'
      }
    });
    assert.strictEqual(created.status, 201, created.text);
    assert.strictEqual(created.json.client, "Hovey's Transport");
    assert.strictEqual(created.json.lat, -36.757);
    assert.ok(fs.existsSync(path.join(creativeDir, 'fx', 'surveys.json')));
    assert.ok(!fs.existsSync(path.join(creativeDir, 'surveys.json')));
    const sid = created.json.id;

    const ybiCannot = await req(server, 'GET', `${Y}/api/surveys/${sid}`, { key: ybiKey });
    assert.strictEqual(ybiCannot.status, 404);

    const sign = await req(server, 'POST', `${FX}/api/surveys/${sid}/signs`, {
      key: fxKey,
      body: {
        name: 'Front fascia',
        location: 'Above the roller door',
        type: 'fascia',
        widthMm: '2400',
        heightMm: '600 mm',
        installHeightMm: 3200,
        substrate: 'Colorbond',
        access: 'Ladder, power nearby',
        illumination: 'front',
        quantity: 2,
        notes: 'Existing skin stays'
      }
    });
    assert.strictEqual(sign.status, 201, sign.text);
    assert.strictEqual(sign.json.signs.length, 1);
    assert.strictEqual(sign.json.signs[0].widthMm, 2400);
    assert.strictEqual(sign.json.signs[0].heightMm, 600);
    assert.strictEqual(sign.json.signs[0].quantity, 2);
    const signId = sign.json.signs[0].id;

    const badType = await req(server, 'PUT', `${FX}/api/surveys/${sid}/signs/${signId}`, { key: fxKey, body: { type: 'billboard', name: 'Front fascia' } });
    assert.strictEqual(badType.status, 400);

    const photo = await req(server, 'POST', `${FX}/api/surveys/${sid}/signs/${signId}/photos?name=fascia.jpg`, {
      key: fxKey, headers: { 'Content-Type': 'image/jpeg' }, body: jpeg
    });
    assert.strictEqual(photo.status, 201, photo.text);
    const photoId = photo.json.signs[0].photos[0].id;
    const got = await req(server, 'GET', photo.json.signs[0].photos[0].url, { key: fxKey });
    assert.strictEqual(got.status, 200);
    assert.ok(String(got.headers['content-type']).includes('image/jpeg'));
    assert.strictEqual(got.buf[0], 0xff);
    assert.strictEqual(got.buf[1], 0xd8);

    const notJpeg = await req(server, 'POST', `${FX}/api/surveys/${sid}/signs/${signId}/photos?name=note.txt`, {
      key: fxKey, headers: { 'Content-Type': 'text/plain' }, body: 'hello'
    });
    assert.strictEqual(notJpeg.status, 415);

    const marks = await req(server, 'PUT', `${FX}/api/surveys/${sid}/signs/${signId}/photos/${photoId}`, {
      key: fxKey,
      body: {
        markup: {
          items: [
            { type: 'rect', x: 0.1, y: 0.2, w: 0.4, h: 0.3 },
            { type: 'dim', x1: 0.1, y1: 0.55, x2: 0.5, y2: 0.55, label: '2400 mm' },
            { type: 'arrow', x1: 0.2, y1: 0.7, x2: 0.6, y2: 0.4 },
            { type: 'text', x: 0.12, y: 0.18, text: 'Fascia' }
          ],
          scale: { x1: 0, y1: 0, x2: 1, y2: 0, mm: 2400 }
        }
      }
    });
    assert.strictEqual(marks.status, 200, marks.text);
    assert.strictEqual(marks.json.signs[0].photos[0].markup.items.length, 4);
    const marked = await req(server, 'POST', `${FX}/api/surveys/${sid}/signs/${signId}/photos/${photoId}/mark`, {
      key: fxKey, headers: { 'Content-Type': 'image/jpeg' }, body: jpeg
    });
    assert.strictEqual(marked.status, 200, marked.text);
    assert.ok(marked.json.signs[0].photos[0].annotatedUrl.includes('mark=1'));
    const ann = await req(server, 'GET', marked.json.signs[0].photos[0].annotatedUrl, { key: fxKey });
    assert.strictEqual(ann.status, 200);
    assert.strictEqual(ann.buf[0], 0xff);

    const wall = await req(server, 'POST', `${FX}/api/surveys/${sid}/signs`, { key: fxKey, body: { name: 'Side wall', type: 'wall', quantity: 1, widthMm: 900, heightMm: 450 } });
    assert.strictEqual(wall.status, 201, wall.text);

    const pdf = await req(server, 'GET', `${FX}/api/surveys/${sid}/pdf`, { key: fxKey });
    assert.strictEqual(pdf.status, 200, pdf.text.slice(0, 120));
    assert.ok(pdf.text.startsWith('%PDF'));
    assert.ok(String(pdf.headers['content-disposition']).includes('YBI-FX-survey'));
    assert.ok(pdf.buf.length > jpeg.length, 'report includes the photo');
    const doc = await PDFDocument.load(pdf.buf);
    assert.ok(doc.getPageCount() >= 1);

    const anonPdf = await req(server, 'GET', `${FX}/api/surveys/${sid}/pdf`);
    assert.strictEqual(anonPdf.status, 401);

    const quote = await req(server, 'POST', `${FX}/api/surveys/${sid}/quote`, { key: fxKey, body: { jobNumber: 'FX-SV-1' } });
    assert.strictEqual(quote.status, 201, quote.text);
    assert.strictEqual(quote.json.job.phase, 'quoting');
    assert.strictEqual(quote.json.job.surveyId, sid);
    assert.strictEqual(quote.json.job.jobNumber, 'FX-SV-1');
    assert.strictEqual(quote.json.jobId, quote.json.job.id);
    const quoteRow = await req(server, 'GET', `${FX}/api/quotes/${quote.json.quoteId}`, { key: fxKey });
    assert.strictEqual(quoteRow.status, 200, quoteRow.text);
    const fascia = quoteRow.json.lines.find(line => /Front fascia/.test(line.description));
    assert.ok(fascia, JSON.stringify(quoteRow.json.lines.slice(0, 3)));
    assert.ok(/2400/.test(fascia.description));
    assert.strictEqual(fascia.qty, '2');
    assert.strictEqual(sent.length, 0, 'survey quote does not email');

    const again = await req(server, 'POST', `${FX}/api/surveys/${sid}/quote`, { key: fxKey, body: { jobNumber: 'FX-SV-2' } });
    assert.strictEqual(again.status, 200);
    assert.strictEqual(again.json.job.id, quote.json.job.id);

    const job = await req(server, 'GET', `${FX}/api/jobs/FX-SV-1`, { key: fxKey });
    assert.strictEqual(job.json.surveyId, sid);
    assert.strictEqual(job.json.clientName, "Hovey's Transport");

    const other = await req(server, 'POST', `${FX}/api/surveys`, { key: fxKey, body: { client: 'Depot shed', date: '2026-11-21', surveyor: 'Nicola' } });
    assert.strictEqual(other.status, 201, other.text);
    const proof = await req(server, 'POST', `${FX}/api/surveys/${other.json.id}/job`, { key: fxKey, body: { jobNumber: 'FX-SV-9' } });
    assert.strictEqual(proof.status, 201, proof.text);
    assert.strictEqual(proof.json.job.phase, 'proofs');
    assert.strictEqual(proof.json.job.surveyId, other.json.id);
    assert.strictEqual(sent.length, 0);

    const linked = await req(server, 'GET', `${FX}/api/jobs`, { key: fxKey });
    const shed = linked.json.find(j => j.jobNumber === 'FX-2208');
    void shed;
    const fresh = await req(server, 'POST', `${FX}/api/jobs`, { key: fxKey, body: { jobNumber: 'FX-4400', clientName: 'Existing client', description: 'Already quoted' } });
    assert.strictEqual(fresh.status, 201, fresh.text);
    const attach = await req(server, 'PUT', `${FX}/api/surveys/${other.json.id}`, {
      key: fxKey,
      body: { client: 'Depot shed', date: '2026-11-21', surveyor: 'Nicola', jobId: fresh.json.id }
    });
    assert.strictEqual(attach.status, 200, attach.text);
    assert.strictEqual(attach.json.jobNumber, 'FX-4400');
    const attachedJob = await req(server, 'GET', `${FX}/api/jobs/FX-4400`, { key: fxKey });
    assert.strictEqual(attachedJob.json.surveyId, other.json.id);

    const list = await req(server, 'GET', `${FX}/api/surveys`, { key: fxKey });
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.json.surveys.length, 2);
    assert.ok(list.json.surveys.some(s => (s.signNames || []).includes('Front fascia')));

    const removedSign = await req(server, 'DELETE', `${FX}/api/surveys/${sid}/signs/${signId}`, { key: fxKey });
    assert.strictEqual(removedSign.status, 200, removedSign.text);
    assert.ok(!removedSign.json.signs.some(s => s.id === signId));
    const gonePhoto = await req(server, 'GET', `${FX}/api/surveys/${sid}/signs/${signId}/photos/${photoId}`, { key: fxKey });
    assert.strictEqual(gonePhoto.status, 404);

    const removed = await req(server, 'DELETE', `${FX}/api/surveys/${sid}`, { key: fxKey });
    assert.strictEqual(removed.status, 200, removed.text);
    const missing = await req(server, 'GET', `${FX}/api/surveys/${sid}`, { key: fxKey });
    assert.strictEqual(missing.status, 404);
    const jobStays = await req(server, 'GET', `${FX}/api/jobs/FX-SV-1`, { key: fxKey });
    assert.strictEqual(jobStays.status, 200);
    assert.ok(!jobStays.json.surveyId);
    assert.strictEqual(sent.length, 0);

    const ybiStill = await req(server, 'GET', `${Y}/api/jobs`, { key: ybiKey });
    assert.strictEqual(ybiStill.status, 200);
    assert.strictEqual(ybiStill.json.length, 0);
    console.log('survey tests passed');
  } finally {
    server.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
