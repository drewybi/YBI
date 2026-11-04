'use strict';
// A .zip upload unpacks into the JPG/PNG pages of one proof version.
// Loose PDF, JPG and PNG uploads stay one-file (or one multipart set) versions.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
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

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeZip(entries) {
  const locals = [];
  const cds = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = e.data || Buffer.alloc(0);
    const method = e.method == null ? 0 : e.method;
    const flags = e.flags == null ? 0x0800 : e.flags;
    const payload = e.payload != null ? e.payload : (method === 8 ? zlib.deflateRawSync(data) : data);
    const crc = e.crc == null ? crc32(data) : e.crc;
    const compSize = e.compSize == null ? payload.length : e.compSize;
    const uncompSize = e.uncompSize == null ? data.length : e.uncompSize;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(e.zeroLocal ? 0 : (crc >>> 0), 14);
    local.writeUInt32LE(e.zeroLocal ? 0 : (compSize >>> 0), 18);
    local.writeUInt32LE(e.zeroLocal ? 0 : (uncompSize >>> 0), 22);
    local.writeUInt16LE(name.length, 26);
    const bytes = payload.subarray(0, Math.min(payload.length, compSize));
    const localRec = Buffer.concat([local, name, bytes]);
    locals.push(localRec);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(e.versionMadeBy == null ? 0x0314 : e.versionMadeBy, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(flags, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc >>> 0, 16);
    cd.writeUInt32LE(compSize >>> 0, 20);
    cd.writeUInt32LE(uncompSize >>> 0, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE((e.externalAttrs == null ? 0 : e.externalAttrs) >>> 0, 38);
    cd.writeUInt32LE(offset, 42);
    cds.push(Buffer.concat([cd, name]));
    offset += localRec.length;
  }
  const cdBuf = Buffer.concat(cds);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cdBuf, eocd]);
}

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

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function fileNames(jobId) {
  const dir = path.join(dataDir, 'files', jobId);
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

(async () => {
  const studioJs = fs.readFileSync(path.join(__dirname, '../public/assets/studio.js'), 'utf8');
  const studioHtml = fs.readFileSync(path.join(__dirname, '../public/studio.html'), 'utf8');
  assert.ok(studioJs.includes('.pdf,.jpg,.jpeg,.png,.zip,'), 'version upload lists .zip');
  assert.ok(studioHtml.includes('accept=".pdf,.jpg,.jpeg,.png,.zip,'), 'new-job file input accepts .zip');
  assert.ok(studioJs.includes('or a ZIP'), 'version drop copy mentions a ZIP');
  assert.ok(studioHtml.includes('or a ZIP'), 'new-job copy mentions a ZIP');
  assert.ok(!studioJs.includes('PLACEHOLDER'), 'studio copy placeholder is gone');

  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const fail = m => { console.error('  ✗ ' + m); server.close(); process.exit(1); };
  const check = (cond, m) => { if (!cond) fail(m); console.log('  ✓ ' + m); };

  const num = 'Z' + Date.now().toString(36);
  const created = await req(server, 'POST', '/api/jobs', { body: JSON.stringify({ jobNumber: num, clientName: 'Sam Client', description: 'Zipped pages' }) });
  check(created.status === 201, 'job created');
  const job = created.json;

  const packed = pythonZip([
    { name: '10-back.jpg', data: JPG },
    { name: '2-mid.png', data: PNG },
    { name: '__MACOSX/._2-mid.png', data: Buffer.from('AppleDouble') },
    { name: '.DS_Store', data: Buffer.from('ds') },
    { name: 'notes.txt', data: Buffer.from('ignore me') },
    { name: 'nested/again.zip', data: Buffer.from('PK') }
  ]);
  const up = await req(server, 'POST', `/api/jobs/${job.id}/versions?name=${encodeURIComponent('Pages.zip')}&note=${encodeURIComponent('From the zip')}`, {
    headers: { 'Content-Type': 'application/zip' }, body: packed
  });
  check(up.status === 201, 'a zip upload creates a version');
  check(up.json.versions.length === 1 && up.json.versions[0].kind === 'image', 'the zip becomes one image version');
  check(up.json.versions[0].files.length === 2, 'only the two real images become pages');
  check(up.json.versions[0].files[0].name === '2-mid.png' && up.json.versions[0].files[1].name === '10-back.jpg', 'pages follow numeric file name order, not zip order');
  check(up.json.versions[0].originalName === '2-mid.png', 'originalName stays the first page');
  check(up.json.versions[0].size === PNG.length + JPG.length, 'version size is the unpacked images');
  check(up.json.versions[0].studioNote === 'From the zip', 'studio note is kept');
  check(typeof up.json.versions[0].downloadAll === 'string' && up.json.versions[0].downloadAll.endsWith('/file/v1/zip?k=' + encodeURIComponent(job.token)), 'download all still points at the version zip');
  const storedNames = fileNames(job.id);
  check(storedNames.length === 2 && storedNames.every(n => n.startsWith('v1-')) && !storedNames.some(n => n.endsWith('.zip')), 'the zip is unpacked and not kept as the proof');

  const page1 = await req(server, 'GET', up.json.versions[0].files[0].url, { studio: false });
  const page2 = await req(server, 'GET', up.json.versions[0].files[1].url, { studio: false });
  check(page1.status === 200 && page1.headers['content-type'] === 'image/png' && page1.body.equals(PNG), 'page 1 is the earlier image');
  check(page2.status === 200 && page2.headers['content-type'] === 'image/jpeg' && page2.body.equals(JPG), 'page 2 is the later image');
  const zip = await req(server, 'GET', `/${num}/file/v1/zip?k=${encodeURIComponent(job.token)}`, { studio: false });
  check(zip.status === 200 && zip.headers['content-type'] === 'application/zip', 'client download-all zip still downloads');
  const zipped = readZip(zip.body);
  check(zipped.map(f => f.name).join(',') === '2-mid.png,10-back.jpg', 'download-all lists the pages, not the junk from the upload');
  check(zipped[0].data.equals(PNG) && zipped[1].data.equals(JPG), 'download-all bytes are the unpacked images');
  check((await req(server, 'GET', `/${num}/file/v1/zip`, { studio: false })).status === 404, 'download-all without the client key stays hidden');

  const logBefore = fs.existsSync(path.join(dataDir, 'notifications.log')) ? fs.readFileSync(path.join(dataDir, 'notifications.log'), 'utf8') : '';
  check(!logBefore.includes(`UPDATED — Job ${num}`), 'the first proof, even from a zip, does not email');

  const folders = makeZip([
    { name: 'b/page.jpg', data: JPG, method: 8 },
    { name: 'a/page.jpg', data: PNG, method: 0 },
    { name: 'link.jpg', data: Buffer.from('../outside'), externalAttrs: 0o120000 << 16 },
    { name: '../secret.jpg', data: JPG },
    { name: '/tmp/abs.png', data: PNG },
    { name: 'shots\\extra.jpeg', data: JPG }
  ]);
  const v2 = await req(server, 'POST', `/api/jobs/${job.id}/versions?name=Folders.zip`, {
    headers: { 'Content-Type': 'application/zip' }, body: folders
  });
  check(v2.status === 201 && v2.json.versions.length === 2, 'a later zip is the next version');
  const pages = v2.json.versions[1].files;
  check(pages.map(f => f.name).join(',') === 'page.jpg,page-2.jpg,extra.jpeg', 'folder paths sort in order and duplicate names are kept apart');
  const b1 = await req(server, 'GET', pages[0].url, { studio: false });
  const b2 = await req(server, 'GET', pages[1].url, { studio: false });
  const b3 = await req(server, 'GET', pages[2].url, { studio: false });
  check(b1.body.equals(PNG) && b2.body.equals(JPG) && b3.body.equals(JPG), 'each unpacked page keeps its own bytes');
  check(!walk(dataDir).some(p => /secret\.jpg|abs\.png|link\.jpg/.test(path.basename(p))), 'skipped zip entries are not saved as proof files');
  const log = fs.readFileSync(path.join(dataDir, 'notifications.log'), 'utf8');
  check(log.includes(`UPDATED — Job ${num} (V2)`) && log.includes('Files (3): page.jpg, page-2.jpg, extra.jpeg'), 'a new zip version notifies with the page names');
  check(!log.includes('Folders.zip'), 'the notification does not name the zip');

  const one = makeZip([{ name: 'only.png', data: PNG, zeroLocal: true, flags: 0x0808 }]);
  const singleJob = await req(server, 'POST', '/api/jobs', { body: JSON.stringify({ jobNumber: num + 'S', clientName: 'Single', description: 'One image in a zip' }) });
  const oneUp = await req(server, 'POST', `/api/jobs/${singleJob.json.id}/versions?name=only.zip`, {
    headers: { 'Content-Type': 'application/zip' }, body: one
  });
  check(oneUp.status === 201 && oneUp.json.versions[0].files.length === 1 && !oneUp.json.versions[0].downloadAll, 'a zip with one image stays a normal single page');
  check(!Object.prototype.hasOwnProperty.call(JSON.parse(fs.readFileSync(path.join(dataDir, 'jobs', singleJob.json.id + '.json'), 'utf8')).versions[0], 'files'), 'a one-image zip does not add files[] on disk');
  check((await req(server, 'GET', oneUp.json.versions[0].url, { studio: false })).body.equals(PNG), 'that single page is the image from the zip');
  check((await req(server, 'GET', `/${num}S/file/v1/zip?k=${singleJob.json.token}`, { studio: false })).status === 404, 'a single image still has no download-all zip');

  const form = formBody([{ name: 'multi.zip', body: pythonZip([{ name: '1-front.png', data: PNG }, { name: '2-back.jpg', data: JPG }]) }]);
  const viaForm = await req(server, 'POST', `/api/jobs/${singleJob.json.id}/versions`, { headers: { 'Content-Type': form.type }, body: form.body });
  check(viaForm.status === 201 && viaForm.json.versions[1].files.map(f => f.name).join(',') === '1-front.png,2-back.jpg', 'a multipart zip unpacks the same way');

  const plain = await req(server, 'POST', `/api/jobs/${singleJob.json.id}/versions?name=poster.jpg`, { headers: { 'Content-Type': 'image/jpeg' }, body: JPG });
  check(plain.status === 201 && plain.json.versions[2].originalName === 'poster.jpg' && plain.json.versions[2].kind === 'image', 'a raw JPG upload is unchanged');
  check((await req(server, 'GET', plain.json.versions[2].url, { studio: false })).body.equals(JPG), 'the raw JPG bytes are unchanged');
  const pdf = await req(server, 'POST', `/api/jobs/${singleJob.json.id}/versions?name=board.pdf`, { headers: { 'Content-Type': 'application/pdf' }, body: PDF });
  check(pdf.status === 201 && pdf.json.versions[3].kind === 'pdf' && !pdf.json.versions[3].downloadAll, 'a raw PDF upload is unchanged');
  const pair = formBody([{ name: 'front.png', body: PNG }, { name: 'detail.jpg', body: JPG }]);
  const multi = await req(server, 'POST', `/api/jobs/${job.id}/versions`, { headers: { 'Content-Type': pair.type }, body: pair.body });
  check(multi.status === 201 && multi.json.versions[2].files.map(f => f.name).join(',') === 'front.png,detail.jpg' && multi.json.versions[2].downloadAll, 'several loose images still share one version and offer download all');

  async function rejected(jobId, name, body, status, pattern, label) {
    const res = await req(server, 'POST', `/api/jobs/${jobId}/versions?name=${encodeURIComponent(name)}`, {
      headers: { 'Content-Type': 'application/zip' }, body
    });
    check(res.status === status && pattern.test(res.json.error), label);
    return res;
  }
  const bad = await req(server, 'POST', '/api/jobs', { body: JSON.stringify({ jobNumber: num + 'B', clientName: 'Bad', description: 'Rejects' }) });
  const badId = bad.json.id;
  await rejected(badId, 'empty.zip', makeZip([]), 400, /no JPG or PNG/, 'an empty zip is refused');
  await rejected(badId, 'junk.zip', makeZip([
    { name: '__MACOSX/._x.jpg', data: Buffer.from('apple') },
    { name: '.DS_Store', data: Buffer.from('ds') },
    { name: 'readme.txt', data: Buffer.from('hi') }
  ]), 400, /no JPG or PNG/, 'a zip with no images is refused');
  await rejected(badId, 'only.pdf.zip', makeZip([{ name: 'board.pdf', data: PDF }]), 400, /PDF on its own/, 'a zip that only holds a PDF is refused');
  await rejected(badId, 'not.zip', Buffer.from('this is not a zip file at all!!'), 400, /could not be read/, 'a file that is not a zip is refused');
  await rejected(badId, 'locked.zip', makeZip([{ name: 'a.jpg', data: JPG, flags: 0x0801 }]), 400, /password-protected/, 'a password-protected zip is refused');
  await rejected(badId, 'odd.zip', makeZip([{ name: 'a.jpg', data: JPG, method: 12, payload: JPG }]), 400, /compression/, 'an unsupported compression is refused');
  await rejected(badId, 'huge.zip', makeZip([{ name: 'big.jpg', data: Buffer.alloc(0), method: 8, payload: Buffer.alloc(10), compSize: 10, uncompSize: 301 * 1024 * 1024, crc: 0 }]), 413, /300 MB/, 'a zip that claims more than 300 MB is refused');
  await rejected(badId, 'bomb.zip', makeZip([{ name: 'big.jpg', data: Buffer.alloc(0), method: 8, payload: Buffer.alloc(100), compSize: 100, uncompSize: 2 * 1024 * 1024, crc: 0 }]), 400, /too heavily compressed/, 'a highly compressed entry is refused before it is expanded');
  const inflated = zlib.deflateRawSync(Buffer.alloc(100000, 7));
  await rejected(badId, 'lie.zip', makeZip([{ name: 'lie.jpg', data: Buffer.alloc(0), method: 8, payload: inflated, compSize: inflated.length, uncompSize: 10, crc: 0 }]), 400, /could not be read/, 'an entry that inflates past its declared size is refused');
  await rejected(badId, 'badcrc.zip', makeZip([{ name: 'a.png', data: PNG, crc: 1 }]), 400, /could not be read/, 'a zip entry with a bad checksum is refused');
  await rejected(badId, 'many.zip', makeZip(Array.from({ length: 41 }, (_, i) => ({ name: `p${i}.png`, data: Buffer.from([i]) }))), 400, /40 images/, 'more than 40 images in a zip is refused');
  await rejected(badId, 'toomany.zip', makeZip(Array.from({ length: 501 }, (_, i) => ({ name: `n${i}.txt`, data: Buffer.from('x') }))), 400, /too many files/, 'a zip with too many entries is refused');
  const mix = formBody([{ name: 'pages.zip', body: one }, { name: 'extra.png', body: PNG }]);
  const mixed = await req(server, 'POST', `/api/jobs/${badId}/versions`, { headers: { 'Content-Type': mix.type }, body: mix.body });
  check(mixed.status === 400 && /ZIP is one upload/.test(mixed.json.error), 'a zip is not mixed with other files');
  const two = formBody([{ name: 'a.zip', body: one }, { name: 'b.zip', body: one }]);
  check((await req(server, 'POST', `/api/jobs/${badId}/versions`, { headers: { 'Content-Type': two.type }, body: two.body })).status === 400, 'two zips are not one version');
  check((await req(server, 'GET', `/api/jobs/${badId}`)).json.versions.length === 0, 'rejected zips do not create a version');
  check(!fileNames(badId).some(n => n.startsWith('incoming-') || n.startsWith('v')), 'rejected zips do not leave files behind');
  const exe = await req(server, 'POST', `/api/jobs/${badId}/versions?name=evil.exe`, { headers: { 'Content-Type': 'application/octet-stream' }, body: Buffer.from('MZ') });
  check(exe.status === 415, 'a non-proof file is still rejected');

  server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log('zip upload tests passed');
})().catch(e => { console.error(e); process.exit(1); });
