// YBI Creative — Artwork Approval / Proofing app
// Zero-dependency Node server (Node 18+). Optional: `npm install` adds nodemailer for email alerts.
'use strict';
const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { buildChangesPdf } = require('./changes-pdf');

const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const JOBS = path.join(DATA, 'jobs');
const FILES = path.join(DATA, 'files');
const PORT = +process.env.PORT || 4321;
const HOST = process.env.HOST || '0.0.0.0';
const STUDIO_PASSWORD = process.env.STUDIO_PASSWORD || 'ybi-proof';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, ''); // origin only, e.g. https://www.ybicreative.com.au
// Path prefix the app is mounted at (default /proof). Use BASE_PATH= (empty) to mount at the root.
const B = ('BASE_PATH' in process.env ? process.env.BASE_PATH : '/proof').replace(/\/+$/, '').replace(/^(?=[^/])/, '/');
// Client access is always the secure ?k= link. A job number alone never opens a proof, even if a stored job says "public" or DEFAULT_ACCESS is set.
const DEFAULT_ACCESS = 'private';
const RESERVED = new Set(['studio', 'api', 'assets', 'vendor', 'f', 'p', 'settings', 'calendar', 'quote', 'login', 'logout', 'favicon.ico', 'robots.txt']);
const JOBNUM_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const norm = s => String(s || '').trim().toLowerCase();
const MAX_PROOF = 300 * 1024 * 1024, MAX_ATT = 100 * 1024 * 1024;
const MAX_VERSION_FILES = 40;

for (const d of [DATA, JOBS, FILES]) fs.mkdirSync(d, { recursive: true });
const SECRET_FILE = path.join(DATA, 'secret.key');
if (!fs.existsSync(SECRET_FILE)) fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString('hex'));
const SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
const SESSION = crypto.createHmac('sha256', SECRET).update('studio:' + STUDIO_PASSWORD).digest('hex');
const SETTINGS_FILE = path.join(DATA, 'settings.json');
const LOG_FILE = path.join(DATA, 'notifications.log');

