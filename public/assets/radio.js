import { B, $, esc, toast } from './common.js';

// Add a station here. stream is a public direct URL. cors true lets the meter read levels.
// Leave stream empty to link out to the station's own player.
export const STATIONS = [
  { id: 'triplej', name: 'triple j', place: 'National', genre: 'Youth', bank: 'National', stream: 'https://abc.streamguys1.com/live/triplejnsw/icecast.audio', page: 'https://www.abc.net.au/triplej', cors: true },
  { id: 'doublej', name: 'Double J', place: 'National', genre: 'Alternative', bank: 'National', stream: 'https://abc.streamguys1.com/live/doublejnsw/icecast.audio', page: 'https://www.abc.net.au/listen/doublej', cors: true },
  { id: 'classic', name: 'ABC Classic', place: 'National', genre: 'Classical', bank: 'National', stream: 'https://abc.streamguys1.com/live/classicfmnsw/icecast.audio', page: 'https://www.abc.net.au/listen/classic', cors: true },
  { id: 'jazz', name: 'ABC Jazz', place: 'National', genre: 'Jazz', bank: 'National', stream: 'https://abc.streamguys1.com/live/abcjazz/icecast.audio', page: 'https://www.abc.net.au/listen/jazz', cors: true },
  { id: 'melbourne', name: 'ABC Melbourne', place: 'Melbourne', genre: 'Local', bank: 'Melbourne', stream: 'https://abc.streamguys1.com/live/localmelbourne/icecast.audio', page: 'https://www.abc.net.au/radio/melbourne', cors: true },
  { id: 'nova', name: 'Nova 100', place: 'Melbourne', genre: 'Hits', bank: 'Melbourne', stream: 'https://playerservices.streamtheworld.com/api/livestream-redirect/NOVA_100.mp3', page: 'https://www.nova100.com.au/', cors: true },
  { id: 'smooth', name: 'smooth 91.5', place: 'Melbourne', genre: 'Easy', bank: 'Melbourne', stream: 'https://playerservices.streamtheworld.com/api/livestream-redirect/SMOOTH915_AAC128.aac', page: 'https://www.smoothfm.com.au/', cors: true },
  { id: 'kiis', name: 'KIIS 101.1', place: 'Melbourne', genre: 'Hits', bank: 'Melbourne', stream: 'https://ais-arn.streamguys1.com/au_001_icy', page: 'https://www.kiis1011.com.au/', cors: true },
  { id: 'gold', name: 'Gold 104.3', place: 'Melbourne', genre: 'Classic hits', bank: 'Melbourne', stream: 'https://ais-arn.streamguys1.com/au_004_icy', page: 'https://www.gold1043.com.au/', cors: true },
  { id: 'triplem', name: 'Triple M', place: 'Melbourne', genre: 'Rock', bank: 'Melbourne', stream: 'https://legacy.scahw.com.au/3mmm_128', page: 'https://www.triplem.com.au/', cors: false },
  { id: 'fox', name: 'Fox FM', place: 'Melbourne', genre: 'Hits', bank: 'Melbourne', stream: 'https://legacy.scahw.com.au/3fox_128', page: 'https://www.fox.com.au/', cors: false },
  { id: 'rrr', name: 'RRR', place: 'Melbourne', genre: 'Community', bank: 'Melbourne', stream: 'https://realtime.rrr.org.au/p1h', page: 'https://www.rrr.org.au/', cors: true },
  { id: 'pbs', name: 'PBS 106.7', place: 'Melbourne', genre: 'Community', bank: 'Melbourne', stream: 'https://playerservices.streamtheworld.com/api/livestream-redirect/3PBS_FMAACHIGH.aac', page: 'https://www.pbsfm.org.au/', cors: true },
  { id: 'sen', name: 'SEN 1116', place: 'Melbourne', genre: 'Sport', bank: 'Melbourne', stream: '', page: 'https://www.sen.com.au/listen', cors: false },
  { id: 'rn', name: 'ABC RN', place: 'National', genre: 'Talk', bank: 'Genre', stream: 'https://abc.streamguys1.com/live/rnnsw/icecast.audio', page: 'https://www.abc.net.au/listen/radionational', cors: true },
  { id: 'news', name: 'ABC News', place: 'National', genre: 'News', bank: 'Genre', stream: 'https://abc.streamguys1.com/live/newsradio/icecast.audio', page: 'https://www.abc.net.au/listen/news', cors: true },
  { id: 'country', name: 'ABC Country', place: 'National', genre: 'Country', bank: 'Genre', stream: 'https://abc.streamguys1.com/live/abccountry/icecast.audio', page: 'https://www.abc.net.au/listen/country', cors: true },
  { id: 'unearthed', name: 'Unearthed', place: 'National', genre: 'New music', bank: 'Genre', stream: 'https://abc.streamguys1.com/live/triplejunearthed/icecast.audio', page: 'https://www.abc.net.au/triplej/unearthed', cors: true },
];

