'use strict';
// Approved jobs move to Archive 48 hours after the client's approval.
// Uses a temp data dir. No SMTP.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ybi-archive-'));
process.env.DATA_DIR = dataDir;
process.env.BASE_PATH = '';
process.env.STUDIO_PASSWORD = 'test-proof';
process.env.PORT = '0';
delete process.env.SMTP_HOST;
delete process.env.NOTIFY_EMAIL;

const { createAppServer, ARCHIVE_AFTER_MS, archivedAtFor } = require('../server');

assert.strictEqual(ARCHIVE_AFTER_MS, 2 * 24 * 60 * 60 * 1000);
const approvedAt = '2026-01-01T00:00:00.000Z';
const approvedJob = { versions: [{ feedback: [{ type: 'approve', at: approvedAt }] }] };
const due = Date.parse(approvedAt) + ARCHIVE_AFTER_MS;
assert.strictEqual(archivedAtFor(approvedJob, due - 1), null, 'a job approved for just under two days stays active');
assert.strictEqual(archivedAtFor(approvedJob, due), new Date(due).toISOString(), 'two days after approval is the archive time');
assert.strictEqual(archivedAtFor({ versions: [] }, due), null);
assert.strictEqual(archivedAtFor({ versions: [{ feedback: [{ type: 'approve', at: 'not-a-date' }] }] }, due), null);
assert.strictEqual(archivedAtFor({
  versions: [{ feedback: [{ type: 'approve', at: '2020-01-01T00:00:00.000Z' }, { type: 'changes', at: '2020-01-02T00:00:00.000Z' }] }],
}, Date.now()), null, 'a later change request is not an approval');
assert.strictEqual(archivedAtFor({
  versions: [{ feedback: [{ type: 'changes', at: '2020-01-01T00:00:00.000Z' }, { type: 'approve', at: '2026-06-01T00:00:00.000Z' }] }],
}, Date.parse('2026-06-03T00:00:00.000Z')), '2026-06-03T00:00:00.000Z', 'archive is counted from the latest approval');
assert.strictEqual(archivedAtFor({
  versions: [
    { feedback: [{ type: 'approve', at: '2020-01-01T00:00:00.000Z' }] },
    { feedback: [] },
  ],
}, Date.now()), null, 'an older approval does not archive a newer version');

const studioJs = fs.readFileSync(path.join(__dirname, '../public/assets/studio.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/assets/app.css'), 'utf8');
const serverSrc = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
assert.ok(studioJs.includes("['archive', 'Archive']"), 'jobs page has an Archive filter');
assert.ok(studioJs.includes('!j.archivedAt'), 'All excludes archived jobs');
assert.ok(studioJs.includes("filter === 'archive'"), 'Archive is its own list');
assert.ok(studioJs.includes('<span class="k">Archived</span>'), 'an archived job shows when it was archived');
assert.ok(!studioJs.includes('Latest client activity'), 'latest client activity is gone');
assert.ok(!studioJs.includes('lastDecision'), 'the activity helper is gone');
assert.ok(!css.includes('.activity'), 'activity styles are gone');
assert.ok(!serverSrc.includes('notifyVersionUploaded') && !serverSrc.includes('[YBI Proof] UPDATED'), 'version upload mail is gone');

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

const jobFile = id => path.join(dataDir, 'jobs', id + '.json');
const readJob = id => JSON.parse(fs.readFileSync(jobFile(id), 'utf8'));
function writeJob(job) { fs.writeFileSync(jobFile(job.id), JSON.stringify(job, null, 2)); }
function setLatestDecisionAt(id, iso) {
  const job = readJob(id);
  const v = job.versions[job.versions.length - 1];
  const fb = [...v.feedback].reverse().find(f => f.type === 'approve' || f.type === 'changes');
  fb.at = iso;
  writeJob(job);
  return readJob(id);
}