// ---------- helpers ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.zip': 'application/zip', '.ai': 'application/postscript', '.eps': 'application/postscript' };
const PROOF_TYPES = { '.pdf': 'pdf', '.jpg': 'image', '.jpeg': 'image', '.png': 'image' };
const id = (n = 6) => crypto.randomBytes(n).toString('hex');
const token = () => crypto.randomBytes(18).toString('base64url');
const now = () => new Date().toISOString();
const safeName = s => (String(s || 'file').normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').replace(/^\.+/, '').slice(0, 120) || 'file');
const extOf = n => path.extname(n || '').toLowerCase();

function send(res, code, body, headers = {}) {
  const isObj = body && typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, { 'Content-Type': isObj ? 'application/json' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}
const err = (res, code, msg) => send(res, code, { error: msg });

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(Object.assign(new Error('Too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJSON(req) { const b = await readBody(req); try { return JSON.parse(b.toString() || '{}'); } catch { throw Object.assign(new Error('Bad JSON'), { code: 400 }); } }

function streamToFile(req, dest, limit) {
  return new Promise((resolve, reject) => {
    let n = 0; const out = fs.createWriteStream(dest);
    req.on('data', c => { n += c.length; if (n > limit) { req.unpipe(out); out.destroy(); fs.rm(dest, () => {}); reject(Object.assign(new Error('File too large'), { code: 413 })); req.destroy(); } });
    req.pipe(out);
    out.on('finish', () => resolve(n));
    out.on('error', reject); req.on('error', reject);
  });
}
const httpError = (code, msg) => Object.assign(new Error(msg), { code });

// Old versions are one file: { originalName, stored, kind, size }. A JPG/PNG set
// keeps those fields for the first image and adds files[] for the whole version.
function versionPages(v) {
  if (v && Array.isArray(v.files) && v.files.length) {
    return v.files.filter(f => f && typeof f.stored === 'string' && f.stored).map(f => ({
      originalName: f.originalName || v.originalName || 'image',
      stored: f.stored,
      size: Number(f.size) || 0
    }));
  }
  if (v && typeof v.stored === 'string' && v.stored) return [{ originalName: v.originalName || 'file', stored: v.stored, size: Number(v.size) || 0 }];
  return [];
}
function versionFileLine(v) {
  const pages = versionPages(v);
  if (pages.length <= 1) return `File: ${v.originalName}`;
  return `Files (${pages.length}): ${pages.map(f => f.originalName).join(', ')}`;
}
function checkProofSet(files) {
  if (!files.length) return { error: 'Choose a PDF, or one or more JPG or PNG files.', status: 400 };
  if (files.length > MAX_VERSION_FILES) return { error: `A version can include up to ${MAX_VERSION_FILES} images.`, status: 400 };
  const kinds = files.map(f => PROOF_TYPES[extOf(f.originalName)] || null);
  if (kinds.some(k => !k)) return { error: 'Proofs must be PDF, JPG or PNG.', status: 415 };
  if (kinds.some(k => k === 'pdf') && files.length > 1) return { error: 'A PDF is one file per version. Upload it on its own, or upload JPG and PNG files together.', status: 400 };
  const total = files.reduce((s, f) => s + (Number(f.size) || 0), 0);
  if (files.some(f => f.size > MAX_PROOF) || total > MAX_PROOF) return { error: 'A version can be up to 300 MB.', status: 413 };
  return { kind: kinds[0] };
}
function filenameFromHeaders(headerText) {
  const cd = headerText.split(/\r\n/).find(l => /^content-disposition:/i.test(l)) || '';
  const star = /filename\*\s*=\s*UTF-8''([^;\r\n]+)/i.exec(cd);
  if (star) { try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')); } catch { /* quoted filename */ } }
  const quoted = /filename\s*=\s*"((?:\\.|[^"\\])*)"/i.exec(cd);
  if (quoted) return quoted[1].replace(/\\"/g, '"');
  const plain = /filename\s*=\s*([^;\r\n]+)/i.exec(cd);
  return plain ? plain[1].trim().replace(/^"|"$/g, '') : '';
}
// One request, several files, streamed to disk. Parts without a filename are ignored.
function readMultipartFiles(req, destDir, { maxFiles, maxEach, maxTotal }) {
  const bm = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(String(req.headers['content-type'] || ''));
  const boundary = bm && (bm[1] || bm[2] || '').trim();
  if (!boundary || boundary.length > 200) return Promise.reject(httpError(400, 'Upload was not a valid form.'));
  const opener = Buffer.from('--' + boundary);
  const delim = Buffer.from('\r\n--' + boundary);
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0), mode = 'seek', current = null, out = null, fileBytes = 0, total = 0, received = 0, paused = false, settled = false, ended = false;
    const files = [];
    const drop = async () => {
      const paths = files.map(f => f.storedPath);
      if (current) paths.push(current.storedPath);
      await Promise.all(paths.map(p => fsp.rm(p, { force: true })));
    };
    const fail = err => {
      if (settled) return;
      settled = true;
      if (out) out.destroy();
      try { req.destroy(); } catch { /* already closed */ }
      drop().then(() => reject(err.code ? err : httpError(400, err.message || 'Upload failed')), () => reject(err));
    };
    const finish = () => { if (settled) return; settled = true; req.resume(); resolve(files); };
    const writeChunk = chunk => {
      if (!chunk.length || !out) return;
      fileBytes += chunk.length; total += chunk.length;
      if (fileBytes > maxEach || total > maxTotal) throw httpError(413, 'A version can be up to 300 MB.');
      if (!out.write(Buffer.from(chunk)) && !paused) {
        paused = true; req.pause();
        out.once('drain', () => { paused = false; if (!settled) req.resume(); });
      }
    };
    const openFile = name => {
      if (files.length >= maxFiles) throw httpError(400, `A version can include up to ${maxFiles} images.`);
      const originalName = safeName(name);
      const storedPath = path.join(destDir, `incoming-${id(6)}${extOf(originalName)}`);
      current = { originalName, storedPath };
      fileBytes = 0;
      out = fs.createWriteStream(storedPath);
      out.on('error', fail);
    };
    const closeFile = () => {
      const stream = out, rec = current;
      out = null; current = null; mode = 'closing';
      rec.size = fileBytes;
      files.push(rec);
      req.pause();
      stream.end(() => {
        if (settled) return;
        mode = 'after';
        req.resume();
        process();
        // 'end' can arrive while the file is still flushing. Fail only once that file is closed and nothing finished the form.
        if (!settled && ended && mode !== 'closing') fail(httpError(400, 'Upload ended early.'));
      });
    };
    function process() {
      try {
        while (!settled && mode !== 'closing') {
          if (mode === 'seek') {
            const i = buf.indexOf(opener);
            if (i < 0) { if (buf.length > opener.length) buf = buf.subarray(buf.length - opener.length + 1); return; }
            buf = buf.subarray(i + opener.length); mode = 'after';
          }
          if (mode === 'after') {
            if (buf.length < 2) return;
            if (buf[0] === 45 && buf[1] === 45) return finish();
            if (buf[0] !== 13 || buf[1] !== 10) throw httpError(400, 'Upload was not a valid form.');
            buf = buf.subarray(2); mode = 'headers';
          }
          if (mode === 'headers') {
            const end = buf.indexOf('\r\n\r\n');
            if (end < 0) { if (buf.length > 16384) throw httpError(400, 'Upload was not a valid form.'); return; }
            const filename = filenameFromHeaders(buf.subarray(0, end).toString('utf8'));
            buf = buf.subarray(end + 4);
            if (filename) { openFile(filename); mode = 'body'; }
            else mode = 'skip';
          }
          if (mode === 'body' || mode === 'skip') {
            const i = buf.indexOf(delim);
            if (i < 0) {
              const keep = delim.length - 1;
              if (buf.length > keep) {
                const chunk = buf.subarray(0, buf.length - keep);
                buf = buf.subarray(buf.length - keep);
                if (mode === 'body') writeChunk(chunk);
              }
              return;
            }
            if (mode === 'body') writeChunk(buf.subarray(0, i));
            buf = buf.subarray(i + delim.length);
            if (mode === 'body') return closeFile();
            mode = 'after';
          }
        }
      } catch (e) { fail(e); }
    }
    req.on('data', c => {
      if (settled) return;
      received += c.length;
      if (received > maxTotal + 1024 * 1024) return fail(httpError(413, 'A version can be up to 300 MB.'));
      buf = Buffer.concat([buf, c]);
      if (mode !== 'closing') process();
    });
    req.on('end', () => { ended = true; if (!settled && mode !== 'closing') fail(httpError(400, 'Upload ended early.')); });
    req.on('error', fail);
    req.on('aborted', () => fail(httpError(400, 'Upload ended early.')));
  });
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf, seed = 0) {
  let c = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < buf.length; i++) c = (CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}
function zipEntryName(name, used) {
  let base = safeName(name).replace(/[\\/]/g, '') || 'image';
  const ext = extOf(base) || extOf(name);
  if (ext && !base.toLowerCase().endsWith(ext)) base += ext;
  const stem = ext && base.toLowerCase().endsWith(ext) ? base.slice(0, -ext.length) : base;
  let n = base, i = 2;
  while (used.has(n.toLowerCase())) { n = `${stem}-${i}${ext}`; i++; }
  used.add(n.toLowerCase());
  return n;
}
function crcFile(filePath) {
  return new Promise((resolve, reject) => {
    let c = 0, size = 0;
    const rs = fs.createReadStream(filePath);
    rs.on('data', chunk => { c = crc32(chunk, c); size += chunk.length; });
    rs.on('end', () => resolve({ crc: c, size }));
    rs.on('error', reject);
  });
}
function writeOut(res, buf) {
  return new Promise((resolve, reject) => {
    res.write(buf, err => err ? reject(err) : resolve());
  });
}
function pipeFile(res, filePath) {
  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(filePath);
    const done = err => { rs.removeListener('error', done); res.removeListener('error', done); err ? reject(err) : resolve(); };
    rs.on('error', done); res.on('error', done);
    rs.on('end', () => done());
    rs.pipe(res, { end: false });
  });
}
async function sendZip(req, res, filename, entries) {
  const used = new Set();
  const d = new Date();
  const dosTime = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() >> 1) & 31);
  const dosDate = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  const files = [];
  for (const e of entries) {
    const name = Buffer.from(zipEntryName(e.name, used), 'utf8');
    const meta = req.method === 'HEAD' ? { crc: 0, size: (await fsp.stat(e.filePath)).size } : await crcFile(e.filePath);
    files.push({ name, filePath: e.filePath, crc: meta.crc >>> 0, size: meta.size });
  }
  let total = 22;
  for (const f of files) total += 30 + f.name.length + f.size + 46 + f.name.length;
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${String(filename).replace(/"/g, '')}"`,
    'Content-Length': total,
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff'
  });
  if (req.method === 'HEAD') return res.end();
  const locals = [];
  let offset = 0;
  for (const f of files) {
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(f.crc, 14);
    local.writeUInt32LE(f.size, 18);
    local.writeUInt32LE(f.size, 22);
    local.writeUInt16LE(f.name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(offset);
    await writeOut(res, local);
    await writeOut(res, f.name);
    await pipeFile(res, f.filePath);
    offset += 30 + f.name.length + f.size;
  }
  const cdStart = offset;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(dosTime, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(f.crc, 16);
    cd.writeUInt32LE(f.size, 20);
    cd.writeUInt32LE(f.size, 24);
    cd.writeUInt16LE(f.name.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(locals[i], 42);
    await writeOut(res, cd);
    await writeOut(res, f.name);
    offset += 46 + f.name.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(offset - cdStart, 12);
  eocd.writeUInt32LE(cdStart, 16);
  res.end(eocd);
}
async function addUploadedVersion(req, res, job, note, incoming) {
  const check = checkProofSet(incoming);
  if (check.error) {
    await Promise.all(incoming.map(f => fsp.rm(f.storedPath, { force: true })));
    return err(res, check.status, check.error);
  }
  const fresh = await loadJob(job.id);
  if (!fresh) {
    await Promise.all(incoming.map(f => fsp.rm(f.storedPath, { force: true })));
    return err(res, 404, 'No job with that number.');
  }
  const n = (fresh.versions.length ? fresh.versions[fresh.versions.length - 1].n : 0) + 1;
  const dir = path.join(FILES, fresh.id);
  const committed = [];
  const version = { n, kind: check.kind, originalName: incoming[0].originalName, stored: '', size: 0, uploadedAt: now(), studioNote: note, feedback: [] };
  try {
    for (const f of incoming) {
      const stored = `v${n}-${id(4)}${extOf(f.originalName)}`;
      const dest = path.join(dir, stored);
      await fsp.rename(f.storedPath, dest);
      committed.push({ originalName: f.originalName, stored, size: f.size, dest });
    }
    version.originalName = committed[0].originalName;
    version.stored = committed[0].stored;
    version.size = committed.reduce((s, f) => s + f.size, 0);
    if (committed.length > 1) version.files = committed.map(f => ({ originalName: f.originalName, stored: f.stored, size: f.size }));
    fresh.versions.push(version);
    await saveJob(fresh);
  } catch (e) {
    await Promise.all(incoming.map(f => fsp.rm(f.storedPath, { force: true })));
    await Promise.all(committed.map(f => fsp.rm(f.dest, { force: true })));
    throw e;
  }
  if (fresh.versions.length > 1) await notifyVersionUploaded(req, fresh, version);
  return send(res, 201, studioJob(req, fresh));
}

// ---------- storage ----------
const jobPath = jid => path.join(JOBS, jid + '.json');
async function loadJob(jid) { if (!/^[a-f0-9]{12}$/.test(jid)) return null; try { return JSON.parse(await fsp.readFile(jobPath(jid), 'utf8')); } catch { return null; } }
async function saveJob(job) { job.access = 'private'; job.updatedAt = now(); const t = jobPath(job.id) + '.tmp'; await fsp.writeFile(t, JSON.stringify(job, null, 2)); await fsp.rename(t, jobPath(job.id)); }
async function allJobs() { const fsn = (await fsp.readdir(JOBS)).filter(f => f.endsWith('.json')); const jobs = (await Promise.all(fsn.map(f => loadJob(f.slice(0, -5))))).filter(Boolean); await Promise.all(jobs.map(ensurePrivate)); return jobs; }
async function jobByToken(tok) { if (!tok || tok.length < 10) return null; return (await allJobs()).find(j => j.token === tok) || null; }
async function jobByNumber(num) { const n = norm(num); if (!n) return null; return (await allJobs()).find(j => norm(j.jobNumber) === n) || null; }
const accessOf = () => 'private';
const canView = (job, k) => !!(job && k && k === job.token);
// Existing jobs may still say access:"public" on disk. Treat them as private and rewrite that flag without bumping updatedAt.
async function ensurePrivate(job) {
  if (!job || job.access === 'private') return job;
  job.access = 'private';
  const t = jobPath(job.id) + '.tmp';
  await fsp.writeFile(t, JSON.stringify(job, null, 2));
  await fsp.rename(t, jobPath(job.id));
  return job;
}
// light brute-force guard for guessable job-number URLs: max 40 misses / 10 min per IP
const misses = new Map();
function tooManyMisses(req) { const ip = req.socket.remoteAddress, t = Date.now(); const a = (misses.get(ip) || []).filter(x => t - x < 600000); misses.set(ip, a); return a.length >= 40; }
function miss(req) { const ip = req.socket.remoteAddress; (misses.get(ip) || misses.set(ip, []).get(ip)).push(Date.now()); }
// null means the payload was rejected (empty text, bad position, or too many).
function cleanStickies(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > 40) return null;
  const out = [];
  for (const s of raw) {
    const x = Number(s && s.x), y = Number(s && s.y), page = Math.round(Number(s && s.page) || 1);
    const text = String((s && s.text) || '').trim().slice(0, 2000);
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1 || page < 1 || page > 500 || !text) return null;
    out.push({ n: out.length + 1, page, x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000, text });
  }
  return out;
}
function status(job) {
  const v = job.versions[job.versions.length - 1];
  if (!v) return 'draft';
  const d = [...v.feedback].reverse().find(f => f.type === 'approve' || f.type === 'changes');
  return d ? (d.type === 'approve' ? 'approved' : 'changes_requested') : 'awaiting_review';
}
// Drop the unread dot once nothing newer than the last studio visit remains.
function syncUnread(job) {
  let latest = '';
  for (const v of job.versions || []) for (const f of v.feedback || []) if (f && f.at > latest) latest = f.at;
  if (!latest || (job.seenAt && latest <= job.seenAt)) job.unread = false;
}
async function removeVersionFiles(job, version) {
  const root = path.resolve(FILES, job.id);
  const rels = [];
  if (version && version.stored) rels.push(version.stored);
  for (const f of versionPages(version)) rels.push(f.stored);
  for (const f of (version && version.feedback) || []) for (const a of f.attachments || []) rels.push(a && a.stored);
  const seen = new Set();
  for (const rel of rels) {
    if (!rel || typeof rel !== 'string' || seen.has(rel)) continue;
    seen.add(rel);
    const file = path.resolve(root, rel);
    if (file !== root && file.startsWith(root + path.sep)) await fsp.rm(file, { force: true });
  }
}
// Staff alerts. Studio Settings (or NOTIFY_EMAIL) overrides this. Commas or semicolons.
const DEFAULT_NOTIFY_EMAILS = Object.freeze([
  'drew@ybicreative.com.au',
  'nicola@ybicreative.com.au',
  'rob@ybicreative.com.au',
]);
const DEFAULT_NOTIFY_EMAIL = DEFAULT_NOTIFY_EMAILS.join(', ');
const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

function parseNotifyAddresses(raw) {
  const seen = new Set();
  const out = [];
  for (const part of String(raw || '').split(/[,;]+/)) {
    const addr = part.trim();
    if (!EMAIL_RE.test(addr)) continue;
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(addr);
  }
  return out;
}

function fallbackNotifyEmail() {
  const env = String(process.env.NOTIFY_EMAIL || '').trim();
  if (parseNotifyAddresses(env).length) return env;
  return DEFAULT_NOTIFY_EMAIL;
}

async function readSettingsFile() {
  try {
    const s = JSON.parse(await fsp.readFile(SETTINGS_FILE, 'utf8'));
    if (!s || typeof s !== 'object' || Array.isArray(s)) return {};
    return s;
  } catch {
    return null;
  }
}

// Empty or missing settings use NOTIFY_EMAIL when that has at least one valid
// address, otherwise the three YBI addresses. A saved list replaces both.
async function loadSettings() {
  const s = await readSettingsFile();
  const saved = s ? String(s.notifyEmail || '').trim() : '';
  return { ...(s || {}), notifyEmail: saved || fallbackNotifyEmail() };
}

async function notifyRecipients() {
  const s = await readSettingsFile();
  const saved = s ? String(s.notifyEmail || '').trim() : '';
  const raw = saved || fallbackNotifyEmail();
  return { raw, list: parseNotifyAddresses(raw) };
}

// Staff calendar. start/end are Australia/Melbourne wall-clock strings, not UTC:
// all-day is YYYY-MM-DD, timed is YYYY-MM-DDTHH:mm. Stored in DATA_DIR/calendar-events.json
// as { events, jobOverrides }. Proof jobs are not copied into events: the list is derived
// from the job files, with per-job colour, calendarDate and dayOrder kept in jobOverrides.
// dayOrder is a whole number (lower first) for chips that share a calendar day.
const CAL_FILE = path.join(DATA, 'calendar-events.json');
const CAL_COLOURS = ['red', 'blue', 'green', 'yellow', 'purple', 'grey'];
const CAL_COLOUR_SET = new Set(CAL_COLOURS);
const COLOUR_ERR = 'Pick a colour: red, blue, green, yellow, purple or grey.';
const JOB_DUE_KEYS = ['dueAt', 'dueDate', 'deadline', 'due', 'calendarDate'];
let calChain = Promise.resolve();
function withCalendar(fn) {
  const run = calChain.then(fn, fn);
  calChain = run.then(() => {}, () => {});
  return run;
}
function normalColour(v) {
  const c = String(v ?? '').trim().toLowerCase();
  return CAL_COLOUR_SET.has(c) ? c : null;
}
function parseColourField(b) {
  const sent = b && (Object.prototype.hasOwnProperty.call(b, 'colour') || Object.prototype.hasOwnProperty.call(b, 'color'));
  if (!sent) return { sent: false };
  const raw = Object.prototype.hasOwnProperty.call(b, 'colour') ? b.colour : b.color;
  const colour = normalColour(raw);
  if (!colour) return { error: COLOUR_ERR };
  return { sent: true, colour };
}
function storedDayOrder(v) {
  return Number.isInteger(v) && v >= 0 && v <= 1000000 ? v : null;
}
function parseDayOrderField(b) {
  if (!b || !Object.prototype.hasOwnProperty.call(b, 'dayOrder')) return { sent: false };
  const raw = b.dayOrder;
  if (raw == null || raw === '') return { sent: true, dayOrder: null };
  const n = typeof raw === 'number' ? raw : (typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN);
  if (!Number.isInteger(n) || n < 0 || n > 1000000) return { error: 'Order must be a whole number from 0 up.' };
  return { sent: true, dayOrder: n };
}
function withDayOrder(ev) {
  const dayOrder = storedDayOrder(ev && ev.dayOrder);
  if (dayOrder == null) {
    if (!ev || !Object.prototype.hasOwnProperty.call(ev, 'dayOrder')) return ev;
    const copy = { ...ev };
    delete copy.dayOrder;
    return copy;
  }
  return ev.dayOrder === dayOrder ? ev : { ...ev, dayOrder };
}
function melbourneDay(input) {
  const dt = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(dt);
  const g = t => parts.find(p => p.type === t)?.value;
  const y = g('year'), m = g('month'), d = g('day');
  if (!y || !m || !d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
// A date-only value is that calendar day. A timestamp is the Australia/Melbourne day it falls on.
function dayFromValue(raw) {
  if (raw == null || raw === '') return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return validDate(s) ? s : null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const mel = melbourneDay(s);
    if (mel && validDate(mel)) return mel;
  }
  const mel = melbourneDay(s);
  return mel && validDate(mel) ? mel : null;
}
function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
  if (y < 2000 || y > 2100 || m < 1 || m > 12) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function validTime(s) {
  if (!/^\d{2}:\d{2}$/.test(s)) return false;
  return +s.slice(0, 2) <= 23 && +s.slice(3) <= 59;
}
function daySpan(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}
function cleanEventInput(b) {
  const title = String(b.title ?? '').trim().slice(0, 200);
  if (!title) return { error: 'Add a title.' };
  const notes = String(b.notes ?? '').trim().slice(0, 4000);
  const allDay = !!b.allDay;
  let start = String(b.start ?? '').trim();
  let end = b.end == null || String(b.end).trim() === '' ? null : String(b.end).trim();
  if (!start) return { error: 'Add a start date.' };
  if (allDay) {
    start = start.slice(0, 10);
    if (end) end = String(end).slice(0, 10);
    if (!validDate(start) || (end && !validDate(end))) return { error: 'That date isn’t valid.' };
  } else {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(start) || !validDate(start.slice(0, 10)) || !validTime(start.slice(11))) return { error: 'Add a start date and time, or mark it as all day.' };
    if (end && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(end) || !validDate(end.slice(0, 10)) || !validTime(end.slice(11)))) return { error: 'That end date isn’t valid.' };
  }
  if (end && end < start) return { error: 'End can’t be before the start.' };
  if (end && daySpan(start.slice(0, 10), end.slice(0, 10)) > 366) return { error: 'Events can’t run longer than a year.' };
  return { title, allDay, start, end, notes };
}
function publicEvent(ev) {
  const clean = withDayOrder(ev);
  return { id: clean.id, kind: 'event', title: clean.title, allDay: !!clean.allDay, start: clean.start, end: clean.end || null, notes: clean.notes || '', colour: normalColour(clean.colour) || 'grey', dayOrder: storedDayOrder(clean.dayOrder), createdAt: clean.createdAt, updatedAt: clean.updatedAt };
}
function eventInRange(ev, from, to) {
  const s = String(ev.start).slice(0, 10), e = String(ev.end || ev.start).slice(0, 10);
  if (to && s > to) return false;
  if (from && e < from) return false;
  return true;
}
function jobCalendarDay(job, override) {
  if (override && override.calendarDate) return override.calendarDate;
  for (const key of JOB_DUE_KEYS) {
    const day = dayFromValue(job[key]);
    if (day) return day;
  }
  return melbourneDay(job.createdAt) || melbourneDay(new Date());
}
// The month/week chip shows this string and nothing else — the New job description, not the job number or client.
function jobChipLabel(job) {
  return String(job.description || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}
function jobEvent(job, override) {
  const start = jobCalendarDay(job, override);
  return {
    id: `job-${job.id}`,
    kind: 'job',
    jobId: job.id,
    jobNumber: job.jobNumber,
    title: jobChipLabel(job),
    allDay: true,
    start,
    end: null,
    notes: '',
    colour: (override && normalColour(override.colour)) || 'grey',
    dayOrder: override ? storedDayOrder(override.dayOrder) : null,
    href: `${B}/studio/${encodeURIComponent(job.jobNumber)}`,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}
async function readCalendarDoc() {
  let raw;
  try { raw = await fsp.readFile(CAL_FILE, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return { events: [], jobOverrides: {} }; throw e; }
  let data;
  try { data = JSON.parse(raw); }
  catch { throw Object.assign(new Error('Calendar data could not be read'), { code: 500 }); }
  const list = Array.isArray(data) ? data : data && Array.isArray(data.events) ? data.events : null;
  if (!list) throw Object.assign(new Error('Calendar data could not be read'), { code: 500 });
  const events = list.filter(ev => ev && typeof ev.id === 'string' && /^[a-f0-9]{16}$/.test(ev.id));
  const jobOverrides = {};
  const src = !Array.isArray(data) && data && data.jobOverrides && typeof data.jobOverrides === 'object' && !Array.isArray(data.jobOverrides) ? data.jobOverrides : {};
  for (const [k, v] of Object.entries(src)) {
    if (!/^[a-f0-9]{12}$/.test(k) || !v || typeof v !== 'object' || Array.isArray(v)) continue;
    const entry = {};
    const colour = normalColour(v.colour);
    const calendarDate = dayFromValue(v.calendarDate != null ? v.calendarDate : v.date);
    const dayOrder = storedDayOrder(v.dayOrder);
    if (colour && colour !== 'grey') entry.colour = colour;
    if (calendarDate) entry.calendarDate = calendarDate;
    if (dayOrder != null) entry.dayOrder = dayOrder;
    if (entry.colour || entry.calendarDate || entry.dayOrder != null) jobOverrides[k] = entry;
  }
  return { events, jobOverrides };
}
async function writeCalendarDoc(doc) {
  const tmp = CAL_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify({ events: doc.events, jobOverrides: doc.jobOverrides || {} }, null, 2));
  await fsp.rename(tmp, CAL_FILE);
}
async function calendarEntries(from, to) {
  const doc = await readCalendarDoc();
  let events = doc.events.map(publicEvent);
  for (const job of await allJobs()) events.push(jobEvent(job, doc.jobOverrides[job.id]));
  if (from || to) events = events.filter(ev => eventInRange(ev, from, to));
  return events;
}
function compareCalEvents(a, b) {
  const ao = storedDayOrder(a.dayOrder), bo = storedDayOrder(b.dayOrder);
  if (ao != null && bo != null && ao !== bo) return ao - bo;
  if (ao != null && bo == null) return -1;
  if (ao == null && bo != null) return 1;
  if (!!a.allDay !== !!b.allDay) return a.allDay ? -1 : 1;
  return String(a.start).localeCompare(String(b.start)) || String(a.title).localeCompare(String(b.title)) || String(a.id).localeCompare(String(b.id));
}
function sortEvents(events) {
  return events.sort((a, b) => String(a.start).slice(0, 10).localeCompare(String(b.start).slice(0, 10)) || compareCalEvents(a, b));
}
function jobDateField(b) {
  if (Object.prototype.hasOwnProperty.call(b, 'date')) return b.date;
  if (Object.prototype.hasOwnProperty.call(b, 'calendarDate')) return b.calendarDate;
  if (Object.prototype.hasOwnProperty.call(b, 'start')) return b.start;
  return undefined;
}
async function forgetJobOverride(jobId) {
  try {
    await withCalendar(async () => {
      const doc = await readCalendarDoc();
      if (!doc.jobOverrides[jobId]) return;
      delete doc.jobOverrides[jobId];
      await writeCalendarDoc(doc);
    });
  } catch (e) { console.error('[calendar] could not drop the job override', e.message); }
}
function overrideEmpty(entry) {
  return !entry.colour && !entry.calendarDate && entry.dayOrder == null;
}
// Same write as PATCH /api/calendar/jobs/:id. Grey is the default and is not stored.
async function saveJobCalendar(job, { colourSent = false, colour = null, hasDate = false, calendarDate = null, dayOrderSent = false, dayOrder = null } = {}) {
  return withCalendar(async () => {
    const doc = await readCalendarDoc();
    const prev = doc.jobOverrides[job.id] || {};
    const next = { ...prev };
    if (colourSent) {
      if (!colour || colour === 'grey') delete next.colour;
      else next.colour = colour;
    }
    if (hasDate) {
      if (calendarDate) next.calendarDate = calendarDate;
      else delete next.calendarDate;
    }
    if (dayOrderSent) {
      if (dayOrder == null) delete next.dayOrder;
      else next.dayOrder = dayOrder;
    }
    if (overrideEmpty(next)) delete doc.jobOverrides[job.id];
    else doc.jobOverrides[job.id] = next;
    await writeCalendarDoc(doc);
    return jobEvent(job, doc.jobOverrides[job.id]);
  });
}
function parseCreateCalendarDate(b) {
  if (!b || !Object.prototype.hasOwnProperty.call(b, 'calendarDate')) return { sent: false };
  const raw = b.calendarDate;
  if (raw == null || String(raw).trim() === '') return { sent: false };
  const calendarDate = dayFromValue(raw);
  if (!calendarDate) return { error: 'That date isn’t valid.' };
  return { sent: true, calendarDate };
}
function calendarRef(cid) {
  if (typeof cid !== 'string') return null;
  if (/^[a-f0-9]{16}$/.test(cid)) return { kind: 'event', id: cid };
  const job = /^job-([a-f0-9]{12})$/.exec(cid);
  if (job) return { kind: 'job', id: job[1] };
  return null;
}
async function handleCalendarJob(req, res, key, m) {
  if (m !== 'GET' && m !== 'PATCH') return err(res, 405, 'Method not allowed');
  const job = (/^[a-f0-9]{12}$/.test(key) && await loadJob(key)) || await jobByNumber(key);
  if (!job) return err(res, 404, 'No job with that number.');
  if (m === 'GET') {
    const doc = await readCalendarDoc();
    return send(res, 200, jobEvent(job, doc.jobOverrides[job.id]));
  }
  const b = await readJSON(req);
  const colourField = parseColourField(b);
  if (colourField.error) return err(res, 400, colourField.error);
  const dayOrderField = parseDayOrderField(b);
  if (dayOrderField.error) return err(res, 400, dayOrderField.error);
  const rawDate = jobDateField(b);
  const hasDate = rawDate !== undefined;
  if (!colourField.sent && !hasDate && !dayOrderField.sent) return err(res, 400, 'Nothing to update.');
  let calendarDate;
  if (hasDate) {
    if (rawDate == null || String(rawDate).trim() === '') calendarDate = null;
    else {
      calendarDate = dayFromValue(rawDate);
      if (!calendarDate) return err(res, 400, 'That date isn’t valid.');
    }
  }
  const event = await saveJobCalendar(job, { colourSent: colourField.sent, colour: colourField.colour, hasDate, calendarDate, dayOrderSent: dayOrderField.sent, dayOrder: dayOrderField.dayOrder });
  return send(res, 200, event);
}
async function handleCalendarOrder(req, res, m) {
  if (m !== 'PATCH') return err(res, 405, 'Method not allowed');
  const b = await readJSON(req);
  const date = b && typeof b.date === 'string' ? b.date.trim() : '';
  if (!validDate(date)) return err(res, 400, 'That date isn’t valid.');
  const ids = b.ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 200) return err(res, 400, 'List the events in the order you want.');
  if (ids.some(id => typeof id !== 'string') || new Set(ids).size !== ids.length) return err(res, 400, 'List each event once.');
  const refs = ids.map(calendarRef);
  if (refs.some(ref => !ref)) return err(res, 400, 'That event id isn’t valid.');
  const result = await withCalendar(async () => {
    const doc = await readCalendarDoc();
    const jobs = await allJobs();
    const jobById = new Map(jobs.map(job => [job.id, job]));
    const resolved = [];
    for (const ref of refs) {
      if (ref.kind === 'job') {
        const job = jobById.get(ref.id);
        if (!job) return { status: 404, error: 'No event with that id.' };
        const ev = jobEvent(job, doc.jobOverrides[job.id]);
        if (!eventInRange(ev, date, date)) return { status: 400, error: 'That event isn’t on this day.' };
        resolved.push({ kind: 'job', job });
      } else {
        const ev = doc.events.find(e => e.id === ref.id);
        if (!ev) return { status: 404, error: 'No event with that id.' };
        if (!eventInRange(ev, date, date)) return { status: 400, error: 'That event isn’t on this day.' };
        resolved.push({ kind: 'event', ev });
      }
    }
    const stamp = now();
    resolved.forEach((item, index) => {
      if (item.kind === 'job') {
        const prev = doc.jobOverrides[item.job.id] || {};
        doc.jobOverrides[item.job.id] = { ...prev, dayOrder: index };
      } else {
        item.ev.dayOrder = index;
        item.ev.updatedAt = stamp;
      }
    });
    await writeCalendarDoc(doc);
    return { events: resolved.map(item => item.kind === 'job' ? jobEvent(item.job, doc.jobOverrides[item.job.id]) : publicEvent(item.ev)) };
  });
  if (result.error) return err(res, result.status, result.error);
  return send(res, 200, { ok: true, events: result.events });
}
async function handleCalendar(req, res, p, m, u) {
  if (p === '/api/calendar/order') return handleCalendarOrder(req, res, m);
  const jobRoute = p.match(/^\/api\/calendar\/jobs\/([^/]+)$/);
  if (jobRoute) return handleCalendarJob(req, res, jobRoute[1], m);
  const r = p.match(/^\/api\/calendar\/events(?:\/([a-f0-9]{16}))?$/);
  if (!r) return err(res, 404, 'Not found');
  const eid = r[1] || '';
  if (!eid && m === 'GET') {
    const from = u.searchParams.get('from'), to = u.searchParams.get('to');
    if ((from && !validDate(from)) || (to && !validDate(to))) return err(res, 400, 'That date isn’t valid.');
    return send(res, 200, { events: sortEvents(await calendarEntries(from, to)) });
  }
  if (!eid && m === 'POST') {
    const b = await readJSON(req);
    const cleaned = cleanEventInput(b);
    if (cleaned.error) return err(res, 400, cleaned.error);
    const colourField = parseColourField(b);
    if (colourField.error) return err(res, 400, colourField.error);
    const dayOrderField = parseDayOrderField(b);
    if (dayOrderField.error) return err(res, 400, dayOrderField.error);
    const colour = colourField.sent ? colourField.colour : 'grey';
    const ev = await withCalendar(async () => {
      const doc = await readCalendarDoc();
      let nid = id(8);
      while (doc.events.some(e => e.id === nid)) nid = id(8);
      const stamp = now();
      const created = { id: nid, ...cleaned, colour, createdAt: stamp, updatedAt: stamp };
      if (dayOrderField.sent && dayOrderField.dayOrder != null) created.dayOrder = dayOrderField.dayOrder;
      doc.events.push(created);
      await writeCalendarDoc(doc);
      return created;
    });
    return send(res, 201, publicEvent(ev));
  }
  if (eid && m === 'GET') {
    const ev = (await readCalendarDoc()).events.find(e => e.id === eid);
    if (!ev) return err(res, 404, 'No event with that id.');
    return send(res, 200, publicEvent(ev));
  }
  if (eid && m === 'PATCH') {
    const b = await readJSON(req);
    const colourField = parseColourField(b);
    if (colourField.error) return err(res, 400, colourField.error);
    const dayOrderField = parseDayOrderField(b);
    if (dayOrderField.error) return err(res, 400, dayOrderField.error);
    const result = await withCalendar(async () => {
      const doc = await readCalendarDoc();
      const i = doc.events.findIndex(e => e.id === eid);
      if (i < 0) return { status: 404, error: 'No event with that id.' };
      const existing = doc.events[i];
      const cleaned = cleanEventInput({
        title: b.title != null ? b.title : existing.title,
        allDay: b.allDay != null ? b.allDay : existing.allDay,
        start: b.start != null ? b.start : existing.start,
        end: b.end !== undefined ? b.end : existing.end,
        notes: b.notes != null ? b.notes : existing.notes
      });
      if (cleaned.error) return { status: 400, error: cleaned.error };
      const colour = colourField.sent ? colourField.colour : (normalColour(existing.colour) || 'grey');
      const next = withDayOrder({ ...existing, ...cleaned, colour, id: existing.id, createdAt: existing.createdAt, updatedAt: now() });
      if (dayOrderField.sent) {
        if (dayOrderField.dayOrder == null) delete next.dayOrder;
        else next.dayOrder = dayOrderField.dayOrder;
      }
      doc.events[i] = next;
      await writeCalendarDoc(doc);
      return { event: doc.events[i] };
    });
    if (result.error) return err(res, result.status, result.error);
    return send(res, 200, publicEvent(result.event));
  }
  if (eid && m === 'DELETE') {
    const result = await withCalendar(async () => {
      const doc = await readCalendarDoc();
      const i = doc.events.findIndex(e => e.id === eid);
      if (i < 0) return { status: 404, error: 'No event with that id.' };
      doc.events.splice(i, 1);
      await writeCalendarDoc(doc);
      return { ok: true };
    });
    if (result.error) return err(res, result.status, result.error);
    return send(res, 200, { ok: true });
  }
  return err(res, 405, 'Method not allowed');
}

// Staff quotes. Stored in DATA_DIR/quotes.json as { quotes }. Prices are integer cents.
// A blank quantity is stored as null and counted as 1. Totals are calculated on read
// (subtotal ex GST, GST 10% rounded to the nearest cent, total inc GST). Studio login only.
const quoteMathReady = import(pathToFileURL(path.join(__dirname, 'public/assets/quote-math.mjs')).href);
const QUOTE_FILE = path.join(DATA, 'quotes.json');
let quoteChain = Promise.resolve();
function withQuotes(fn) {
  const run = quoteChain.then(fn, fn);
  quoteChain = run.then(() => {}, () => {});
  return run;
}
async function readQuotesDoc() {
  const math = await quoteMathReady;
  let raw;
  try { raw = await fsp.readFile(QUOTE_FILE, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return { quotes: [] }; throw e; }
  let data;
  try { data = JSON.parse(raw); }
  catch { throw Object.assign(new Error('Quote data could not be read'), { code: 500 }); }
  const list = data && Array.isArray(data.quotes) ? data.quotes : null;
  if (!list) throw Object.assign(new Error('Quote data could not be read'), { code: 500 });
  const quotes = [];
  for (const q of list) {
    if (!q || typeof q.id !== 'string' || !/^[a-f0-9]{16}$/.test(q.id)) continue;
    const client = String(q.client || '').trim().slice(0, 160);
    if (!client) continue;
    if (!validDate(String(q.date || ''))) continue;
    if (!math.QUOTE_VALIDITY.includes(q.validity)) continue;
    if (!Array.isArray(q.lines)) continue;
    const lines = [];
    let ok = true;
    for (let i = 0; i < math.QUOTE_LINES; i++) {
      const src = q.lines[i] && typeof q.lines[i] === 'object' ? q.lines[i] : {};
      const description = String(src.description || '').trim().slice(0, 300);
      let qty = null;
      if (src.qty != null && String(src.qty).trim() !== '') {
        const milli = math.qtyToMilli(src.qty);
        if (milli == null) { ok = false; break; }
        qty = math.milliToQty(milli);
      }
      let price = null;
      if (src.price != null && src.price !== '') {
        if (!Number.isInteger(src.price) || src.price < 0 || src.price > 999999999) { ok = false; break; }
        price = src.price;
      }
      lines.push({ description, qty, price });
    }
    if (!ok || lines.length !== math.QUOTE_LINES) continue;
    const jobId = typeof q.jobId === 'string' && /^[a-f0-9]{12}$/.test(q.jobId) ? q.jobId : '';
    quotes.push({
      id: q.id,
      token: validQuoteToken(q.token),
      client,
      contactName: String(q.contactName || '').trim().slice(0, 160),
      date: String(q.date),
      description: String(q.description || '').trim().slice(0, 4000),
      validity: q.validity,
      lines,
      responses: cleanQuoteResponses(q.responses),
      ...(jobId ? { jobId } : {}),
      createdAt: typeof q.createdAt === 'string' ? q.createdAt : now(),
      updatedAt: typeof q.updatedAt === 'string' ? q.updatedAt : now()
    });
  }
  return { quotes };
}
async function writeQuotesDoc(doc) {
  const tmp = QUOTE_FILE + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify({ quotes: doc.quotes }, null, 2));
  await fsp.rename(tmp, QUOTE_FILE);
}
async function cleanQuote(b) {
  const math = await quoteMathReady;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { error: 'That quote isn’t valid.' };
  const client = String(b.client ?? '').trim().slice(0, 160);
  if (!client) return { error: 'Add a client.' };
  const contactName = String(b.contactName ?? '').trim().slice(0, 160);
  const description = String(b.description ?? '').trim().slice(0, 4000);
  const date = String(b.date ?? '').trim();
  if (!validDate(date)) return { error: 'That date isn’t valid.' };
  const validity = String(b.validity ?? '').trim();
  if (!math.QUOTE_VALIDITY.includes(validity)) return { error: 'Pick a quote validation: 7 days, 30 days or 6 months.' };
  if (b.lines != null && !Array.isArray(b.lines)) return { error: 'Lines must be a list.' };
  const incoming = Array.isArray(b.lines) ? b.lines : [];
  if (incoming.length > math.QUOTE_LINES) return { error: 'A quote has 20 lines.' };
  const lines = [];
  for (let i = 0; i < math.QUOTE_LINES; i++) {
    const src = incoming[i] && typeof incoming[i] === 'object' && !Array.isArray(incoming[i]) ? incoming[i] : {};
    const lineDescription = String(src.description ?? '').trim().slice(0, 300);
    const milli = math.qtyToMilli(src.qty);
    if (milli === undefined) return { error: `Line ${i + 1} quantity isn’t valid.` };
    const price = math.priceToCents(src.price);
    if (price === undefined) return { error: `Line ${i + 1} price isn’t valid.` };
    lines.push({ description: lineDescription, qty: math.milliToQty(milli), price });
  }
  return { client, contactName, date, description, validity, lines };
}
function publicQuote(q, math) {
  const lines = q.lines.map(line => ({
    description: line.description || '',
    qty: line.qty || '',
    price: line.price == null ? '' : math.centsToInput(line.price)
  }));
  const totals = math.quoteTotals(lines);
  return {
    id: q.id,
    client: q.client,
    contactName: q.contactName || '',
    date: q.date,
    description: q.description || '',
    validity: q.validity,
    lines: lines.map((line, i) => ({ ...line, amount: totals.amounts[i] })),
    subtotal: totals.subtotal,
    gst: totals.gst,
    total: totals.total,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt
  };
}
function validQuoteToken(v) {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{20,80}$/.test(v) ? v : '';
}
function cleanQuoteResponses(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const r of list) {
    if (!r || (r.type !== 'accept' && r.type !== 'changes')) continue;
    const name = String(r.name || '').trim().slice(0, 120);
    if (!name) continue;
    const rid = typeof r.id === 'string' && /^[a-f0-9]{12}$/.test(r.id) ? r.id : id(6);
    out.push({ id: rid, type: r.type, name, note: String(r.note || '').trim().slice(0, 10000), at: typeof r.at === 'string' ? r.at : now() });
  }
  return out.slice(-40);
}
function quoteStatus(q) {
  const list = q.responses || [];
  if (list.some(r => r.type === 'accept')) return 'accepted';
  if (list.some(r => r.type === 'changes')) return 'changes';
  return 'open';
}
function publicResponses(q) {
  return (q.responses || []).map(r => ({ type: r.type, name: r.name, note: r.note || '', at: r.at }));
}
function clientQuote(q, math) {
  const pub = publicQuote(q, math);
  return {
    client: pub.client,
    contactName: pub.contactName,
    date: pub.date,
    description: pub.description,
    validity: pub.validity,
    lines: pub.lines.filter(line => String(line.description || '').trim() || String(line.qty || '').trim() || String(line.price || '').trim()),
    subtotal: pub.subtotal,
    gst: pub.gst,
    total: pub.total,
    status: quoteStatus(q),
    responses: publicResponses(q)
  };
}
async function studioQuote(req, q, math) {
  const pub = publicQuote(q, math);
  const job = q.jobId ? await loadJob(q.jobId) : null;
  return {
    ...pub,
    status: quoteStatus(q),
    responses: publicResponses(q),
    clientUrl: `${origin(req)}${B}/quote/${q.id}?k=${encodeURIComponent(q.token)}`,
    ...(q.jobId ? { jobId: q.jobId } : {}),
    ...(job ? { jobNumber: job.jobNumber } : {})
  };
}
function quoteSummary(full) {
  return {
    id: full.id,
    client: full.client,
    contactName: full.contactName,
    date: full.date,
    validity: full.validity,
    description: full.description.slice(0, 180),
    status: full.status,
    subtotal: full.subtotal,
    gst: full.gst,
    total: full.total,
    createdAt: full.createdAt,
    updatedAt: full.updatedAt,
    ...(full.jobId ? { jobId: full.jobId } : {}),
    ...(full.jobNumber ? { jobNumber: full.jobNumber } : {})
  };
}
async function repairQuoteSecrets(doc) {
  let dirty = false;
  for (const q of doc.quotes) {
    if (!q.token) { q.token = token(); dirty = true; }
    if (!Array.isArray(q.responses)) { q.responses = []; dirty = true; }
  }
  if (dirty) await writeQuotesDoc(doc);
  return doc;
}
async function loadQuotes() {
  return withQuotes(async () => repairQuoteSecrets(await readQuotesDoc()));
}
async function handleQuotes(req, res, p, m) {
  const math = await quoteMathReady;
  const r = p.match(/^\/api\/quotes(?:\/([a-f0-9]{16}))?$/);
  if (!r) return err(res, 404, 'Not found');
  const qid = r[1] || '';
  if (!qid && m === 'GET') {
    const doc = await loadQuotes();
    const quotes = await Promise.all(doc.quotes.map(async q => quoteSummary(await studioQuote(req, q, math))));
    quotes.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)) || String(b.id).localeCompare(String(a.id)));
    return send(res, 200, { quotes });
  }
  if (!qid && m === 'POST') {
    const b = await readJSON(req);
    const cleaned = await cleanQuote(b);
    if (cleaned.error) return err(res, 400, cleaned.error);
    const created = await withQuotes(async () => {
      const doc = await readQuotesDoc();
      let nid = id(8);
      while (doc.quotes.some(q => q.id === nid)) nid = id(8);
      const stamp = now();
      const quote = { id: nid, token: token(), responses: [], ...cleaned, createdAt: stamp, updatedAt: stamp };
      doc.quotes.push(quote);
      await writeQuotesDoc(doc);
      return quote;
    });
    return send(res, 201, await studioQuote(req, created, math));
  }
  if (qid && m === 'GET') {
    const quote = (await loadQuotes()).quotes.find(q => q.id === qid);
    if (!quote) return err(res, 404, 'No quote with that id.');
    return send(res, 200, await studioQuote(req, quote, math));
  }
  if (qid && m === 'PUT') {
    const b = await readJSON(req);
    const cleaned = await cleanQuote(b);
    if (cleaned.error) return err(res, 400, cleaned.error);
    const result = await withQuotes(async () => {
      const doc = await readQuotesDoc();
      const i = doc.quotes.findIndex(q => q.id === qid);
      if (i < 0) return { status: 404, error: 'No quote with that id.' };
      const prev = doc.quotes[i];
      const next = { ...prev, ...cleaned, id: prev.id, createdAt: prev.createdAt, updatedAt: now() };
      if (prev.jobId) next.jobId = prev.jobId;
      doc.quotes[i] = next;
      await writeQuotesDoc(doc);
      return { quote: next };
    });
    if (result.error) return err(res, result.status, result.error);
    return send(res, 200, await studioQuote(req, result.quote, math));
  }
  if (qid && m === 'DELETE') {
    const result = await withQuotes(async () => {
      const doc = await readQuotesDoc();
      const i = doc.quotes.findIndex(q => q.id === qid);
      if (i < 0) return { status: 404, error: 'No quote with that id.' };
      doc.quotes.splice(i, 1);
      await writeQuotesDoc(doc);
      return { ok: true };
    });
    if (result.error) return err(res, result.status, result.error);
    return send(res, 200, { ok: true });
  }
  return err(res, 405, 'Method not allowed');
}

// Quote client → proof job. Contact is the person; Client is the business.
// A blank contact uses the business as the required client name, and the business
// is left off when it would repeat that name. Description keeps the job’s 2,000-character cap.
function quoteJobFields(quote) {
  const company = String(quote.client || '').trim().slice(0, 120);
  const contact = String(quote.contactName || '').trim().slice(0, 120);
  const clientName = contact || company;
  const clientCompany = contact && contact.toLowerCase() !== company.toLowerCase() ? company : '';
  return { clientName, clientCompany, description: String(quote.description || '').trim().slice(0, 2000) };
}
// Next whole number above the highest all-digit job number, skipping anything already taken.
function nextJobNumber(jobs) {
  const taken = new Set(jobs.map(j => norm(j.jobNumber)));
  let max = 0;
  for (const j of jobs) {
    if (/^\d{1,12}$/.test(String(j.jobNumber || ''))) {
      const n = Number(j.jobNumber);
      if (Number.isSafeInteger(n) && n > max) max = n;
    }
  }
  for (let n = max + 1; n < max + 10000; n++) {
    const candidate = String(n);
    if (!JOBNUM_RE.test(candidate) || RESERVED.has(norm(candidate)) || taken.has(norm(candidate))) continue;
    return candidate;
  }
  let fallback;
  do { fallback = 'Q' + id(6); } while (!JOBNUM_RE.test(fallback) || RESERVED.has(norm(fallback)) || taken.has(norm(fallback)));
  return fallback;
}
// One job per quote. A previous attempt that saved the job but not the quote is reused.
async function createJobFromQuote(quote) {
  if (quote.jobId) {
    const linked = await loadJob(quote.jobId);
    if (linked) return linked;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const jobs = await allJobs();
    const existing = jobs.find(j => j.quoteId === quote.id);
    if (existing) return existing;
    const fields = quoteJobFields(quote);
    if (!fields.clientName) throw httpError(400, 'Add a client.');
    const jobNumber = nextJobNumber(jobs);
    let jid = id(6);
    while (jobs.some(j => j.id === jid)) jid = id(6);
    const job = {
      id: jid,
      token: token(),
      jobNumber,
      description: fields.description,
      clientName: fields.clientName,
      clientCompany: fields.clientCompany,
      clientEmail: '',
      clientPhone: '',
      quoteId: quote.id,
      access: 'private',
      createdAt: now(),
      versions: []
    };
    const clash = (await allJobs()).find(j => j.quoteId === quote.id || norm(j.jobNumber) === norm(jobNumber));
    if (clash) {
      if (clash.quoteId === quote.id) return clash;
      continue;
    }
    await fsp.mkdir(path.join(FILES, job.id), { recursive: true });
    await saveJob(job);
    return job;
  }
  throw httpError(500, 'Could not create a job for this quote.');
}

async function handlePublicQuote(req, res, qid, action, m, k) {
  if (tooManyMisses(req)) return err(res, 429, 'Too many attempts — please try again later.');
  const math = await quoteMathReady;
  const doc = await loadQuotes();
  const quote = doc.quotes.find(q => q.id === qid);
  if (!quote) { miss(req); return err(res, 404, 'We couldn’t find that quote.'); }
  if (k !== quote.token) { miss(req); return err(res, 403, 'This quote is private — please use the secure link YBI sent you.'); }
  if (!action && m === 'GET') return send(res, 200, clientQuote(quote, math));
  if (action === '/decision' && m === 'POST') {
    const b = await readJSON(req);
    if (!b || !['accept', 'changes'].includes(b.type)) return err(res, 400, 'Bad action');
    const name = String(b.name || '').trim().slice(0, 120);
    const note = String(b.note || '').trim().slice(0, 10000);
    if (!name) return err(res, 400, 'Please add your name.');
    if (b.type === 'changes' && !note) return err(res, 400, 'Please describe the changes.');
    const result = await withQuotes(async () => {
      const fresh = await readQuotesDoc();
      const i = fresh.quotes.findIndex(q => q.id === qid);
      if (i < 0) return { status: 404, error: 'We couldn’t find that quote.' };
      const current = fresh.quotes[i];
      if (k !== current.token) return { status: 403, error: 'This quote is private — please use the secure link YBI sent you.' };
      if (quoteStatus(current) === 'accepted') return { status: 409, error: 'This quote is already confirmed.' };
      let job = null;
      if (b.type === 'accept') {
        job = await createJobFromQuote(current);
        current.jobId = job.id;
      }
      const response = { id: id(6), type: b.type, name, note, at: now() };
      current.responses = [...(current.responses || []), response];
      current.updatedAt = response.at;
      await writeQuotesDoc(fresh);
      return { quote: current, response, job };
    });
    if (result.error) return err(res, result.status, result.error);
    await notifyQuote(req, result.quote, result.response, result.job);
    return send(res, 200, clientQuote(result.quote, math));
  }
  return err(res, 405, 'Method not allowed');
}

const origin = req => PUBLIC_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers['x-forwarded-host'] || req.headers.host}`;
const numPath = job => `${B}/${encodeURIComponent(job.jobNumber)}`;
function reviewUrl(req, job) { return origin(req) + numPath(job); }
function secureUrl(req, job) { return `${origin(req)}${numPath(job)}?k=${job.token}`; }
function publicVersion(job, v, q) {
  const pages = versionPages(v);
  const multi = v.kind === 'image' && pages.length > 1;
  const base = `${numPath(job)}/file/v${v.n}`;
  return {
    n: v.n, kind: v.kind, originalName: v.originalName, size: v.size, uploadedAt: v.uploadedAt, studioNote: v.studioNote || '',
    url: `${base}${q}`,
    ...(multi ? { downloadAll: `${base}/zip${q}` } : {}),
    files: pages.map((f, i) => ({ name: f.originalName, size: f.size, url: multi ? `${base}/${i + 1}${q}` : `${base}${q}` })),
    feedback: (v.feedback || []).map(f => ({ id: f.id, type: f.type, name: f.name, note: f.note, at: f.at, stickies: (f.stickies || []).map(s => ({ n: s.n, page: s.page, x: s.x, y: s.y, text: s.text })), attachments: (f.attachments || []).map(a => ({ name: a.originalName, size: a.size, url: `${numPath(job)}/file/a${a.id}${q}` })) }))
  };
}
function publicJob(job, k) {
  const q = k ? `?k=${encodeURIComponent(k)}` : '';
  return {
    jobNumber: job.jobNumber, description: job.description, clientName: job.clientName, clientCompany: job.clientCompany,
    status: status(job), createdAt: job.createdAt,
    versions: job.versions.map(v => publicVersion(job, v, q))
  };
}
function studioJob(req, job) { return { ...publicJob(job, job.token), id: job.id, token: job.token, access: accessOf(job), secureUrl: secureUrl(req, job), studioUrl: origin(req) + `${B}/studio/${encodeURIComponent(job.jobNumber)}`, clientEmail: job.clientEmail, clientPhone: job.clientPhone, reviewUrl: reviewUrl(req, job), unread: !!job.unread, updatedAt: job.updatedAt, seenAt: job.seenAt || null, ...(typeof job.quoteId === 'string' && /^[a-f0-9]{16}$/.test(job.quoteId) ? { quoteId: job.quoteId } : {}) }; }

// ---------- notifications ----------
let mailer = null;
function setMailerForTests(next) { mailer = next || null; }
try { if (process.env.SMTP_HOST) { const nm = require('nodemailer'); mailer = nm.createTransport({ host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined }); } } catch (e) { console.warn('[mail] nodemailer not installed — run `npm install` to enable email. Falling back to dashboard + log only.'); }

async function deliverStaffMail({ subject, text, replyTo }) {
  const { raw, list } = await notifyRecipients();
  const to = list.join(', ');
  if (!mailer) return;
  if (!to) {
    await fsp.appendFile(LOG_FILE, `[mail] skipped — no valid addresses in ${JSON.stringify(raw)}\n`);
    return;
  }
  // fire-and-forget so the client never waits on SMTP
  mailer.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER || 'proofs@ybicreative.com.au', to, replyTo: replyTo || undefined, subject, text })
    .then(() => fsp.appendFile(LOG_FILE, `[mail] sent to ${to}\n`))
    .catch(e => { console.error('[mail] send failed:', e.message); return fsp.appendFile(LOG_FILE, `[mail] FAILED to ${to}: ${e.message}\n`); });
}