const KEY_STATION = 'ybi-radio-station';
const KEY_VOLUME = 'ybi-radio-volume';
const byId = id => STATIONS.find(s => s.id === id) || null;

const heard = typeof Audio !== 'undefined' ? new Audio() : null;
const probed = typeof Audio !== 'undefined' ? new Audio() : null;
if (heard) { heard.preload = 'none'; }
if (probed) { probed.preload = 'none'; probed.crossOrigin = 'anonymous'; }

let current = null;
let playing = false;
let usingProbe = false;
let volume = 0.8;
let ctx, analyser, freq;
let raf = 0;
const meters = new Set();

function savedVolume() {
  const raw = localStorage.getItem(KEY_VOLUME);
  if (raw == null || raw === '') return 0.8;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.8;
}
function remember() {
  if (current) localStorage.setItem(KEY_STATION, current.id);
  localStorage.setItem(KEY_VOLUME, String(volume));
}
function applyVolume() {
  if (heard) heard.volume = volume;
  if (probed) probed.volume = volume;
}
function liveEl() { return usingProbe ? probed : heard; }

function wireProbe() {
  if (ctx || !probed) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  analyser = ctx.createAnalyser();
  analyser.fftSize = 64;
  analyser.smoothingTimeConstant = 0.78;
  freq = new Uint8Array(analyser.frequencyBinCount);
  const node = ctx.createMediaElementSource(probed);
  node.connect(analyser);
  analyser.connect(ctx.destination);
}
function resumeCtx() { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }

function emit() {
  paintMini();
  paintConsole();
  if (playing) startMeter(); else stopMeter();
}

function fail(station) {
  playing = false;
  emit();
  toast(`${station.name} didn’t start. Open their player instead.`);
}

async function playCurrent() {
  if (!current || !current.stream) { toast('Choose a station'); return; }
  const useProbe = !!current.cors;
  const live = useProbe ? probed : heard;
  const other = useProbe ? heard : probed;
  if (other) { other.pause(); }
  if (useProbe) wireProbe();
  usingProbe = useProbe;
  applyVolume();
  if (!live.src || live.src !== new URL(current.stream, location.href).href) live.src = current.stream;
  playing = true;
  emit();
  try {
    resumeCtx();
    await live.play();
  } catch (e) {
    if (useProbe && heard) {
      probed.pause();
      usingProbe = false;
      heard.src = current.stream;
      applyVolume();
      try { await heard.play(); emit(); return; }
      catch { /* fall through */ }
    }
    playing = false;
    fail(current);
  }
}

function stopPlayback() {
  if (heard) heard.pause();
  if (probed) probed.pause();
  playing = false;
  emit();
}

function choose(station, autoplay) {
  if (!station.stream) {
    window.open(station.page, '_blank', 'noopener');
    toast(`${station.name} has no public stream — opened their player.`);
    return;
  }
  current = station;
  remember();
  if (autoplay || playing) playCurrent();
  else emit();
}

function setVolume(next) {
  volume = Math.min(1, Math.max(0, next));
  applyVolume();
  remember();
  emit();
}

if (heard) heard.addEventListener('error', () => { if (!usingProbe && playing) fail(current || { name: 'Station' }); });
if (probed) probed.addEventListener('error', () => { if (usingProbe && playing) fail(current || { name: 'Station' }); });