(async () => {
  const server = createAppServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const fail = m => { console.error('  ✗ ' + m); server.close(); process.exit(1); };
  const check = (cond, m) => { if (!cond) fail(m); console.log('  ✓ ' + m); };
  const pdf = Buffer.from('%PDF-1.1\n');

  const num = 'A' + Date.now().toString(36);
  const created = await req(server, 'POST', '/api/jobs', { body: JSON.stringify({ jobNumber: num, clientName: 'Sam Client', description: 'Poster' }) });
  check(created.status === 201 && created.json.archivedAt === null, 'a new job is not archived');
  const job = created.json;
  const up = await req(server, 'POST', `/api/jobs/${job.id}/versions?name=poster.pdf`, { headers: { 'Content-Type': 'application/pdf' }, body: pdf });
  check(up.status === 201, 'proof uploaded');
  const approved = await req(server, 'POST', `/api/review/${num}/decision?k=${job.token}`, {
    studio: false,
    body: JSON.stringify({ type: 'approve', name: 'Sam Client', note: 'Yes', version: 1 }),
  });
  check(approved.status === 200 && approved.json.status === 'approved' && !Object.prototype.hasOwnProperty.call(approved.json, 'archivedAt'), 'the client approval response has no archive field');

  let list = await req(server, 'GET', '/api/jobs');
  let row = list.json.find(j => j.id === job.id);
  check(row && row.status === 'approved' && row.archivedAt === null, 'a fresh approval stays in the active list');
  const updatedAt = row.updatedAt;

  const tooSoon = new Date(Date.now() - ARCHIVE_AFTER_MS + 60 * 1000).toISOString();
  setLatestDecisionAt(job.id, tooSoon);
  list = await req(server, 'GET', '/api/jobs');
  row = list.json.find(j => j.id === job.id);
  check(row.archivedAt === null && row.updatedAt === updatedAt && !Object.prototype.hasOwnProperty.call(readJob(job.id), 'archivedAt'), 'just under two days does not archive or touch updatedAt');

  const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  setLatestDecisionAt(job.id, old);
  const expectArchive = new Date(Date.parse(old) + ARCHIVE_AFTER_MS).toISOString();
  list = await req(server, 'GET', '/api/jobs');
  row = list.json.find(j => j.id === job.id);
  const disk = readJob(job.id);
  check(row.archivedAt === expectArchive && row.status === 'approved' && disk.archivedAt === expectArchive, 'two days after approval stores archivedAt from that approval');
  check(row.updatedAt === updatedAt && disk.updatedAt === updatedAt, 'archiving does not change updatedAt');
  check(list.json.some(j => j.id === job.id), 'the jobs API still returns an archived job');
  const snap = fs.readFileSync(jobFile(job.id));
  list = await req(server, 'GET', '/api/jobs');
  check(fs.readFileSync(jobFile(job.id)).equals(snap), 'a second look does not rewrite an archived job');

  const one = await req(server, 'GET', `/api/jobs/${job.id}`);
  check(one.status === 200 && one.json.archivedAt === expectArchive, 'opening the job reports the same archive time');
  const client = await req(server, 'GET', `/api/review/${num}?k=${job.token}`, { studio: false });
  check(client.status === 200 && client.json.status === 'approved' && !Object.prototype.hasOwnProperty.call(client.json, 'archivedAt'), 'the client proof stays available and does not see the archive');

  const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const stale = readJob(job.id);
  stale.versions[0].feedback[0].at = recent;
  stale.archivedAt = '2020-01-03T00:00:00.000Z';
  writeJob(stale);
  list = await req(server, 'GET', '/api/jobs');
  row = list.json.find(j => j.id === job.id);
  check(row.archivedAt === null && row.updatedAt === updatedAt && !Object.prototype.hasOwnProperty.call(readJob(job.id), 'archivedAt'), 'a stale archive flag is cleared when the approval is under two days old');

  setLatestDecisionAt(job.id, old);
  list = await req(server, 'GET', '/api/jobs');
  check(list.json.find(j => j.id === job.id).archivedAt === expectArchive, 'the job archives again from the same approval');

  const v2 = await req(server, 'POST', `/api/jobs/${job.id}/versions?name=poster-v2.pdf`, { headers: { 'Content-Type': 'application/pdf' }, body: pdf });
  check(v2.status === 201 && v2.json.archivedAt === null && v2.json.status === 'awaiting_review' && !Object.prototype.hasOwnProperty.call(readJob(job.id), 'archivedAt'), 'uploading a new version leaves the archive');

  const removed = await req(server, 'DELETE', `/api/jobs/${job.id}/versions/2`);
  check(removed.status === 200 && removed.json.archivedAt === expectArchive && removed.json.status === 'approved' && readJob(job.id).archivedAt === expectArchive, 'removing the new version archives again from the earlier approval');

  const waitingNum = num + 'W';
  const waiting = await req(server, 'POST', '/api/jobs', { body: JSON.stringify({ jobNumber: waitingNum, clientName: 'Jo', description: 'Card' }) });
  await req(server, 'POST', `/api/jobs/${waiting.json.id}/versions?name=card.pdf`, { headers: { 'Content-Type': 'application/pdf' }, body: pdf });
  const changes = await req(server, 'POST', `/api/review/${waitingNum}/decision?k=${waiting.json.token}`, {
    studio: false,
    body: JSON.stringify({ type: 'changes', name: 'Jo', note: 'Fix the phone', version: 1 }),
  });
  check(changes.status === 200, 'change request saved');
  setLatestDecisionAt(waiting.json.id, old);
  list = await req(server, 'GET', '/api/jobs');
  const waitingRow = list.json.find(j => j.id === waiting.json.id);
  const active = list.json.filter(j => !j.archivedAt);
  const archived = list.json.filter(j => j.archivedAt);
  check(waitingRow.archivedAt === null && waitingRow.status === 'changes_requested', 'an old change request is not archived');
  check(archived.some(j => j.id === job.id) && !active.some(j => j.id === job.id), 'All hides the archived approval');
  check(active.some(j => j.id === waiting.json.id), 'the change-request job stays in All');

  server.close();
  console.log('archive jobs ok');
})().catch(e => { console.error(e); process.exit(1); });
