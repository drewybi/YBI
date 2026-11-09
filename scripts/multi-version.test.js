'use strict';
// Several JPG/PNG files share one proof version. Several PDFs share one version too.
// A single PDF stays one file. Legacy jobs that only have originalName/stored/kind still download.
// Legacy jobs that only have originalName/stored/kind still download.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { PassThrough } = require('stream');
const { PDFDocument } = require('pdf-lib');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ybi-multi-'));
process.env.DATA_DIR = dataDir;
process.env.BASE_PATH = '';
process.env.STUDIO_PASSWORD = 'test-proof';
process.env.PORT = '0';
delete process.env.SMTP_HOST;
delete process.env.NOTIFY_EMAIL;

const { createAppServer, readMultipartFiles } = require('../server');
const PNG = fs.readFileSync(path.join(__dirname, '../samples/client-markup.png'));
const JPG = fs.readFileSync(path.join(__dirname, '../samples/poster-A2.jpg'));
const PDF = fs.readFileSync(path.join(__dirname, '../samples/catalogue-V1.pdf'));

function formBody(parts, boundary = '----YbiBoundary7') {
  const chunks = [];
  for (const p of parts) {
    const name = p.name.replace(/"/g, '');
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`
    ));
    chunks.push(p.body);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), type: `multipart/form-data; boundary=${boundary}` };
}

function req(server, method, urlPath, { headers = {}, body, studio = true } = {}) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (studio) h['X-Studio-Key'] = process.env.STUDIO_PASSWORD;
    if (body != null && !h['Content-Type'] && !Buffer.isBuffer(body)) h['Content-Type'] = 'application/json';
    if (body != null && !h['Content-Length']) h['Content-Length'] = Buffer.byteLength(body);
    const r = http.request({ hostname: '127.0.0.1', port, method, path: urlPath, headers: h }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch { /* binary or empty */ }
        resolve({ status: res.statusCode, headers: res.headers, body: buf, text, json });
      });
    });
    r.on('error', reject);
    if (body == null) r.end();
    else r.end(body);
  });
}

function readZip(buf) {
  let eocd = -1;
  const start = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  assert.ok(eocd >= 0, 'zip end of central directory');
  const count = buf.readUInt16LE(eocd + 8);
  let p = buf.readUInt32LE(eocd + 16);
  const files = [];
  for (let n = 0; n < count; n++) {
    assert.strictEqual(buf.readUInt32LE(p), 0x02014b50);
    const nameLen = buf.readUInt16LE(p + 28);
    const extra = buf.readUInt16LE(p + 30);
    const comment = buf.readUInt16LE(p + 32);
    const size = buf.readUInt32LE(p + 24);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const localNameLen = buf.readUInt16LE(localOff + 26);
    const localExtra = buf.readUInt16LE(localOff + 28);
    const dataOff = localOff + 30 + localNameLen + localExtra;
    files.push({ name, data: Buffer.from(buf.subarray(dataOff, dataOff + size)) });
    p += 46 + nameLen + extra + comment;
  }
  return files;
}

async function parseInPieces(body, contentType) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ybi-mp-'));
  const stream = new PassThrough();
  stream.headers = { 'content-type': contentType };
  const pending = readMultipartFiles(stream, dir, { maxFiles: 40, maxEach: 300 * 1024 * 1024, maxTotal: 300 * 1024 * 1024 });
  for (let i = 0; i < body.length; i += 3) stream.write(body.subarray(i, i + 3));
  stream.end();
  const files = await Promise.race([
    pending,
    new Promise((_, reject) => setTimeout(() => reject(new Error('multipart parser timed out')), 8000))
  ]);
  const out = files.map(f => ({ name: f.originalName, size: f.size, bytes: fs.readFileSync(f.storedPath) }));
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

(async () => {
  const studioJs = fs.readFileSync(path.join(__dirname, '../public/assets/studio.js'), 'utf8');
  const reviewJs = fs.readFileSync(path.join(__dirname, '../public/assets/review.js'), 'utf8');
  const studioHtml = fs.readFileSync(path.join(__dirname, '../public/studio.html'), 'utf8');
  assert.ok(studioJs.includes('uploadFiles'), 'studio uploads a set through one multipart request');
  assert.ok(studioHtml.includes('multiple'), 'new-job file input accepts several files');
  assert.ok(studioJs.includes('type="file" multiple'), 'version upload accepts several files');
  assert.ok(reviewJs.includes('Download all'), 'client review offers download all');

  const pieces = formBody([{ name: 'front.png', body: PNG }, { name: 'detail.jpg', body: JPG }]);
  const parsed = await parseInPieces(pieces.body, pieces.type);
  assert.deepStrictEqual(parsed.map(f => f.name), ['front.png', 'detail.jpg'], 'parser keeps file order across tiny chunks');
  assert.ok(parsed[0].bytes.equals(PNG) && parsed[1].bytes.equals(JPG), 'parser writes each image intact');
  console.log('  ✓ multipart parser reassembles images from 3-byte chunks');

  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const fail = m => { console.error('  ✗ ' + m); server.close(); process.exit(1); };
  const check = (cond, m) => { if (!cond) fail(m); console.log('  ✓ ' + m); };

  const num = 'M' + Date.now().toString(36);
  let created = await req(server, 'POST', '/api/jobs', { body: JSON.stringify({ jobNumber: num, clientName: 'Sam Client', description: 'Two-page art' }) });
  check(created.status === 201, 'job created');
  const job = created.json;

  const up = await req(server, 'POST', `/api/jobs/${job.id}/versions?note=${encodeURIComponent('Spread updated')}`, {
    headers: { 'Content-Type': pieces.type }, body: pieces.body
  });
  check(up.status === 201, 'multi-image upload creates a version');
  check(up.json.versions.length === 1 && up.json.versions[0].n === 1, 'the images are V1, not two versions');
  check(up.json.versions[0].kind === 'image', 'a JPG/PNG set is an image version');
  check(up.json.versions[0].files.length === 2, 'the version lists both images');
  check(up.json.versions[0].files[0].name === 'front.png' && up.json.versions[0].files[1].name === 'detail.jpg', 'image order follows the upload');
  check(up.json.versions[0].size === PNG.length + JPG.length, 'version size is the sum of the images');
  check(up.json.versions[0].originalName === 'front.png', 'originalName stays the first image for older readers');
  check(up.json.versions[0].studioNote === 'Spread updated', 'studio note is saved on the shared version');
  check(typeof up.json.versions[0].downloadAll === 'string' && up.json.versions[0].downloadAll.endsWith('/file/v1/zip?k=' + encodeURIComponent(job.token)), 'download all points at the version zip');

  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'jobs', job.id + '.json'), 'utf8'));
  check(onDisk.versions[0].files.length === 2 && onDisk.versions[0].stored === onDisk.versions[0].files[0].stored, 'stored JSON keeps files[] and the first image in stored');

  const page1 = await req(server, 'GET', up.json.versions[0].files[0].url, { studio: false });
  const page2 = await req(server, 'GET', up.json.versions[0].files[1].url, { studio: false });
  const first = await req(server, 'GET', up.json.versions[0].url, { studio: false });
  check(page1.status === 200 && page1.body.equals(PNG), 'page 1 is the first image');
  check(page2.status === 200 && page2.body.equals(JPG), 'page 2 is the second image');
  check(first.body.equals(PNG), 'the original version URL still returns the first image');

  const zip = await req(server, 'GET', `/${num}/file/v1/zip?k=${encodeURIComponent(job.token)}`, { studio: false });
  check(zip.status === 200 && zip.headers['content-type'] === 'application/zip', 'client zip download');
  check(Number(zip.headers['content-length']) === zip.body.length, 'zip content-length matches the body');
  check(String(zip.headers['content-disposition'] || '').includes(`YBI-${num}-V1.zip`), 'zip is named for the job and version');
  const zipped = readZip(zip.body);
  check(zipped.map(f => f.name).join(',') === 'front.png,detail.jpg', 'zip lists both images');
  check(zipped[0].data.equals(PNG) && zipped[1].data.equals(JPG), 'zip bytes match the uploaded images');
  const head = await req(server, 'HEAD', `/${num}/file/v1/zip?k=${encodeURIComponent(job.token)}`, { studio: false });
  check(head.status === 200 && Number(head.headers['content-length']) === zip.body.length, 'HEAD zip advertises the same length');
  const locked = await req(server, 'GET', `/${num}/file/v1/zip`, { studio: false });
  check(locked.status === 404, 'zip without the client key is hidden');
  const studioZip = await req(server, 'GET', `/${num}/file/v1/zip`);
  const studioFiles = studioZip.status === 200 ? readZip(studioZip.body) : [];
  check(studioZip.status === 200 && studioFiles[0].data.equals(PNG) && studioFiles[1].data.equals(JPG), 'studio can download the same images');
  check((await req(server, 'GET', `/${num}/file/v1/9?k=${job.token}`, { studio: false })).status === 404, 'a page past the end is missing');

  const decision = await req(server, 'POST', `/api/review/${num}/decision?k=${encodeURIComponent(job.token)}`, {
    studio: false,
    body: JSON.stringify({
      type: 'changes', name: 'Sam', note: '', version: 1, attachments: [],
      stickies: [{ page: 1, x: 0.2, y: 0.3, text: 'Move the logo' }, { page: 2, x: 0.4, y: 0.6, text: 'Fix the phone' }]
    })
  });
  check(decision.status === 200, 'client can mark either image');
  const fb = decision.json.versions[0].feedback[0];
  const changes = await req(server, 'GET', `/api/jobs/${job.id}/changes.pdf?v=1&f=${encodeURIComponent(fb.id)}`);
  check(changes.status === 200, 'changes PDF builds for a multi-image version');
  const pdf = await PDFDocument.load(changes.body);
  check(pdf.getPageCount() === 3, 'changes PDF has one page per image plus the checklist');

  const v2 = await req(server, 'POST', `/api/jobs/${job.id}/versions?name=rev.pdf`, { headers: { 'Content-Type': 'application/pdf' }, body: PDF });
  check(v2.status === 201 && v2.json.versions.length === 2, 'a later PDF is the next version');
  check(!Object.prototype.hasOwnProperty.call(JSON.parse(fs.readFileSync(path.join(dataDir, 'jobs', job.id + '.json'), 'utf8')).versions[1], 'files'), 'a single PDF is stored without files[]');
  check(v2.json.versions[1].kind === 'pdf' && !v2.json.versions[1].downloadAll, 'a PDF does not offer a zip');
  const logPath = path.join(dataDir, 'notifications.log');
  const log = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
  check(!log.includes(`UPDATED — Job ${num}`) && !log.includes('File: rev.pdf'), 'a new version does not notify staff');
  const client = await req(server, 'GET', `/api/review/${num}?k=${encodeURIComponent(job.token)}`, { studio: false });
  check(client.json.versions.length === 2 && client.json.versions[0].files.length === 2 && client.json.versions[1].url.endsWith('/file/v2?k=' + encodeURIComponent(job.token)), 'the client still receives both versions');

  const single = await req(server, 'POST', '/api/jobs', { body: JSON.stringify({ jobNumber: num + 'S', clientName: 'Single', description: 'One file' }) });
  const one = formBody([{ name: 'only.png', body: PNG }]);
  const oneUp = await req(server, 'POST', `/api/jobs/${single.json.id}/versions`, { headers: { 'Content-Type': one.type }, body: one.body });
  check(oneUp.status === 201 && oneUp.json.versions[0].files.length === 1 && !oneUp.json.versions[0].downloadAll, 'one image is still a normal version');
  check(!Object.prototype.hasOwnProperty.call(JSON.parse(fs.readFileSync(path.join(dataDir, 'jobs', single.json.id + '.json'), 'utf8')).versions[0], 'files'), 'a one-image upload does not add files[] on disk');
  check((await req(server, 'GET', `/${num}S/file/v1/zip?k=${single.json.token}`, { studio: false })).status === 404, 'a single image has no zip');

  const raw = await req(server, 'POST', `/api/jobs/${single.json.id}/versions?name=poster.jpg`, { headers: { 'Content-Type': 'image/jpeg' }, body: JPG });
  check(raw.status === 201 && raw.json.versions.length === 2 && raw.json.versions[1].originalName === 'poster.jpg', 'the original raw upload still adds the next version');

  const bad = await req(server, 'POST', '/api/jobs', { body: JSON.stringify({ jobNumber: num + 'B', clientName: 'Bad', description: 'Rejects' }) });
  const mix = formBody([{ name: 'page.pdf', body: PDF }, { name: 'page.png', body: PNG }]);
  const mixed = await req(server, 'POST', `/api/jobs/${bad.json.id}/versions`, { headers: { 'Content-Type': mix.type }, body: mix.body });
  check(mixed.status === 400 && /not both in one version/.test(mixed.json.error), 'a PDF is not mixed into an image set');
  const pdfJob = await req(server, 'POST', '/api/jobs', { body: JSON.stringify({ jobNumber: num + 'F', clientName: 'Files', description: 'Two PDFs' }) });
  const twoPdf = formBody([{ name: 'cover.pdf', body: PDF }, { name: 'spread.pdf', body: PDF }]);
  const pdfSet = await req(server, 'POST', `/api/jobs/${pdfJob.json.id}/versions`, { headers: { 'Content-Type': twoPdf.type }, body: twoPdf.body });
  check(pdfSet.status === 201 && pdfSet.json.versions.length === 1 && pdfSet.json.versions[0].kind === 'pdf', 'two PDFs are one version');
  check(pdfSet.json.versions[0].files.map(f => f.name).join(',') === 'cover.pdf,spread.pdf', 'PDF order follows the upload');
  check(pdfSet.json.versions[0].originalName === 'cover.pdf' && pdfSet.json.versions[0].downloadAll.endsWith('/file/v1/zip?k=' + encodeURIComponent(pdfJob.json.token)), 'a PDF set offers download all and keeps the first name');
  const pdfZip = await req(server, 'GET', pdfSet.json.versions[0].downloadAll, { studio: false });
  const pdfNames = pdfZip.status === 200 ? readZip(pdfZip.body).map(f => f.name) : [];
  check(pdfZip.status === 200 && pdfNames.join(',') === 'cover.pdf,spread.pdf', 'download all zips the PDFs in order');
  const firstPdf = await req(server, 'GET', pdfSet.json.versions[0].files[0].url + '&download', { studio: false });
  const secondPdf = await req(server, 'GET', pdfSet.json.versions[0].files[1].url + '&download', { studio: false });
  check(firstPdf.status === 200 && firstPdf.body.equals(PDF) && secondPdf.status === 200 && secondPdf.body.equals(PDF), 'each PDF downloads on its own');
  const marked = await req(server, 'POST', `/api/review/${pdfJob.json.jobNumber}/decision?k=${encodeURIComponent(pdfJob.json.token)}`, {
    studio: false,
    body: JSON.stringify({ type: 'changes', name: 'Sam', note: '', version: 1, attachments: [], stickies: [{ page: 1, x: 0.2, y: 0.3, text: 'Cover logo' }, { page: 4, x: 0.5, y: 0.5, text: 'Second file' }] })
  });
  check(marked.status === 200, 'notes can land on a later PDF in the set');
  const changesPdf = await req(server, 'GET', `/api/jobs/${pdfJob.json.id}/changes.pdf?v=1&f=${encodeURIComponent(marked.json.versions[0].feedback[0].id)}`);
  const merged = changesPdf.status === 200 ? await PDFDocument.load(changesPdf.body) : null;
  check(changesPdf.status === 200 && merged.getPageCount() === 7, 'changes PDF keeps every page of both files plus the checklist');
  const pdfLog = fs.existsSync(path.join(dataDir, 'notifications.log')) ? fs.readFileSync(path.join(dataDir, 'notifications.log'), 'utf8') : '';
  check(!pdfLog.includes('cover.pdf') && !pdfLog.includes('spread.pdf'), 'uploading a PDF set does not notify staff');
  const exe = formBody([{ name: 'a.png', body: PNG }, { name: 'run.exe', body: Buffer.from('MZ') }]);
  check((await req(server, 'POST', `/api/jobs/${bad.json.id}/versions`, { headers: { 'Content-Type': exe.type }, body: exe.body })).status === 415, 'a non-proof file is rejected');
  const many = formBody(Array.from({ length: 41 }, (_, i) => ({ name: `p${i}.png`, body: Buffer.from('x') })));
  const tooMany = await req(server, 'POST', `/api/jobs/${bad.json.id}/versions`, { headers: { 'Content-Type': many.type }, body: many.body });
  check(tooMany.status === 400 && /40 images/.test(tooMany.json.error), 'more than 40 images is refused');
  check((await req(server, 'GET', `/api/jobs/${bad.json.id}`)).json.versions.length === 0, 'rejected uploads do not create a version');
  const left = fs.readdirSync(path.join(dataDir, 'files', bad.json.id));
  check(!left.some(n => n.startsWith('incoming-') || n.startsWith('v')), 'rejected uploads do not leave proof files behind');

  const legacyId = 'abc123abc123';
  const legacyNum = num + 'L';
  const legacyToken = 'legacytokenlegacytoken12';
  fs.mkdirSync(path.join(dataDir, 'files', legacyId), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'files', legacyId, 'v1-old.png'), PNG);
  fs.writeFileSync(path.join(dataDir, 'jobs', legacyId + '.json'), JSON.stringify({
    id: legacyId, token: legacyToken, jobNumber: legacyNum, description: 'Old job', clientName: 'Old Client',
    clientCompany: '', clientEmail: '', clientPhone: '', access: 'private', createdAt: '2020-01-01T00:00:00.000Z',
    versions: [{ n: 1, kind: 'image', originalName: 'legacy.png', stored: 'v1-old.png', size: PNG.length, uploadedAt: '2020-01-02T00:00:00.000Z', feedback: [] }]
  }));
  const legacy = await req(server, 'GET', `/api/review/${legacyNum}?k=${legacyToken}`, { studio: false });
  check(legacy.status === 200 && legacy.json.versions[0].files.length === 1 && !legacy.json.versions[0].downloadAll, 'an old single-file job still has one page and no zip');
  check(legacy.json.versions[0].url.endsWith('/file/v1?k=' + encodeURIComponent(legacyToken)), 'the old version URL is unchanged');
  const legacyFile = await req(server, 'GET', legacy.json.versions[0].url, { studio: false });
  check(legacyFile.status === 200 && legacyFile.body.equals(PNG), 'an old stored image still downloads');

  const gone = await req(server, 'DELETE', `/api/jobs/${job.id}/versions/1`);
  check(gone.status === 200 && gone.json.versions.length === 1 && gone.json.versions[0].n === 2, 'removing the image set leaves the later PDF');
  const names = fs.readdirSync(path.join(dataDir, 'files', job.id));
  check(!names.some(n => n.endsWith('.png') || n.endsWith('.jpg')), 'removing the version deletes every image in it');
  check((await req(server, 'GET', `/${num}/file/v1/zip?k=${job.token}`, { studio: false })).status === 404, 'the zip is gone with the version');

  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log('multi-version tests passed');
})().catch(e => { console.error(e); process.exit(1); });