function audMail(cents) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format((Number(cents) || 0) / 100);
}
// Same recipients and From address as proof alerts (deliverStaffMail → notifyRecipients).
// Accept and request-changes both mail. The client mailto to website@ is only a backup.
async function notifyQuote(req, quote, response, job) {
  const math = await quoteMathReady;
  const pub = publicQuote(quote, math);
  const jobLine = String(quote.description || '').split('\n')[0].trim();
  const label = response.type === 'accept' ? 'CONFIRMED' : 'CHANGES REQUESTED';
  const studioLink = origin(req) + `${B}/studio/quote/${quote.id}`;
  const proofLink = job ? origin(req) + `${B}/studio/${encodeURIComponent(job.jobNumber)}` : '';
  const lines = [
    `${label} — Quote for ${quote.client}`, '',
    `Contact: ${quote.contactName || '(none)'}`,
    `Date: ${quote.date}`,
    `Job: ${quote.description || '(no description)'}`,
    `Total (inc GST): ${audMail(pub.total)}`,
    `By: ${response.name}`,
    `When: ${new Date(response.at).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' })} (Melbourne)`, '',
    response.note ? `Note:\n${response.note}\n` : '(no note)',
    ...(job ? [`Proof job: ${job.jobNumber}`, `Open job in studio: ${proofLink}`] : []),
    `Open in studio: ${studioLink}`
  ].join('\n');
  await fsp.appendFile(LOG_FILE, `\n==== ${now()} ====\n${lines}\n`);
  const subjectJob = jobLine || quote.client;
  await deliverStaffMail({
    subject: response.type === 'accept' ? `[YBI Quote] CONFIRMED: ${subjectJob}` : `[YBI Quote] CHANGES: ${subjectJob}`,
    text: lines
  });
}

