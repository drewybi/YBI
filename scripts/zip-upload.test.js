'use strict';
// A .zip upload is stored as that file and downloaded as it was uploaded.
// It is not unpacked into pages. Loose JPG/PNG and PDF uploads stay as they were.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ybi-zip-'));
process.env.DATA_DIR = dataDir;
process.env.BASE_PATH = '';
process.env.STUDIO_PASSWORD = 'test-proof';
process.env.PORT = '0';
delete process.env.SMTP_HOST;
delete process.env.NOTIFY_EMAIL;

const { createAppServer } = require('../server');
const PNG = fs.readFileSync(path.join(__dirname, '../samples/client-markup.png'));
const JPG = fs.readFileSync(path.join(__dirname, '../samples/poster-A2.jpg'));
const PDF = fs.readFileSync(path.join(__dirname, '../samples/catalogue-V1.pdf'));

function pythonZip(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ybi-pyzip-'));
  const dest = path.join(dir, 'pages.zip');
  const args = [dest];
  files.forEach((f, i) => {
    const src = path.join(dir, 'src-' + i);
    fs.writeFileSync(src, f.data);
    args.push(src, f.name);
  });
  const script = [
    'import sys, zipfile',
    'z = zipfile.ZipFile(sys.argv[1], "w", compression=zipfile.ZIP_DEFLATED)',
    'args = sys.argv[2:]',
    'i = 0',
    'while i < len(args):',
    '    z.write(args[i], args[i + 1])',
    '    i += 2',
    'z.close()'
  ].join('\n');
  const ran = spawnSync('python3', ['-c', script, ...args], { encoding: 'utf8' });
  if (ran.status !== 0) throw new Error(ran.stderr || 'python zip failed');
  const buf = fs.readFileSync(dest);
  fs.rmSync(dir, { recursive: true, force: true });
  return buf;
}