function clock() {
  return new Date().toLocaleTimeString('en-AU', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function drawMeter(canvas, t) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || 280;
  const h = canvas.clientHeight || 48;
  if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const n = 28;
  const gap = 3;
  const bw = (w - gap * (n - 1)) / n;
  let levels = null;
  if (playing && usingProbe && analyser && freq) {
    analyser.getByteFrequencyData(freq);
    const sum = freq.reduce((a, b) => a + b, 0);
    if (sum > 0) levels = freq;
  }
  for (let i = 0; i < n; i++) {
    let v;
    if (levels) v = levels[Math.floor(i / n * levels.length)] / 255;
    else if (playing) v = 0.18 + 0.55 * Math.abs(Math.sin(t / 180 + i * 0.55)) * (0.45 + 0.55 * Math.abs(Math.sin(t / 90 + i)));
    else v = 0.04;
    const bh = Math.max(3, v * h);
    const x = i * (bw + gap);
    const y = h - bh;
    g.fillStyle = v > 0.82 ? '#e24b4b' : v > 0.62 ? '#e7c27a' : '#b6e38a';
    g.globalAlpha = playing ? 0.95 : 0.45;
    g.fillRect(x, y, bw, bh);
  }
  g.globalAlpha = 1;
}

function startMeter() {
  if (raf) return;
  const loop = t => {
    raf = requestAnimationFrame(loop);
    meters.forEach(c => { if (!c.isConnected) meters.delete(c); else drawMeter(c, t); });
  };
  raf = requestAnimationFrame(loop);
}
function stopMeter() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  meters.forEach(c => { if (c.isConnected) drawMeter(c, 0); });
}

function watchMeter(canvas) {
  if (!canvas || meters.has(canvas)) return;
  meters.add(canvas);
  drawMeter(canvas, 0);
  if (playing) startMeter();
}

let mini;
function ensureMini() {
  if (mini) return mini;
  mini = document.createElement('div');
  mini.className = 'rx-mini';
  mini.hidden = true;
  mini.innerHTML = `<span class="rx-mini-lamp" data-mini-lamp aria-hidden="true"></span>
    <a class="rx-mini-name" data-mini-name href="${B}/studio/radio">YBI Radio</a>
    <button type="button" class="rx-transport rx-transport--sm" data-mini-play aria-label="Play">▶</button>
    <label class="rx-mini-vol"><span class="sr">Level</span><input data-mini-vol type="range" min="0" max="100" value="80" aria-label="Volume"></label>`;
  document.body.append(mini);
  $('[data-mini-play]', mini).onclick = () => playing ? stopPlayback() : playCurrent();
  $('[data-mini-vol]', mini).addEventListener('input', e => setVolume(Number(e.target.value) / 100));
  return mini;
}
function paintMini() {
  const el = ensureMini();
  const onRadio = document.body.classList.contains('is-radio');
  const show = !!current && !onRadio;
  el.hidden = !show;
  document.body.classList.toggle('rx-dock', show);
  if (!show) return;
  $('[data-mini-lamp]', el).classList.toggle('is-live', playing);
  const name = $('[data-mini-name]', el);
  name.textContent = playing ? current.name : `${current.name} · standby`;
  const play = $('[data-mini-play]', el);
  play.textContent = playing ? '■' : '▶';
  play.setAttribute('aria-label', playing ? 'Stop' : 'Play');
  const vol = $('[data-mini-vol]', el);
  if (document.activeElement !== vol) vol.value = String(Math.round(volume * 100));
}

function pad(station) {
  const on = current && current.id === station.id;
  const ext = !station.stream;
  return `<button type="button" class="rx-pad${on ? ' is-on' : ''}${ext ? ' is-ext' : ''}" data-pad="${esc(station.id)}" aria-pressed="${on ? 'true' : 'false'}">
    <b>${esc(station.name)}</b><span>${esc(ext ? 'Open player' : station.genre)}</span></button>`;
}