async function notify(req, job, fb, v) {
  const label = fb.type === 'approve' ? 'APPROVED' : 'CHANGES REQUESTED';
  const studioLink = origin(req) + `${B}/studio/${encodeURIComponent(job.jobNumber)}`;
  const lines = [
    `${label} — Job ${job.jobNumber} (V${v.n})`, '',
    `Client: ${job.clientName}${job.clientCompany ? ' / ' + job.clientCompany : ''}`,
    `Job: ${job.description}`, `By: ${fb.name || '(no name)'}`, `When: ${new Date(fb.at).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' })} (Melbourne)`, '',
    fb.note ? `Note:\n${fb.note}\n` : '(no general note)',
    (fb.stickies || []).length ? `Notes on the artwork:\n${fb.stickies.map(s => ` ${s.n}. page ${s.page} (${Math.round(s.x * 100)}% across, ${Math.round(s.y * 100)}% down) — ${s.text}`).join('\n')}\n` : '',
    fb.attachments.length ? `Attachments:\n${fb.attachments.map(a => ' - ' + a.originalName + ': ' + origin(req) + `${numPath(job)}/file/a${a.id}?k=${job.token}`).join('\n')}\n` : '',
    `Open in studio: ${studioLink}`
  ].join('\n');
  await fsp.appendFile(LOG_FILE, `\n==== ${now()} ====\n${lines}\n`);
  await deliverStaffMail({ subject: `[YBI Proof] ${label}: ${job.jobNumber} — ${job.clientName} (V${v.n})`, text: lines, replyTo: job.clientEmail || undefined });
}