function formBody(parts, boundary = '----YbiZipBoundary') {
  const chunks = [];
  for (const p of parts) {
    chunks.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${p.name.replace(/"/g, '')}"\r\nContent-Type: application/octet-stream\r\n\r\n`
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
        try { json = JSON.parse(text); } catch { /* binary */ }
        resolve({ status: res.statusCode, headers: res.headers, body: buf, text, json });
      });
    });
    r.on('error', reject);
    if (body == null) r.end();
    else r.end(body);
  });
}

(async () => {
  const studioJs = fs.readFileSync(path.join(__dirname, '../public/assets/studio.js'), 'utf8');
  const studioHtml = fs.readFileSync(path.join(__dirname, '../public/studio.html'), 'utf8');
  const reviewJs = fs.readFileSync(path.join(__dirname, '../public/assets/review.js'), 'utf8');
  const commonJs = fs.readFileSync(path.join(__dirname, '../public/assets/common.js'), 'utf8');
  assert.ok(studioJs.includes('.pdf,.jpg,.jpeg,.png,.zip,'), 'version upload lists .zip');
  assert.ok(studioHtml.includes('accept=".pdf,.jpg,.jpeg,.png,.zip,'), 'new-job file input accepts .zip');
  assert.ok(studioJs.includes('downloaded as it was uploaded'), 'studio copy says the zip is kept');
  assert.ok(!studioJs.includes('ZIP of those images'), 'studio copy does not describe unpacking');
  assert.ok(commonJs.includes('Download zip'), 'the proof view offers download zip');
  assert.ok(commonJs.includes("version.kind === 'zip'"), 'a zip does not go through the page viewer');
  assert.ok(reviewJs.includes('This version is a ZIP file'), 'the client page explains the zip download');

  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const fail = m => { console.error('  ✗ ' + m); server.close(); process.exit(1); };
  const check = (cond, m) => { if (!cond) fail(m); console.log('  ✓ ' + m); };

  const num = 'Z' + Date.now().toString(36);
  const created = await req(server, 'POST', '/api/jobs', { body: JSON.stringify({ jobNumber: num, clientName: 'Sam Client', description: 'Packed art' }) });
  check(created.status === 201, 'job created');
  const job = created.json;
  const packed = pythonZip([
    { name: '10-back.jpg', data: JPG },
    { name: '2-mid.png', data: PNG },
    { name: '__MACOSX/._2-mid.png', data: Buffer.from('AppleDouble') },
    { name: '.DS_Store', data: Buffer.from('ds') },
    { name: 'notes.txt', data: Buffer.from('leave this in the zip') }
  ]);

  const up = await req(server, 'POST', `/api/jobs/${job.id}/versions?name=${encodeURIComponent('My pack.zip')}&note=${encodeURIComponent('Files attached')}`, {
    headers: { 'Content-Type': 'application/zip' }, body: packed
  });
  check(up.status === 201, 'a zip upload creates a version');
  const v1 = up.json.versions[0];
  check(up.json.versions.length === 1 && v1.kind === 'zip', 'the version is a zip, not an image set');
  check(v1.originalName === 'My-pack.zip', 'the original file name is kept');
  check(v1.size === packed.length, 'the version size is the zip itself');
  check(!v1.downloadAll, 'a stored zip is not the image download-all link');
  check(v1.files.length === 1 && v1.files[0].name === 'My-pack.zip', 'the version lists the zip, not the files inside it');
  check(v1.studioNote === 'Files attached', 'studio note is kept');
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, 'jobs', job.id + '.json'), 'utf8'));
  check(!Object.prototype.hasOwnProperty.call(onDisk.versions[0], 'files'), 'a zip is stored as one file, without files[]');
  const names = fs.readdirSync(path.join(dataDir, 'files', job.id));
  check(names.length === 1 && names[0].startsWith('v1-') && names[0].endsWith('.zip'), 'the uploaded zip is the only proof file');

  const file = await req(server, 'GET', `/${num}/file/v1?k=${encodeURIComponent(job.token)}`, { studio: false });
  check(file.status === 200 && file.headers['content-type'] === 'application/zip', 'the client can download the zip');
  check(file.body.equals(packed), 'the download is the original zip, byte for byte');
  check(String(file.headers['content-disposition'] || '').includes('filename="My-pack.zip"'), 'the download uses the original file name');
  check(String(file.headers['content-disposition'] || '').startsWith('attachment'), 'the zip is a download, not an inline preview');
  const again = await req(server, 'GET', v1.url + '&download', { studio: false });
  check(again.status === 200 && again.body.equals(packed), 'Download zip returns the same file');
  check((await req(server, 'GET', `/${num}/file/v1`, { studio: false })).status === 404, 'the zip stays hidden without the client key');
  check((await req(server, 'GET', `/${num}/file/v1/zip?k=${encodeURIComponent(job.token)}`, { studio: false })).status === 404, 'a stored zip is not the generated image archive');
  const studioFile = await req(server, 'GET', `/${num}/file/v1`);
  check(studioFile.status === 200 && studioFile.body.equals(packed), 'staff can download the same zip');
  const logBefore = fs.existsSync(path.join(dataDir, 'notifications.log')) ? fs.readFileSync(path.join(dataDir, 'notifications.log'), 'utf8') : '';
  check(!logBefore.includes(`UPDATED — Job ${num}`), 'the first proof, including a zip, does not email');

  const client = await req(server, 'GET', `/api/review/${num}?k=${encodeURIComponent(job.token)}`, { studio: false });
  check(client.json.versions[0].kind === 'zip' && !client.json.versions[0].downloadAll, 'the client payload describes one zip');

  const marked = await req(server, 'POST', `/api/review/${num}/decision?k=${encodeURIComponent(job.token)}`, {
    studio: false,
    body: JSON.stringify({ type: 'changes', name: 'Sam', note: '', version: 1, attachments: [], stickies: [{ page: 1, x: 0.2, y: 0.3, text: 'Move this' }] })
  });
  check(marked.status === 400 && /no pages to mark/.test(marked.json.error), 'a zip cannot take notes on the artwork');
  const noted = await req(server, 'POST', `/api/review/${num}/decision?k=${encodeURIComponent(job.token)}`, {
    studio: false,
    body: JSON.stringify({ type: 'changes', name: 'Sam', note: 'Please swap page two', version: 1, attachments: [], stickies: [] })
  });
  check(noted.status === 200 && noted.json.status === 'changes_requested', 'a written change request still works');

  const form = formBody([{ name: 'Next pack.zip', body: packed }]);
  const viaForm = await req(server, 'POST', `/api/jobs/${job.id}/versions`, { headers: { 'Content-Type': form.type }, body: form.body });
  check(viaForm.status === 201 && viaForm.json.versions[1].kind === 'zip' && viaForm.json.versions[1].originalName === 'Next-pack.zip', 'a multipart zip is stored the same way');
  const v2file = await req(server, 'GET', viaForm.json.versions[1].url, { studio: false });
  check(v2file.body.equals(packed), 'the second zip is also the original bytes');
  const log = fs.readFileSync(path.join(dataDir, 'notifications.log'), 'utf8');
  check(!log.includes(`UPDATED — Job ${num}`), 'a new zip version does not notify staff');
  check(!log.includes('2-mid.png') && !log.includes('Next-pack.zip'), 'the notification log does not list the uploaded zip or the files inside it');

  const plain = await req(server, 'POST', `/api/jobs/${job.id}/versions?name=poster.jpg`, { headers: { 'Content-Type': 'image/jpeg' }, body: JPG });
  check(plain.status === 201 && plain.json.versions[2].kind === 'image' && plain.json.versions[2].originalName === 'poster.jpg' && !plain.json.versions[2].downloadAll, 'a raw JPG upload is unchanged');
  check((await req(server, 'GET', plain.json.versions[2].url, { studio: false })).body.equals(JPG), 'the raw JPG bytes are unchanged');
  const pdf = await req(server, 'POST', `/api/jobs/${job.id}/versions?name=board.pdf`, { headers: { 'Content-Type': 'application/pdf' }, body: PDF });
  check(pdf.status === 201 && pdf.json.versions[3].kind === 'pdf' && !pdf.json.versions[3].downloadAll, 'a raw PDF upload is unchanged');
  const pair = formBody([{ name: 'front.png', body: PNG }, { name: 'detail.jpg', body: JPG }]);
  const multi = await req(server, 'POST', `/api/jobs/${job.id}/versions`, { headers: { 'Content-Type': pair.type }, body: pair.body });
  check(multi.status === 201 && multi.json.versions[4].kind === 'image' && multi.json.versions[4].files.map(f => f.name).join(',') === 'front.png,detail.jpg' && multi.json.versions[4].downloadAll, 'several loose images still share one version and offer download all');
  const all = await req(server, 'GET', multi.json.versions[4].downloadAll, { studio: false });
  check(all.status === 200 && all.headers['content-type'] === 'application/zip' && all.body.includes(PNG) && all.body.includes(JPG), 'download all still packs the loose images');

  const bad = await req(server, 'POST', '/api/jobs', { body: JSON.stringify({ jobNumber: num + 'B', clientName: 'Bad', description: 'Rejects' }) });
  const mix = formBody([{ name: 'pages.zip', body: packed }, { name: 'extra.png', body: PNG }]);
  const mixed = await req(server, 'POST', `/api/jobs/${bad.json.id}/versions`, { headers: { 'Content-Type': mix.type }, body: mix.body });
  check(mixed.status === 400 && /ZIP is one file/.test(mixed.json.error), 'a zip is not mixed with other files');
  const two = formBody([{ name: 'a.zip', body: packed }, { name: 'b.zip', body: packed }]);
  check((await req(server, 'POST', `/api/jobs/${bad.json.id}/versions`, { headers: { 'Content-Type': two.type }, body: two.body })).status === 400, 'two zips are not one version');
  const exe = await req(server, 'POST', `/api/jobs/${bad.json.id}/versions?name=evil.exe`, { headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('MZ') });
  check(exe.status === 415, 'a non-proof file is still rejected');
  check((await req(server, 'GET', `/api/jobs/${bad.json.id}`)).json.versions.length === 0, 'rejected uploads do not create a version');
  const left = fs.readdirSync(path.join(dataDir, 'files', bad.json.id));
  check(!left.some(n => n.startsWith('incoming-') || n.startsWith('v')), 'rejected uploads do not leave files behind');

  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log('zip upload tests passed');
})().catch(e => { console.error(e); process.exit(1); });