function paintConsole() {
  const root = document.querySelector('[data-rx]');
  if (!root) return;
  const lamp = $('[data-onair]', root);
  lamp.classList.toggle('is-live', playing);
  lamp.textContent = playing ? 'ON AIR' : 'STANDBY';
  $('[data-led]', root).textContent = current ? current.name : 'YBI RADIO';
  $('[data-sub]', root).textContent = current ? `${current.place} · ${current.genre}` : 'Select a cart';
  $('[data-clock]', root).textContent = clock();
  const status = $('[data-status]', root);
  status.textContent = playing ? 'ON AIR' : current ? 'CUED' : 'READY';
  $$pads(root);
  const knob = $('[data-knob]', root);
  if (knob) {
    knob.style.setProperty('--ang', `${-140 + volume * 280}deg`);
    knob.setAttribute('aria-valuenow', String(Math.round(volume * 100)));
  }
  const pct = $('[data-level]', root);
  if (pct) pct.textContent = `${Math.round(volume * 100)}`;
}
function $$pads(root) {
  root.querySelectorAll('[data-pad]').forEach(btn => {
    const on = current && btn.dataset.pad === current.id;
    btn.classList.toggle('is-on', !!on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function banks() {
  const order = ['National', 'Melbourne', 'Genre'];
  return order.map(name => {
    const items = STATIONS.filter(s => s.bank === name).map(pad).join('');
    return `<section class="rx-bank"><h2>${name}</h2><div class="rx-pads">${items}</div></section>`;
  }).join('');
}

let clockTimer = 0;
export async function radioPage() {
  document.title = 'YBI Radio · Studio';
  const app = document.getElementById('app');
  app.innerHTML = `<div class="rx" data-rx>
    <div class="rx-desk">
      <div class="rx-screws" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="rx-top">
        <div class="rx-brand"><span>YBI</span><b>Radio</b><em>Console 01 · Bendigo</em></div>
        <div class="rx-screen">
          <div class="rx-onair" data-onair>STANDBY</div>
          <div class="rx-readout">
            <div class="rx-led" data-led>YBI RADIO</div>
            <div class="rx-sub" data-sub>Select a cart</div>
            <canvas class="rx-meter" data-meter width="320" height="48" aria-hidden="true"></canvas>
          </div>
          <div class="rx-side">
            <div class="rx-clock" data-clock>--:--:--</div>
            <div class="rx-status" data-status>READY</div>
          </div>
        </div>
      </div>
      <div class="rx-bay">
        <button type="button" class="rx-transport" data-play aria-label="Play"><span>▶</span><small>Play</small></button>
        <button type="button" class="rx-transport" data-stop aria-label="Stop"><span>■</span><small>Stop</small></button>
        <div class="rx-knobwrap">
          <button type="button" class="rx-knob" data-knob aria-label="Volume" aria-valuemin="0" aria-valuemax="100" aria-valuenow="80"><i></i></button>
          <div class="rx-knobcap"><b data-level>80</b><small>Level</small></div>
        </div>
      </div>
      ${banks()}
    </div>
  </div>`;
  const root = $('[data-rx]');
  watchMeter($('[data-meter]', root));
  $('[data-play]', root).onclick = () => playCurrent();
  $('[data-stop]', root).onclick = () => stopPlayback();
  root.querySelectorAll('[data-pad]').forEach(btn => btn.onclick = () => {
    const station = byId(btn.dataset.pad);
    if (station) choose(station, true);
  });
  const knob = $('[data-knob]', root);
  knob.setAttribute('aria-valuenow', String(Math.round(volume * 100)));
  let drag = null;
  knob.addEventListener('pointerdown', e => {
    drag = { y: e.clientY, v: volume };
    knob.setPointerCapture(e.pointerId);
  });
  knob.addEventListener('pointermove', e => {
    if (!drag) return;
    setVolume(drag.v + (drag.y - e.clientY) / 160);
  });
  knob.addEventListener('pointerup', () => { drag = null; });
  knob.addEventListener('keydown', e => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); setVolume(volume + 0.05); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); setVolume(volume - 0.05); }
  });
  clearInterval(clockTimer);
  clockTimer = setInterval(() => { const c = $('[data-clock]'); if (c) c.textContent = clock(); }, 1000);
  paintConsole();
  paintMini();
}

export function syncRadio() { paintMini(); }

export function bootRadio() {
  volume = savedVolume();
  applyVolume();
  current = byId(localStorage.getItem(KEY_STATION) || '');
  ensureMini();
  paintMini();
}