// New proof on a job that already has one. The first file (create + V1, or the
// first upload onto an empty job) is not mailed — that would fire for every new job.
async function notifyVersionUploaded(req, job, v) {
  const studioLink = origin(req) + `${B}/studio/${encodeURIComponent(job.jobNumber)}`;
  const lines = [
    `UPDATED — Job ${job.jobNumber} (V${v.n})`, '',
    `Client: ${job.clientName}${job.clientCompany ? ' / ' + job.clientCompany : ''}`,
    `Job: ${job.description}`,
    versionFileLine(v),
    `When: ${new Date(v.uploadedAt).toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' })} (Melbourne)`, '',
    v.studioNote ? `Note to client:\n${v.studioNote}\n` : '(no note to the client)',
    `Open in studio: ${studioLink}`
  ].join('\n');
  await fsp.appendFile(LOG_FILE, `\n==== ${now()} ====\n${lines}\n`);
  await deliverStaffMail({ subject: `[YBI Proof] UPDATED: ${job.jobNumber} — ${job.clientName} (V${v.n})`, text: lines });
}

// ---------- auth ----------
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=').map(decodeURIComponent)).filter(p => p[0]));
const isStudio = req => cookies(req).ybi_studio === SESSION || req.headers['x-studio-key'] === STUDIO_PASSWORD;
const setCookie = () => `ybi_studio=${SESSION}; Path=${B || '/'}; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 90}`;

// ---------- static ----------
async function serveFile(req, res, file, extra = {}) {
  let st; try { st = await fsp.stat(file); if (!st.isFile()) throw 0; } catch { return err(res, 404, 'Not found'); }
  const type = MIME[extOf(file)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'X-Content-Type-Options': 'nosniff', ...extra });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}
const htmlCache = {};
async function servePage(req, res, name, code = 200) {
  // HTML templates use {{B}} for the mount path, so the app works at /proof (or anywhere)
  const html = (htmlCache[name] ||= (await fsp.readFile(path.join(PUB, name), 'utf8'))).replaceAll('{{B}}', B);
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'same-origin' });
  res.end(html);
}
function serveStatic(req, res, p) {
  const f = path.normalize(path.join(PUB, p));
  if (!f.startsWith(PUB + path.sep) || f.endsWith('.html')) return err(res, 404, 'Not found');
  const cache = /\/(assets\/(fonts|img)|vendor)\//.test(p) ? 'public, max-age=86400' : 'no-cache';
  return serveFile(req, res, f, { 'Cache-Control': cache });
}
const back = (res, loc, extra = {}) => send(res, 302, '', { Location: loc, ...extra });

// ---------- router ----------
async function handle(req, res) {
  const u = new URL(req.url, 'http://x'); let p; try { p = decodeURIComponent(u.pathname); } catch { return err(res, 400, 'Bad URL'); }
  const m = req.method; let r;

  // Works whether the proxy keeps the /proof prefix or strips it.
  if (B && (p === B || p.startsWith(B + '/'))) p = p.slice(B.length) || '/';
  else if (B && p === '/') return back(res, B);
  const k = u.searchParams.get('k') || '';

  // legacy links → new shape
  if ((r = p.match(/^\/p\/([\w-]{10,})\/?$/))) { const job = await jobByToken(r[1]); return job ? back(res, `${numPath(job)}?k=${job.token}`) : servePage(req, res, 'review.html', 404); }
  if (p === '/studio.html' || p === '/review.html' || p === '/login.html') return back(res, B + '/');

  // pages
  if (p === '/' || p === '/login') {
    if (isStudio(req)) return back(res, B + '/studio');
    return servePage(req, res, 'login.html');
  }
  if (p === '/studio' || p.startsWith('/studio/')) {
    if (u.searchParams.get('key') === STUDIO_PASSWORD) return back(res, B + p, { 'Set-Cookie': setCookie() });
    if (!isStudio(req)) return back(res, `${B}/?next=${encodeURIComponent(B + p)}`);
    return servePage(req, res, 'studio.html');
  }
  if ((r = p.match(/^\/quote\/([a-f0-9]{16})\/?$/)) && (m === 'GET' || m === 'HEAD')) return servePage(req, res, 'quote.html');

  // auth
  if (p === '/api/login' && m === 'POST') { const b = await readJSON(req); if (b.password === STUDIO_PASSWORD) return send(res, 200, { ok: true }, { 'Set-Cookie': setCookie() }); await new Promise(r => setTimeout(r, 600)); return err(res, 401, 'Wrong password'); }
  if (p === '/api/logout' && m === 'POST') return send(res, 200, { ok: true }, { 'Set-Cookie': `ybi_studio=; Path=${B || '/'}; Max-Age=0` });

  // client API — keyed by job number (+ optional secure key k)
  if ((r = p.match(/^\/api\/review\/([^/]+)(\/attachments|\/decision)?$/))) {
    if (tooManyMisses(req)) return err(res, 429, 'Too many attempts — please try again later.');
    const job = await jobByNumber(r[1]);
    if (!job) { miss(req); return err(res, 404, 'We couldn’t find a proof with that job number.'); }
    if (!canView(job, k)) { miss(req); return err(res, 403, 'This proof is private — please use the secure link YBI sent you.'); }
    if (!r[2] && m === 'GET') return send(res, 200, publicJob(job, k || null));
    if (r[2] === '/attachments' && m === 'POST') {
      const orig = safeName(u.searchParams.get('name')); const aid = id(8);
      const dir = path.join(FILES, job.id, 'feedback'); await fsp.mkdir(dir, { recursive: true });
      const stored = `${aid}${extOf(orig)}`; const size = await streamToFile(req, path.join(dir, stored), MAX_ATT);
      const fresh = await loadJob(job.id); fresh.pendingAttachments = fresh.pendingAttachments || {};
      fresh.pendingAttachments[aid] = { id: aid, originalName: orig, stored: 'feedback/' + stored, size, at: now() };
      await saveJob(fresh); return send(res, 200, { id: aid, name: orig, size });
    }
    if (r[2] === '/decision' && m === 'POST') {
      const b = await readJSON(req); const v = job.versions[job.versions.length - 1];
      if (!v) return err(res, 400, 'No proof uploaded yet');
      if (b.version && +b.version !== v.n) return err(res, 409, 'A newer version has been uploaded — please refresh.');
      if (!['approve', 'changes'].includes(b.type)) return err(res, 400, 'Bad action');
      const name = String(b.name || '').trim().slice(0, 120), note = String(b.note || '').trim().slice(0, 10000);
      const stickies = b.type === 'changes' ? cleanStickies(b.stickies) : [];
      if (!name) return err(res, 400, 'Please add your name.');
      if (stickies === null) return err(res, 400, 'Add a note to each sticky.');
      if (b.type === 'changes' && !note && !(b.attachments || []).length && !stickies.length) return err(res, 400, 'Please describe the changes, mark the proof, or attach a file.');
      if (status(job) === 'approved') return err(res, 409, 'This version is already approved.');
      const atts = (b.attachments || []).map(a => job.pendingAttachments && job.pendingAttachments[a]).filter(Boolean);
      atts.forEach(a => delete job.pendingAttachments[a.id]);
      const fb = { id: id(6), type: b.type, name, note, attachments: atts, stickies, at: now(), ip: req.socket.remoteAddress, via: k === job.token ? 'secure-link' : 'job-number' };
      v.feedback.push(fb); await notify(req, job, fb, v); job.unread = true; await saveJob(job);
      return send(res, 200, publicJob(job, k || null));
    }
    return err(res, 405, 'Method not allowed');
  }

  if ((r = p.match(/^\/api\/quote\/([a-f0-9]{16})(\/decision)?$/))) return handlePublicQuote(req, res, r[1], r[2] || '', m, k);

  // studio API
  if (p.startsWith('/api/')) {
    if (!isStudio(req)) return err(res, 401, 'Studio login required');
    if (p === '/api/calendar' || p.startsWith('/api/calendar/')) return handleCalendar(req, res, p, m, u);
    if (p === '/api/quotes' || p.startsWith('/api/quotes/')) return handleQuotes(req, res, p, m);
    if ((r = p.match(/^\/api\/jobs\/([^/]+)\/versions\/(\d+)$/))) {
      if (m !== 'DELETE') return err(res, 405, 'Method not allowed');
      const job = (/^[a-f0-9]{12}$/.test(r[1]) && await loadJob(r[1])) || await jobByNumber(r[1]);
      if (!job) return err(res, 404, 'No job with that number.');
      const n = +r[2];
      const version = job.versions.find(v => v.n === n);
      if (!version) return err(res, 404, `No version V${n} on this job.`);
      await removeVersionFiles(job, version);
      const fresh = await loadJob(job.id);
      if (!fresh) return err(res, 404, 'No job with that number.');
      const idx = fresh.versions.findIndex(v => v.n === n);
      if (idx < 0) return err(res, 404, `No version V${n} on this job.`);
      fresh.versions.splice(idx, 1);
      syncUnread(fresh);
      await saveJob(fresh);
      return send(res, 200, studioJob(req, fresh));
    }
    if ((r = p.match(/^\/api\/jobs\/([^/]+)\/changes\.pdf$/)) && (m === 'GET' || m === 'HEAD')) {
      const job = (/^[a-f0-9]{12}$/.test(r[1]) && await loadJob(r[1])) || await jobByNumber(r[1]);
      if (!job) return err(res, 404, 'No job with that number.');
      const v = job.versions.find(x => x.n === +u.searchParams.get('v'));
      const fb = v && v.feedback.find(f => f.id === u.searchParams.get('f') && f.type === 'changes');
      if (!v || !fb || !(fb.stickies || []).length) return err(res, 404, 'No marked-up changes on that version.');
      const meta = { jobNumber: job.jobNumber, version: v.n, clientName: job.clientName, requester: fb.name, note: fb.note, feedbackId: fb.id };
      const pages = versionPages(v);
      let pdf;
      try {
        if (v.kind === 'image' && pages.length > 1) {
          const images = [];
          for (const f of pages) images.push({ bytes: await fsp.readFile(path.join(FILES, job.id, f.stored)), ext: extOf(f.stored) });
          pdf = await buildChangesPdf({ kind: 'image', images, stickies: fb.stickies, meta });
        } else {
          pdf = await buildChangesPdf({
            kind: v.kind, bytes: await fsp.readFile(path.join(FILES, job.id, v.stored)), ext: extOf(v.stored),
            stickies: fb.stickies, meta
          });
        }
      } catch (e) { console.error('[changes.pdf]', e); return err(res, 500, 'Could not build the changes PDF.'); }
      const fname = `YBI-${safeName(job.jobNumber)}-V${v.n}-changes.pdf`;
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fname}"`, 'Content-Length': pdf.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return m === 'HEAD' ? res.end() : res.end(pdf);
    }
    if (p === '/api/jobs' && m === 'GET') { const js = await allJobs(); js.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); return send(res, 200, js.map(j => studioJob(req, j))); }
    if (p === '/api/jobs' && m === 'POST') {
      const b = await readJSON(req); const num = String(b.jobNumber || '').trim();
      if (!String(b.clientName || '').trim() || !num) return err(res, 400, 'Client name and job number are required.');
      if (!JOBNUM_RE.test(num) || RESERVED.has(norm(num))) return err(res, 400, 'Job number can only use letters, numbers, - _ or . (max 40), e.g. 30434.');
      const colourField = parseColourField(b);
      if (colourField.error) return err(res, 400, colourField.error);
      const dateField = parseCreateCalendarDate(b);
      if (dateField.error) return err(res, 400, dateField.error);
      const dupe = await jobByNumber(num);
      if (dupe) return send(res, 409, { error: `Job ${dupe.jobNumber} already exists — open it and upload a new version instead.`, existing: studioJob(req, dupe) });
      const job = { id: id(6), token: token(), jobNumber: num, description: String(b.description || '').trim().slice(0, 2000), clientName: String(b.clientName).trim().slice(0, 120), clientCompany: String(b.clientCompany || '').trim().slice(0, 120), clientEmail: String(b.clientEmail || '').trim().slice(0, 200), clientPhone: String(b.clientPhone || '').trim().slice(0, 60), access: 'private', createdAt: now(), versions: [] };
      await fsp.mkdir(path.join(FILES, job.id), { recursive: true }); await saveJob(job);
      if ((colourField.sent && colourField.colour !== 'grey') || dateField.sent) {
        try {
          await saveJobCalendar(job, {
            colourSent: colourField.sent, colour: colourField.colour,
            hasDate: dateField.sent, calendarDate: dateField.sent ? dateField.calendarDate : null
          });
        } catch (e) {
          await fsp.rm(path.join(FILES, job.id), { recursive: true, force: true });
          await fsp.rm(jobPath(job.id), { force: true });
          await forgetJobOverride(job.id);
          throw e;
        }
      }
      return send(res, 201, studioJob(req, job));
    }
    if ((r = p.match(/^\/api\/jobs\/([^/]+)(\/versions)?$/))) {
      const job = (/^[a-f0-9]{12}$/.test(r[1]) && await loadJob(r[1])) || await jobByNumber(r[1]);
      if (!job) return err(res, 404, 'No job with that number.');
      if (!r[2]) {
        if (m === 'GET') { await ensurePrivate(job); return send(res, 200, studioJob(req, job)); }
        if (m === 'PATCH') {
          const b = await readJSON(req);
          if ('jobNumber' in b) {
            const num = String(b.jobNumber ?? '').trim();
            if (!JOBNUM_RE.test(num) || RESERVED.has(norm(num))) return err(res, 400, 'Job number can only use letters, numbers, - _ or . (max 40), e.g. 30434.');
            if (norm(num) !== norm(job.jobNumber) && await jobByNumber(num)) return err(res, 409, `Job ${num} already exists.`);
            job.jobNumber = num;
          }
          if ('clientName' in b) {
            const name = String(b.clientName ?? '').trim().slice(0, 120);
            if (!name) return err(res, 400, 'Client name is required.');
            job.clientName = name;
          }
          if ('description' in b) job.description = String(b.description ?? '').trim().slice(0, 2000);
          if ('clientCompany' in b) job.clientCompany = String(b.clientCompany ?? '').trim().slice(0, 120);
          if ('clientEmail' in b) job.clientEmail = String(b.clientEmail ?? '').trim().slice(0, 200);
          if ('clientPhone' in b) job.clientPhone = String(b.clientPhone ?? '').trim().slice(0, 60);
          job.access = 'private';
          if (b.rotateToken) job.token = token();
          if (b.markSeen) { job.unread = false; job.seenAt = now(); }
          await saveJob(job); return send(res, 200, studioJob(req, job));
        }
        if (m === 'DELETE') { await fsp.rm(path.join(FILES, job.id), { recursive: true, force: true }); await fsp.rm(jobPath(job.id), { force: true }); await forgetJobOverride(job.id); return send(res, 200, { ok: true }); }
      }
      if (r[2] === '/versions' && m === 'DELETE') return err(res, 404, 'Include the version number to remove.');
      if (r[2] && m === 'POST') {
        const note = String(u.searchParams.get('note') || '').slice(0, 2000);
        const dir = path.join(FILES, job.id);
        await fsp.mkdir(dir, { recursive: true });
        const multipart = /^multipart\/form-data\b/i.test(String(req.headers['content-type'] || ''));
        if (!multipart) {
          const orig = safeName(u.searchParams.get('name'));
          if (!PROOF_TYPES[extOf(orig)]) return err(res, 415, 'Proofs must be PDF, JPG or PNG.');
          const storedPath = path.join(dir, `incoming-${id(6)}${extOf(orig)}`);
          let size;
          try { size = await streamToFile(req, storedPath, MAX_PROOF); }
          catch (e) { await fsp.rm(storedPath, { force: true }); throw e; }
          return addUploadedVersion(req, res, job, note, [{ originalName: orig, storedPath, size }]);
        }
        let incoming;
        try { incoming = await readMultipartFiles(req, dir, { maxFiles: MAX_VERSION_FILES, maxEach: MAX_PROOF, maxTotal: MAX_PROOF }); }
        catch (e) {
          if (e.code === 400 || e.code === 413 || e.code === 415) return err(res, e.code, e.message);
          throw e;
        }
        return addUploadedVersion(req, res, job, note, incoming);
      }
    }
    if (p === '/api/settings') {
      if (m === 'GET') { const s = await loadSettings(); return send(res, 200, { ...s, emailEnabled: !!mailer, publicUrl: PUBLIC_URL, basePath: B, defaultAccess: DEFAULT_ACCESS }); }
      if (m === 'POST') {
        const b = await readJSON(req);
        const notifyEmail = String(b.notifyEmail || '').trim();
        await fsp.writeFile(SETTINGS_FILE, JSON.stringify({ notifyEmail }, null, 2));
        const s = await loadSettings();
        return send(res, 200, { ...s, emailEnabled: !!mailer });
      }
    }
    return err(res, 404, 'Not found');
  }

  // static assets
  if ((m === 'GET' || m === 'HEAD') && (p.startsWith('/assets/') || p.startsWith('/vendor/'))) return serveStatic(req, res, p);
  if (p === '/favicon.ico') return serveStatic(req, res, '/assets/img/favicon.ico');

  // proof + attachment files:  /{jobNumber}/file/v{n}  |  /{jobNumber}/file/v{n}/{page}  |  /{jobNumber}/file/v{n}/zip  |  /{jobNumber}/file/a{id}
  if ((r = p.match(/^\/([^/]+)\/file\/(v|a)(\w+)(?:\/([A-Za-z0-9]+))?$/)) && (m === 'GET' || m === 'HEAD')) {
    const job = await jobByNumber(r[1]);
    if (!job || !(canView(job, k) || isStudio(req))) { miss(req); return err(res, 404, 'Not found'); }
    if (r[2] === 'a') {
      if (r[4]) return err(res, 404, 'Not found');
      let rec;
      for (const v of job.versions) for (const f of v.feedback) for (const a of f.attachments) if (a.id === r[3]) rec = a;
      if (!rec) return err(res, 404, 'Not found');
      const name = rec.originalName; const inline = /\.(pdf|png|jpe?g|webp|gif)$/i.test(name) && !u.searchParams.has('download');
      return serveFile(req, res, path.join(FILES, job.id, rec.stored), { 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/"/g, '')}"`, 'Cache-Control': 'private, max-age=300' });
    }
    if (!/^\d+$/.test(r[3])) return err(res, 404, 'Not found');
    const version = job.versions.find(v => v.n === +r[3]);
    const pages = versionPages(version);
    if (!version || !pages.length) return err(res, 404, 'Not found');
    const part = r[4] || '';
    if (part === 'zip') {
      if (!(version.kind === 'image' && pages.length > 1)) return err(res, 404, 'Not found');
      const root = path.resolve(FILES, job.id);
      const entries = [];
      for (const f of pages) {
        const filePath = path.resolve(root, f.stored);
        if (filePath !== root && filePath.startsWith(root + path.sep)) entries.push({ name: f.originalName, filePath });
      }
      if (entries.length !== pages.length) return err(res, 404, 'Not found');
      return sendZip(req, res, `YBI-${safeName(job.jobNumber)}-V${version.n}.zip`, entries);
    }
    let file = pages[0];
    if (part) {
      if (!/^[1-9]\d*$/.test(part) || +part > pages.length) return err(res, 404, 'Not found');
      file = pages[+part - 1];
    }
    const safe = String(file.originalName || 'file').replace(/"/g, '');
    const inline = /\.(pdf|png|jpe?g|webp|gif)$/i.test(safe) && !u.searchParams.has('download');
    const filePath = path.resolve(FILES, job.id, file.stored);
    const root = path.resolve(FILES, job.id);
    if (filePath === root || !filePath.startsWith(root + path.sep)) return err(res, 404, 'Not found');
    return serveFile(req, res, filePath, { 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safe}"`, 'Cache-Control': 'private, max-age=300' });
  }

  // client review page:  /{jobNumber}
  if ((r = p.match(/^\/([^/]+)\/?$/)) && (m === 'GET' || m === 'HEAD') && JOBNUM_RE.test(r[1]) && !RESERVED.has(norm(r[1]))) return servePage(req, res, 'review.html');

  return err(res, 404, 'Not found');
}

function createAppServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch(e => { console.error(e); if (!res.headersSent) err(res, e.code && e.code >= 400 && e.code < 600 ? e.code : 500, e.message || 'Server error'); else res.end(); });
  });
}

if (require.main === module) {
  createAppServer().listen(PORT, HOST, () => {
    console.log(`\n  YBI Proofs running →  http://localhost:${PORT}${B}  (studio: ${B}/studio · calendar: ${B}/studio/calendar · quotes: ${B}/studio/quote · job pages: ${B}/{jobNumber})`);
    console.log(`  Studio password: ${STUDIO_PASSWORD === 'ybi-proof' ? 'ybi-proof (default — set STUDIO_PASSWORD to change)' : '(from STUDIO_PASSWORD)'}`);
    console.log(`  Data folder: ${DATA}`);
    console.log(`  Email alerts: ${mailer ? 'ON (SMTP)' : 'off — dashboard + data/notifications.log'}`);
    loadSettings().then(s => {
      const list = parseNotifyAddresses(s.notifyEmail);
      console.log(`  Notify: ${list.join(', ') || '(no valid addresses)'}\n`);
    }).catch(e => console.error('[mail] could not read recipients:', e.message));
  });
}

module.exports = {
  handle, createAppServer, parseNotifyAddresses, DEFAULT_NOTIFY_EMAIL, DEFAULT_NOTIFY_EMAILS,
  loadSettings, notifyRecipients, setMailerForTests, readMultipartFiles,
};
